/**
 * Worker-side runtime: long-lived warm worker.
 *
 * Lifecycle (RUN-2):
 *   1. Bootstrap once: capture trusted host references, initialise
 *      manifold WASM, install feature recognition, scrub the sandbox
 *      globals, and freeze base prototypes.
 *   2. Post `{ ready: true }` so the host knows we are accepting work.
 *   3. Listen for RunRequest messages on `parentPort`. For each request
 *      run the static lint, typecheck+emit, execute the snippet inside
 *      `new Function()`, validate the resulting Manifold, post a
 *      RunResult, and clear per-run state (Manifold instance registry,
 *      feature registry) before returning to idle.
 *
 * Reusing the worker across runs is safe because the security boundary
 * is the worker realm itself — once the SEC-1 scrub deletes
 * `process`/`require`/`Buffer`/`module`/`__dirname`/`__filename` from
 * `globalThis` and freezes the ambient prototypes, those changes
 * persist for the lifetime of the worker. User code in run #2 inherits
 * the same scrubbed realm that user code in run #1 saw.
 *
 * The host recycles us after a fixed number of runs (or on crash /
 * timeout / OOM) so the WASM heap cannot grow without bound.
 *
 * The orchestration here is intentionally thin — module-split helpers
 * own the actual work:
 *   - sandbox-globals.ts   SEC-1 scrub + prototype freeze
 *   - sandbox-console.ts   per-run user-visible `console`
 *   - mesh-payload.ts      RUN-2/4 mesh -> wire payload
 *   - runtime-location.ts  RUN-6 stack -> original source mapping
 */
import { parentPort, threadId } from 'node:worker_threads';
import Module from 'manifold-3d';

import { cleanup, garbageCollectInstance, garbageCollectManifold, getLastCleanupDeleteFailures } from '../sandbox/garbage-collector.js';
import { installFeatureRecognition, type FeatureStore } from '../sandbox/feature-recognition.js';
import { addError, addHint, addWarning, emptyReport, type Report } from '../validation/report.js';
import { runStaticStage, runGeometryStage, detectResultAssignmentInJs } from '../validation/validators.js';
import { compileSnippetTypeScript } from '../compiler/typescript-compiler.js';
import type { MeshPayload, RunRequest, RunResult } from './protocol.js';
import type { Issue } from '../validation/report.js';
import type { AnyConstructor, ManifoldInstance, ManifoldMesh, Vec3 } from '../sandbox/manifold-types.js';
import { buildMeshPayload } from './mesh-payload.js';
import { runtimeErrorSnippet, runtimeSourceLocation, upgradeIssueSnippet } from './runtime-location.js';
import { createSandboxConsole } from './sandbox-console.js';
import { scrubSandboxGlobals } from './sandbox-globals.js';

if (!parentPort) {
  throw new Error('runner/worker must be spawned via worker_threads');
}

const port = parentPort;

// Trusted host references must be captured BEFORE the SEC-1 scrub
// deletes `process` from globalThis. They survive in module-scope
// closures for the lifetime of the worker.
const trustedSetImmediate = setImmediate;
const trustedStderrWrite = process.stderr.write.bind(process.stderr);
const sandboxConsole = createSandboxConsole(trustedStderrWrite);

// VAL-4: the manifold "no intrinsic units; coordinates are millimetres"
// hint is high signal on the first run of a script, but pure noise on
// every subsequent iteration. Module-scope flag means the hint fires
// once per warm-worker lifetime (the host recycles us periodically, at
// which point a fresh worker module reload resets this back to false).
let seenMillimetresHint = false;

// Per-worker state populated once during bootstrap.
let TrackedManifold: AnyConstructor | undefined;
let TrackedCrossSection: AnyConstructor | undefined;
let TrackedMesh: AnyConstructor | undefined;
let featureStore: FeatureStore | undefined;

async function bootstrap(): Promise<void> {
  const wasm = await Module();
  wasm.setup();
  garbageCollectManifold(wasm);

  // Install primitive recorders AFTER GC wrapping so feature recording
  // sits on the outside; the GC wrapper still tracks returned instances.
  featureStore = installFeatureRecognition(wasm);

  const { Manifold, CrossSection, Mesh } = wasm;
  TrackedManifold = trackConstructor(Manifold as unknown as AnyConstructor);
  TrackedCrossSection = trackConstructor(CrossSection as unknown as AnyConstructor);
  TrackedMesh = trackConstructor(Mesh as unknown as AnyConstructor);

  // SEC-1 sandbox scrub MUST run after WASM init + Embind class
  // registration + feature recognition install. See sandbox-globals.ts
  // for the full lifecycle contract.
  scrubSandboxGlobals();
}

async function handleRun(req: RunRequest): Promise<void> {
  const t0 = performance.now();
  const stageOpts = { suppressSnippet: req.suppressSnippet === true };

  // Stage 1: static lint.
  const report = runStaticStage(req.code, stageOpts);
  if (!report.ok) {
    enforceSnippetInvariant(report, stageOpts.suppressSnippet);
    report.durationMs = Math.round(performance.now() - t0);
    port.postMessage({ report } satisfies RunResult);
    return;
  }

  // Stage 2: TypeScript typecheck + emit.
  const compiled = compileSnippetTypeScript(req.code, stageOpts);
  // Upgrade single-line snippets emitted by typescript-compiler.ts into
  // VAL-5 multi-line code frames. The compiler is intentionally generic
  // and doesn't know about the code-frame helper, so we transform here.
  for (const issue of compiled.issues) {
    upgradeIssueSnippet(issue, req.code, stageOpts.suppressSnippet);
  }
  if (!compiled.ok || compiled.js === undefined) {
    for (const issue of compiled.issues) {
      addError(report, issue);
    }
    if (compiled.issues.length === 0) {
      addError(report, {
        stage: 'typecheck',
        code: 'TS_EMIT_ERROR',
        category: 'api',
        message: 'TypeScript emit failed without diagnostics.',
      });
    }
    enforceSnippetInvariant(report, stageOpts.suppressSnippet);
    report.durationMs = Math.round(performance.now() - t0);
    port.postMessage({ report } satisfies RunResult);
    return;
  }
  for (const issue of compiled.issues) {
    addWarning(report, issue);
  }

  // VAL-3 final gate: even though the static AST walk already checked
  // for `result` assignments, the TypeScript pass lowers exotic patterns
  // (compound assigns, destructuring) to plain `result = …` forms, so a
  // post-emit scan reliably catches the cases the static AST might miss
  // and rejects false positives where a `let result` in a nested
  // function shadowed the top-level binding.
  if (!detectResultAssignmentInJs(compiled.js)) {
    addError(report, {
      stage: 'static',
      code: 'RESULT_NOT_ASSIGNED',
      category: 'sandbox',
      message: `Script must assign the final Manifold to a variable named 'result'.`,
    });
    enforceSnippetInvariant(report, stageOpts.suppressSnippet);
    report.durationMs = Math.round(performance.now() - t0);
    port.postMessage({ report } satisfies RunResult);
    return;
  }

  // Reset per-run state before user code runs. The feature registry
  // accumulates ids across calls into the recorded primitive factories;
  // clearing it between runs is what makes warm-worker reuse safe.
  if (featureStore) {
    featureStore.registry.clear();
  }

  if (!TrackedManifold || !TrackedCrossSection || !TrackedMesh) {
    addError(report, {
      stage: 'runtime',
      code: 'WORKER_CRASH',
      category: 'runtime',
      message: 'Worker has not finished bootstrapping; cannot execute user code.',
    });
    report.durationMs = Math.round(performance.now() - t0);
    port.postMessage({ report } satisfies RunResult);
    return;
  }

  let resultValue: unknown;
  try {
    const userFn = new Function(
      'Manifold',
      'CrossSection',
      'Mesh',
      'console',
      `'use strict';\nlet result;\n${compiled.js}\n;return result;`,
    );
    resultValue = userFn(TrackedManifold, TrackedCrossSection, TrackedMesh, sandboxConsole);
  } catch (e: unknown) {
    const err = e as Error;
    const sourceLocation = await runtimeSourceLocation(err.stack, req.code, compiled.sourceMap);
    addError(report, {
      stage: 'runtime',
      code: 'RUNTIME_ERROR',
      category: 'runtime',
      message: err.message,
      line: sourceLocation?.line,
      col: sourceLocation?.col,
      snippet: stageOpts.suppressSnippet
        ? undefined
        : runtimeErrorSnippet(req.code, sourceLocation, err.stack),
    });
    cleanupAndReport(report);
    enforceSnippetInvariant(report, stageOpts.suppressSnippet);
    report.durationMs = Math.round(performance.now() - t0);
    port.postMessage({ report } satisfies RunResult);
    return;
  }

  // Stage 4: capability-check + geometric validation.
  if (!isManifoldLike(resultValue)) {
    addError(report, {
      stage: 'geometry',
      code: 'RESULT_NOT_MANIFOLD',
      category: 'geometry',
      message: `'result' is not a Manifold instance (got ${describe(resultValue)}).`,
    });
    cleanupAndReport(report);
    report.durationMs = Math.round(performance.now() - t0);
    port.postMessage({ report } satisfies RunResult);
    return;
  }
  const m: ManifoldInstance = resultValue;
  garbageCollectInstance(m);

  let mesh: ManifoldMesh | undefined;
  let stats:
    | {
        volume: number;
        surfaceArea: number;
        genus: number;
        bboxMin: [number, number, number];
        bboxMax: [number, number, number];
      }
    | undefined;
  try {
    const status = String(m.status());
    const isEmpty = !!m.isEmpty();
    const triangles = isEmpty ? 0 : Number(m.numTri());
    const vertices = isEmpty ? 0 : Number(m.numVert());
    const volume = isEmpty ? 0 : Number(m.volume());
    const surfaceArea = isEmpty ? 0 : Number(m.surfaceArea());
    const genus = isEmpty ? 0 : Number(m.genus());
    const box = m.boundingBox();
    const bbox = {
      min: [Number(box.min[0]), Number(box.min[1]), Number(box.min[2])] as Vec3,
      max: [Number(box.max[0]), Number(box.max[1]), Number(box.max[2])] as Vec3,
    };

    runGeometryStage(report, {
      status,
      isEmpty,
      triangles,
      vertices,
      volume,
      surfaceArea,
      genus,
      bbox,
    });

    // VAL-4: emit the millimetres reminder once per warm-worker lifetime,
    // and only on a successful geometry pass (status === 'NoError' and
    // not empty). Subsequent iterations get terser reports.
    if (status === 'NoError' && !isEmpty && !seenMillimetresHint) {
      addHint(report, 'Manifold has no intrinsic units; this server interprets coordinates as millimetres.');
      seenMillimetresHint = true;
    }

    if (req.mode === 'execute' && report.errors.length === 0 && !isEmpty) {
      mesh = m.getMesh();
      garbageCollectInstance(mesh);
      stats = { volume, surfaceArea, genus, bboxMin: bbox.min, bboxMax: bbox.max };
    }
  } catch (e: unknown) {
    addError(report, {
      stage: 'geometry',
      code: 'RUNTIME_ERROR',
      category: 'runtime',
      message: `Geometry inspection failed: ${(e as Error).message}`,
    });
  }

  let payload: MeshPayload | undefined;
  if (mesh && stats && featureStore) {
    payload = buildMeshPayload(mesh, featureStore, stats, req.description);
  }

  report.durationMs = Math.round(performance.now() - t0);
  cleanupAndReport(report);
  enforceSnippetInvariant(report, stageOpts.suppressSnippet);

  if (payload) {
    port.postMessage({ report, mesh: payload } satisfies RunResult, [
      payload.vertProperties,
      payload.triVerts,
      payload.triFeatureIds,
    ]);
  } else {
    port.postMessage({ report } satisfies RunResult);
  }
}

// ───── Bootstrap ────────────────────────────────────────────────────────

bootstrap()
  .then(() => {
    // Tell the host we are ready to accept work. The host blocks the
    // first runOnce() on this signal.
    port.postMessage({ ready: true, threadId });
    port.on('message', req => {
      handleRun(req as RunRequest).catch((err: unknown) => {
        const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
        const report = emptyReport('runtime');
        addError(report, {
          stage: 'runtime',
          code: 'WORKER_CRASH',
          category: 'runtime',
          message: `Worker crashed during run: ${msg}`,
        });
        port.postMessage({ report } satisfies RunResult);
      });
    });
  })
  .catch((err: unknown) => {
    // Bootstrap failed (e.g. WASM init blew up). Surface a single crash
    // report and let the worker exit. The host will see the exit and
    // map it to WORKER_CRASH for any in-flight request.
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    const report = emptyReport('runtime');
    addError(report, {
      stage: 'runtime',
      code: 'WORKER_CRASH',
      category: 'runtime',
      message: `Worker bootstrap failed: ${msg}`,
    });
    port.postMessage({ report } satisfies RunResult);
    trustedSetImmediate(() => port.close());
  });

// ───── Local helpers ────────────────────────────────────────────────────

function isManifoldLike(v: unknown): v is ManifoldInstance {
  if (v === null || v === undefined || typeof v !== 'object') {
    return false;
  }
  const x = v as Record<string, unknown>;
  return (
    typeof x.status === 'function' &&
    typeof x.getMesh === 'function' &&
    typeof x.numTri === 'function' &&
    typeof x.boundingBox === 'function' &&
    typeof x.volume === 'function'
  );
}

function describe(v: unknown): string {
  if (v === null || v === undefined) {
    return String(v);
  }
  if (typeof v !== 'object') {
    return typeof v;
  }
  return (v as object).constructor?.name ?? 'object';
}

/**
 * Defensive invariant: when `suppressSnippet` is true, no `Issue.snippet`
 * field should ever appear in the report — that would re-open the
 * file-content exfiltration channel that motivated the flag.
 */
function enforceSnippetInvariant(report: { errors: Issue[]; warnings: Issue[] }, suppress: boolean): void {
  if (!suppress) {
    return;
  }
  let leaked = 0;
  for (const list of [report.errors, report.warnings]) {
    for (const issue of list) {
      if (issue.snippet !== undefined) {
        leaked++;
        delete issue.snippet;
      }
    }
  }
  if (leaked > 0) {
    trustedStderrWrite(
      `[manifold-mcp] WARNING: suppressSnippet was set but ${leaked} Issue.snippet field(s) leaked through; scrubbed before send.\n`,
    );
  }
}

function trackConstructor<T extends AnyConstructor>(Cls: T): T {
  if (typeof Cls !== 'function') {
    return Cls;
  }
  const Wrapped = function (...args: unknown[]) {
    const inst = Reflect.construct(Cls, args, Wrapped as unknown as AnyConstructor);
    garbageCollectInstance(inst);
    return inst;
  } as unknown as T;
  Wrapped.prototype = Cls.prototype;
  Object.setPrototypeOf(Wrapped, Cls);
  return Wrapped;
}

/**
 * MNT-6: run `cleanup()` and surface a single `GC_DELETE_FAILED` hint
 * on the report when one or more `delete()` calls were swallowed. A
 * non-zero count usually points at WASM heap pressure or a
 * use-after-free; either way it's worth telling the LLM so it can
 * shrink the script before retrying.
 */
function cleanupAndReport(report: Report): void {
  cleanup();
  const failures = getLastCleanupDeleteFailures();
  if (failures > 0) {
    addHint(
      report,
      `GC_DELETE_FAILED: ${failures} manifold instance${failures === 1 ? '' : 's'} failed to release; possible WASM memory pressure.`,
    );
  }
}
