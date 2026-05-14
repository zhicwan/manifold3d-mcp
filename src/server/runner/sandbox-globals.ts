/**
 * Sandbox global scrub (SEC-1).
 *
 * The runner worker is a regular Node `worker_threads` Worker, so it
 * inherits the full Node global surface (process, require, Buffer,
 * module, __dirname, __filename) at startup. We delete those bindings
 * from `globalThis` and freeze the base prototypes (`Object`, `Array`,
 * `Function`) so user snippets can't:
 *
 *   * reach the host filesystem / spawn child processes (`process`,
 *     `require('child_process')`),
 *   * synthesize Node typed-array views over arbitrary memory
 *     (`Buffer.alloc`, `SharedArrayBuffer`),
 *   * monkey-patch `Object.prototype.hasOwnProperty` etc. and poison
 *     other runs that share this warm worker.
 *
 * Lifecycle (CRITICAL — do not reorder relative to bootstrap()):
 *
 *   1. Module-load: `worker.ts` captures trusted refs (setImmediate,
 *      stderr.write) BEFORE this scrub runs, otherwise it cannot get
 *      them back after `process` is gone.
 *   2. Bootstrap: WASM init + Embind class registration + feature
 *      recognition install must run BEFORE the scrub. Embind probes the
 *      global namespace for some symbols at registration time, and our
 *      feature-recognition patches read the freshly registered
 *      `CrossSection.prototype` — both rely on globals the scrub will
 *      remove.
 *   3. Scrub: call `scrubSandboxGlobals()` once. The deletions persist
 *      for the lifetime of the worker, so all subsequent runs (the
 *      RUN-2 warm-worker reuse path) inherit the scrubbed realm.
 *   4. Per-request: do nothing — there is no per-run scrub state.
 *
 * The runner host recycles the warm worker after a fixed number of
 * runs, at which point a fresh module load re-runs steps 1-3 in a new
 * thread.
 *
 * Tests: tests/security/sandbox-escape.test.ts is the regression net
 * for this module's correctness. If you change the scrub list, run
 * that suite — silent removals would re-open known escape paths.
 */

const SCRUB_NAMES: readonly string[] = ['process', 'require', 'Buffer', 'module', '__dirname', '__filename'];

/**
 * Remove the host-capability bindings from the worker's global scope and
 * freeze the prototypes user code might want to mutate. Idempotent —
 * safe to call multiple times, though only the first call has any
 * effect.
 *
 * Must run AFTER WASM init + feature-recognition install (see lifecycle
 * comment above).
 */
export function scrubSandboxGlobals(): void {
  const scrubTarget = globalThis as Record<string, unknown>;
  for (const name of SCRUB_NAMES) {
    try {
      delete scrubTarget[name];
    } catch {
      scrubTarget[name] = undefined;
    }
  }
  Object.freeze(Object.prototype);
  Object.freeze(Function.prototype);
  Object.freeze(Array.prototype);
}
