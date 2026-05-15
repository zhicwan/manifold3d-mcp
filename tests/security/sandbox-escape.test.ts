// SEC-1 regression suite: prove the worker sandbox actually scrubs the
// dangerous Node globals (`require`, `process`, `Buffer`, `module`) and
// freezes built-in prototypes. The static linter (`validators.ts`) already
// rejects literal references to those identifiers, so user code cannot say
// `typeof require` directly. Instead these probes go through the
// `({}).constructor.constructor("...")()` chain — the AST scanner sees only
// a string literal, but the snippet runs inside the same scrubbed scope at
// runtime, which is the surface we care about.

import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type * as HostModuleNs from '../../src/server/runner/host.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const distHost = join(repoRoot, 'dist', 'server', 'runner', 'host.js');
const workerJs = join(repoRoot, 'dist', 'server', 'runner', 'worker.js');

const skipUnlessBuilt = !existsSync(workerJs) || !existsSync(distHost) || process.env.SKIP_RUNNER_TESTS === '1';

type HostModule = typeof HostModuleNs;
let host: HostModule;

// `({}).constructor` is `Object`, and `Object.constructor` is `Function`.
// Calling `Function("body")()` evaluates `body` as code and returns its
// value. We use it to *evaluate the identifier name from a string* so the
// pre-execution AST lint never sees a banned identifier in the source.
const probe = (name: string): string => `
  const probeFn = ({}).constructor.constructor("return typeof " + ${JSON.stringify(name)});
  const observed = probeFn();
  // Branch on whether the global survived the worker scrub. If it did,
  // produce a unit cube (size 1); if it was wiped, produce a 2-cube. The
  // test then asserts the bounding box matches the "scrubbed" branch.
  if (observed === 'undefined') {
    result = Manifold.cube([2, 2, 2], true);
  } else {
    result = Manifold.cube([1, 1, 1], true);
  }
`;

describe.skipIf(skipUnlessBuilt)('SEC-1: worker sandbox scrubs dangerous globals', () => {
  beforeAll(async () => {
    host = (await import(pathToFileURL(distHost).href)) as HostModule;
  });

  for (const ident of ['require', 'process', 'Buffer', 'module']) {
    it(`reports \`typeof ${ident}\` as 'undefined' inside the worker`, async () => {
      const { report } = await host.run({ mode: 'validate', code: probe(ident) }, { timeoutMs: 15_000 });
      expect(report.ok).toBe(true);
      expect(report.errors).toEqual([]);
      // The "scrubbed" branch produced a 2-unit cube. If the identifier
      // had leaked through, we'd see a 1-unit cube, and this would fail.
      expect(report.stats?.bbox?.size?.[0]).toBe(2);
    }, 20_000);
  }

  it('blocks the classic `({}).constructor.constructor("return process")()` escape', async () => {
    // Even though the AST scan does not see the literal identifier, at
    // runtime the inner Function() body references `process`, which has
    // been deleted from the worker scope. The expression therefore throws
    // a ReferenceError and the run reports an error rather than handing
    // back a process handle.
    const code = `
      const escape = ({}).constructor.constructor("return process");
      const proc = escape();
      result = Manifold.cube([proc ? 1 : 2, 1, 1], true);
    `;
    const { report } = await host.run({ mode: 'validate', code }, { timeoutMs: 15_000 });
    if (report.ok) {
      // If the runtime survived, the cube *must* have come from the
      // "no process" branch. Anything else means the escape worked.
      expect(report.stats?.bbox?.size?.[0]).toBe(2);
    } else {
      // The expected outcome under the current scrub is a ReferenceError
      // surfaced as a RUNTIME_ERROR (or similar). Accept any error code so
      // long as the script did NOT successfully obtain a `process` handle.
      expect(report.errors.length).toBeGreaterThan(0);
    }
  }, 20_000);

  it('keeps `Object.prototype` frozen so prototype-pollution attempts fail', async () => {
    // The worker freezes `Object/Function/Array.prototype` before the
    // user script runs. Under the strict-mode wrap that the worker
    // applies to user code, mutating a frozen prototype throws TypeError.
    // The probe catches the throw and treats *that exception* as the
    // success branch — the cube ends up at size 2 only when the freeze
    // really fired. Anything else (silent ignore, runtime crash) leaves
    // the cube at size 1 and the assertion below fails noisily.
    const code = `
      let frozen = false;
      try {
        const proto = Object.prototype as Record<string, unknown>;
        proto['polluted'] = 'pwn';
      } catch {
        frozen = true;
      }
      result = Manifold.cube([frozen ? 2 : 1, 1, 1], true);
    `;
    const { report } = await host.run({ mode: 'validate', code }, { timeoutMs: 15_000 });
    expect(report.ok, JSON.stringify(report.errors)).toBe(true);
    expect(report.stats?.bbox?.size?.[0]).toBe(2);
  }, 20_000);
});
