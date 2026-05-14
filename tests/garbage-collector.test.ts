import { describe, expect, it } from 'vitest';

import {
  cleanup,
  garbageCollectInstance,
  getLastCleanupDeleteFailures,
} from '../src/server/sandbox/garbage-collector.js';

describe('garbage-collector MNT-6 delete failure tracking', () => {
  it('reports zero failures when all deletes succeed', () => {
    let calls = 0;
    garbageCollectInstance({
      delete() {
        calls++;
      },
    });
    garbageCollectInstance({
      delete() {
        calls++;
      },
    });
    cleanup();
    expect(calls).toBe(2);
    expect(getLastCleanupDeleteFailures()).toBe(0);
  });

  it('counts swallowed errors thrown from delete()', () => {
    garbageCollectInstance({
      delete() {
        throw new Error('boom-1');
      },
    });
    garbageCollectInstance({
      delete() {
        throw new Error('boom-2');
      },
    });
    garbageCollectInstance({
      delete() {
        // success path mixed in
      },
    });
    cleanup();
    expect(getLastCleanupDeleteFailures()).toBe(2);
  });

  it('counts failures inside arrays (e.g. decompose() / split() results)', () => {
    const arr = [
      {
        delete() {
          throw new Error('arr-fail');
        },
      },
      {
        delete() {
          /* ok */
        },
      },
    ];
    garbageCollectInstance(arr);
    cleanup();
    expect(getLastCleanupDeleteFailures()).toBe(1);
  });

  it('resets the counter at the start of every cleanup() call', () => {
    garbageCollectInstance({
      delete() {
        throw new Error('first-pass');
      },
    });
    cleanup();
    expect(getLastCleanupDeleteFailures()).toBe(1);

    // Second pass: only successful deletes should reset the counter to 0.
    garbageCollectInstance({
      delete() {
        /* ok */
      },
    });
    cleanup();
    expect(getLastCleanupDeleteFailures()).toBe(0);
  });

  it('tolerates objects without a delete() method', () => {
    garbageCollectInstance({});
    garbageCollectInstance({ unrelated: 1 });
    cleanup();
    expect(getLastCleanupDeleteFailures()).toBe(0);
  });
});
