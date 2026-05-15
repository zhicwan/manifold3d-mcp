/**
 * Host-side runner: serializes execute requests, drives a long-lived warm
 * Worker, enforces a hard timeout, and returns a Report (plus optional
 * mesh).
 *
 * Concurrency model: a 1-slot queue. Manifold WASM is heavy and the
 * preview page expects one source of truth, so we do not run scripts in
 * parallel.
 *
 * Lifecycle (RUN-2: warm worker reuse):
 *   * The first run() spawns a Worker, waits for its `{ ready: true }`
 *     handshake, and posts the request. Subsequent runs reuse the same
 *     Worker — Manifold WASM init runs ~once per process instead of once
 *     per script, which is the dominant cost on small snippets.
 *   * After RECYCLE_AFTER_RUNS successful runs the Worker is retired so
 *     WASM heap fragmentation cannot grow without bound; the next run
 *     spawns a fresh one.
 *   * On timeout / OOM / crash the warm Worker is terminated and cleared
 *     so the next run starts from a clean realm.
 *
 * Lifecycle (RUN-1: race-triad fix retained):
 *   The Worker emits up to three lifecycle events per request — `error`
 *   (uncaught throw or fatal allocator condition), `message` (the worker
 *   posted a RunResult), and `exit` (the thread tore down). We treat
 *   `error`/`message` as informational (capture into closures) and only
 *   settle from `exit` OR from receiving the result `message`. When we
 *   need to discard the worker (timeout / OOM / crash / recycle) we
 *   await `terminate()` before resolving so the queue chain cannot
 *   overlap two live WASM heaps.
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { addError, type Report, emptyReport } from '../validation/report.js';
import type { MeshPayload, RunRequest, RunResult } from './protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(HERE, 'worker.js');

/** Surfaced in script-conventions.md and validation-report.md — keep docs in sync. */
export const DEFAULT_TIMEOUT_MS = 5000;
/** Surfaced in script-conventions.md and validation-report.md — keep docs in sync. */
export const MAX_OLD_GEN_MB = 512;
/** Recycle the warm worker after this many successful runs. */
export const RECYCLE_AFTER_RUNS = 50;

export interface RunnerOptions {
  timeoutMs?: number;
  /**
   * Override the per-worker old-generation soft cap (MB). Tests use a
   * tiny value (e.g. 16) to deterministically exercise the OUT_OF_MEMORY
   * path without relying on system-level memory pressure. Production
   * callers should leave this unset and inherit MAX_OLD_GEN_MB.
   *
   * Note: changing this value forces the next run to spawn a fresh
   * Worker — `resourceLimits` are immutable on a live thread.
   */
  maxOldGenMb?: number;
}

interface WarmWorker {
  worker: Worker;
  /**
   * Resolves once the Worker has finished bootstrapping (WASM init +
   * sandbox scrub). All callers MUST await this before `postMessage`.
   */
  ready: Promise<void>;
  threadId: number;
  /** Old-gen cap this worker was spawned with. */
  maxOldGenMb: number;
  /** Number of runs handled successfully (used by the recycle policy). */
  runCount: number;
  /**
   * Latest worker-level error captured before `exit`. Used by the
   * race-triad: a `message` arriving before `exit` settles cleanly; an
   * `exit` without a prior `message` consults this to map crashes /
   * OOMs into the right RunResult.
   */
  pendingError?: NodeJS.ErrnoException;
  /** Set once exit fires; latches further postMessage attempts to fail. */
  exited: boolean;
  /**
   * Set when the host has decided this worker is no longer the active
   * warm worker (timeout / recycle / explicit recycle). Late `message`
   * events on a dismissed worker must be ignored.
   */
  dismissed: boolean;
  /** Resolved when this worker has fully exited. */
  exitPromise: Promise<void>;
}

let queue: Promise<unknown> = Promise.resolve();
let warmWorker: WarmWorker | undefined;

/** Run a script in the warm worker. Serialized; safe to call concurrently. */
export function run(req: RunRequest, opts: RunnerOptions = {}): Promise<RunResult> {
  const next = queue.then(() => runOnce(req, opts));
  // Keep the chain alive even if a single run rejects.
  queue = next.catch(() => undefined);
  return next;
}

/** Test-only: fully tear down the warm worker. Useful in afterAll() hooks. */
export async function shutdown(): Promise<void> {
  if (!warmWorker) {
    return;
  }
  await dismissWarmWorker(warmWorker);
}

/** Test-only: peek at the warm worker's threadId, or undefined if none. */
export function _currentThreadId(): number | undefined {
  return warmWorker?.threadId;
}

async function runOnce(req: RunRequest, opts: RunnerOptions): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOldGenMb = opts.maxOldGenMb ?? MAX_OLD_GEN_MB;

  // resourceLimits are immutable on a live thread, so a per-call override
  // forces a fresh worker. Tests use this for the OOM path.
  if (warmWorker && warmWorker.maxOldGenMb !== maxOldGenMb) {
    await dismissWarmWorker(warmWorker);
  }

  const active = warmWorker ?? spawnWorker(maxOldGenMb);
  warmWorker = active;

  try {
    await active.ready;
  } catch (err) {
    // Bootstrap failed — surface as crash and clear the warm slot.
    await dismissWarmWorker(active);
    return crashResult(err, maxOldGenMb);
  }

  return new Promise<RunResult>(resolve => {
    let settled = false;
    let pendingMessage: RunResult | undefined;

    const settle = (result: RunResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      active.worker.off('message', onMessage);
      active.worker.off('error', onError);
      active.worker.off('exit', onExit);
      resolve(result);
    };

    const onMessage = (msg: unknown): void => {
      // Ignore late ready signals from a re-bootstrapped worker.
      if (isReadyMessage(msg)) {
        return;
      }
      pendingMessage = msg as RunResult;
      // The race-triad rule says we settle from exit, not message. But
      // for warm workers exit only fires when we recycle / terminate;
      // on a successful run the worker stays alive. Settle on message
      // is safe here because the worker, by contract, only posts ONE
      // RunResult per request and then waits for the next message.
      settle(pendingMessage);
      active.runCount += 1;
      if (active.runCount >= RECYCLE_AFTER_RUNS && !active.dismissed) {
        // Recycle in the background — the queue chain blocks on the
        // returned promise, so the next runOnce will not start until
        // we have torn down and respawned.
        void dismissWarmWorker(active);
      }
    };

    const onError = (err: NodeJS.ErrnoException): void => {
      active.pendingError = err;
      // Worker errored mid-run — let the exit handler decide OOM vs crash.
    };

    const onExit = (code: number): void => {
      active.exited = true;
      // If we already received a message, the run succeeded; the exit
      // is just the worker shutting down (recycle path).
      if (pendingMessage !== undefined) {
        return;
      }
      const errMsg = active.pendingError?.message?.toLowerCase() ?? '';
      const isOomError =
        active.pendingError?.code === 'ERR_WORKER_OUT_OF_MEMORY' ||
        errMsg.includes('out of memory') ||
        errMsg.includes('oom') ||
        errMsg.includes('allocation failed');
      const isOomExitCode = code === 134 || code === 7 || code === 17;
      const oom = isOomError || isOomExitCode;
      const r = emptyReport('runtime');
      if (oom) {
        addError(r, {
          stage: 'runtime',
          code: 'OUT_OF_MEMORY',
          message: `Worker exceeded the ${active.maxOldGenMb} MB old-generation soft cap (exit ${code}${
            active.pendingError ? `; ${active.pendingError.code ?? active.pendingError.name}` : ''
          }).`,
        });
      } else {
        addError(r, {
          stage: 'runtime',
          code: 'WORKER_CRASH',
          message: active.pendingError
            ? `Worker crashed: ${active.pendingError.message}`
            : `Worker exited unexpectedly with code ${code}.`,
        });
      }
      // Worker is dead; clear the warm slot so the next run respawns.
      if (warmWorker === active) {
        warmWorker = undefined;
      }
      active.dismissed = true;
      settle({ report: r });
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      const r = emptyReport('runtime');
      addError(r, {
        stage: 'runtime',
        code: 'TIMEOUT',
        message: `Script execution exceeded ${timeoutMs} ms; possible infinite loop or huge geometry.`,
      });
      r.durationMs = timeoutMs;
      // The worker is wedged inside user code — terminate it. The next
      // run will spawn a fresh one. We MUST settle BEFORE awaiting
      // terminate, otherwise the queue chain stalls; the queue is
      // serialised on the returned Promise resolution.
      void dismissWarmWorker(active);
      settle({ report: r });
    }, timeoutMs);

    active.worker.on('message', onMessage);
    active.worker.once('error', onError);
    active.worker.once('exit', onExit);

    if (active.exited) {
      // Worker died between `await ready` and now (rare but possible
      // under heavy load). Treat as crash — exit handler will not fire
      // again so we synthesise the result.
      const r = emptyReport('runtime');
      addError(r, {
        stage: 'runtime',
        code: 'WORKER_CRASH',
        message: 'Warm worker exited before request could be posted.',
      });
      if (warmWorker === active) {
        warmWorker = undefined;
      }
      settle({ report: r });
      return;
    }

    active.worker.postMessage(req);
  });
}

function spawnWorker(maxOldGenMb: number): WarmWorker {
  const w = new Worker(WORKER_PATH, {
    resourceLimits: {
      maxOldGenerationSizeMb: maxOldGenMb,
    },
    stderr: false,
    stdout: false,
  });
  const exitPromise = new Promise<void>(resolve => {
    w.once('exit', () => resolve());
  });
  const wrapper: WarmWorker = {
    worker: w,
    threadId: w.threadId,
    maxOldGenMb,
    runCount: 0,
    exited: false,
    dismissed: false,
    exitPromise,
    ready: Promise.resolve(), // placeholder, replaced below
  };

  wrapper.ready = new Promise<void>((resolve, reject) => {
    const onReady = (msg: unknown): void => {
      if (isReadyMessage(msg)) {
        w.off('message', onReady);
        w.off('error', onBootstrapError);
        w.off('exit', onBootstrapExit);
        resolve();
      }
    };
    const onBootstrapError = (err: Error): void => {
      wrapper.pendingError = err as NodeJS.ErrnoException;
      reject(err);
    };
    const onBootstrapExit = (code: number): void => {
      wrapper.exited = true;
      reject(new Error(`Worker exited during bootstrap with code ${code}`));
    };
    w.on('message', onReady);
    w.once('error', onBootstrapError);
    w.once('exit', onBootstrapExit);
  });

  return wrapper;
}

async function dismissWarmWorker(w: WarmWorker): Promise<void> {
  if (warmWorker === w) {
    warmWorker = undefined;
  }
  if (w.dismissed) {
    return;
  }
  w.dismissed = true;
  try {
    await w.worker.terminate();
  } catch {
    // worker may already be dead.
  }
  // Wait for exit to fully fire so the next spawn cannot race.
  await w.exitPromise.catch(() => undefined);
}

function isReadyMessage(msg: unknown): boolean {
  return typeof msg === 'object' && msg !== null && (msg as { ready?: unknown }).ready === true;
}

function crashResult(err: unknown, maxOldGenMb: number): RunResult {
  const r = emptyReport('runtime');
  const message = err instanceof Error ? err.message : String(err);
  // Heuristic: bootstrap-time failures dominated by OOM use the same
  // signal the in-run path uses. (RunnerOptions.maxOldGenMb is named
  // for callers; it is the soft cap, not a hard ceiling.)
  const lower = message.toLowerCase();
  if (
    lower.includes('out of memory') ||
    lower.includes('oom') ||
    lower.includes('allocation failed') ||
    (err as NodeJS.ErrnoException | undefined)?.code === 'ERR_WORKER_OUT_OF_MEMORY'
  ) {
    addError(r, {
      stage: 'runtime',
      code: 'OUT_OF_MEMORY',
      message: `Worker bootstrap exceeded the ${maxOldGenMb} MB old-generation soft cap.`,
    });
  } else {
    addError(r, {
      stage: 'runtime',
      code: 'WORKER_CRASH',
      message: `Worker bootstrap failed: ${message}`,
    });
  }
  return { report: r };
}

export type { MeshPayload, RunRequest, RunResult };
export type { Report };
