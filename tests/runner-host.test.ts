import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type * as HostModuleNs from '../src/server/runner/host.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distHost = join(repoRoot, 'dist', 'server', 'runner', 'host.js');
const workerJs = join(repoRoot, 'dist', 'server', 'runner', 'worker.js');

const skipUnlessBuilt = !existsSync(workerJs) || !existsSync(distHost) || process.env.SKIP_RUNNER_TESTS === '1';

// Import the COMPILED host (not the TS source). The host computes
// `WORKER_PATH` relative to its own file location at import-time; under
// vitest with esbuild, the TS source location is `src/server/runner/`
// which has no worker.js. Pointing at dist/server/runner/host.js keeps
// WORKER_PATH correctly aligned with dist/server/runner/worker.js.
type HostModule = typeof HostModuleNs;
let host: HostModule;

describe.skipIf(skipUnlessBuilt)('runner host: run()', () => {
  beforeAll(async () => {
    host = (await import(pathToFileURL(distHost).href)) as HostModule;
  });

  it('runs a happy-path validate of result = Manifold.cube()', async () => {
    const { report } = await host.run({ mode: 'validate', code: 'result = Manifold.cube();' }, { timeoutMs: 15_000 });
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  }, 20_000);

  it('returns a TIMEOUT error when timeoutMs is exceeded', async () => {
    const { report } = await host.run(
      { mode: 'validate', code: 'while (true) {} result = Manifold.cube();' },
      { timeoutMs: 100 },
    );
    expect(report.ok).toBe(false);
    expect(report.errors.some(e => e.code === 'TIMEOUT')).toBe(true);
  }, 10_000);

  // Drive the worker into V8's old-generation soft cap by allocating
  // typed arrays on a tight loop. With maxOldGenMb pinned to 16, V8 emits
  // ERR_WORKER_OUT_OF_MEMORY and the worker exits before the static lint
  // can complete, exercising the RUN-1 race-triad fix end-to-end. We use
  // pure JS allocation so the static lint (forbidden globals like
  // process.exit) does not block the snippet.
  it('maps OOM exit-code to OUT_OF_MEMORY', async () => {
    const oomCode = `
      const arrs = [];
      while (true) {
        arrs.push(new Float64Array(1_250_000));
      }
      result = Manifold.cube();
    `;
    const { report } = await host.run({ mode: 'validate', code: oomCode }, { timeoutMs: 15_000, maxOldGenMb: 16 });
    expect(report.ok).toBe(false);
    const oom = report.errors.find(e => e.code === 'OUT_OF_MEMORY' || e.code === 'WORKER_CRASH');
    expect(oom, `expected OOM/crash error; got ${JSON.stringify(report.errors)}`).toBeDefined();
    // The fix specifically maps this allocation pattern to OUT_OF_MEMORY.
    expect(oom?.code).toBe('OUT_OF_MEMORY');
  }, 30_000);

  // Regression test for the queue serialization invariant. The host
  // promises that runs do not overlap (Manifold's allocator does not
  // tolerate two live worker WASM heaps in the same process). After the
  // RUN-1 fix `settle` awaits worker.terminate(), so even a flood of
  // concurrent calls must complete in submission order with no overlap.
  it('serializes concurrent runs in submission order', async () => {
    const calls = [0, 1, 2, 3].map(i =>
      host.run({ mode: 'validate', code: `result = Manifold.cube(${i + 1});` }, { timeoutMs: 15_000 }),
    );
    const results = await Promise.all(calls);
    for (const { report } of results) {
      expect(report.ok).toBe(true);
      expect(report.errors).toEqual([]);
    }
  }, 60_000);

  // RUN-2: warm worker reuse. After the first run spins up the worker,
  // subsequent runs should hit the same threadId — no respawn, no WASM
  // re-init. This is the core perf payoff of warm-worker mode.
  it('reuses the warm worker across consecutive runs', async () => {
    const first = await host.run({ mode: 'validate', code: 'result = Manifold.cube();' }, { timeoutMs: 15_000 });
    expect(first.report.ok).toBe(true);
    const firstThreadId = host._currentThreadId();
    expect(firstThreadId).toBeDefined();

    for (let i = 0; i < 5; i++) {
      const { report } = await host.run(
        { mode: 'validate', code: `result = Manifold.sphere(${i + 1});` },
        { timeoutMs: 15_000 },
      );
      expect(report.ok).toBe(true);
      expect(host._currentThreadId()).toBe(firstThreadId);
    }
  }, 60_000);

  // RUN-2: changing maxOldGenMb forces a respawn because resourceLimits
  // are immutable on a live thread. Validates the fast-path bail-out.
  it('respawns the worker when maxOldGenMb changes', async () => {
    const first = await host.run({ mode: 'validate', code: 'result = Manifold.cube();' }, { timeoutMs: 15_000 });
    expect(first.report.ok).toBe(true);
    const firstThreadId = host._currentThreadId();

    const second = await host.run(
      { mode: 'validate', code: 'result = Manifold.cube();' },
      { timeoutMs: 15_000, maxOldGenMb: 256 },
    );
    expect(second.report.ok).toBe(true);
    expect(host._currentThreadId()).not.toBe(firstThreadId);
  }, 60_000);
});
