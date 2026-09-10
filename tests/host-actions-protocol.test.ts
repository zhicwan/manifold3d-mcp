import { describe, expect, it } from 'vitest';

import {
  HOST_ACTION_PROTOCOL_VERSION,
  MAX_HOST_ACTION_INPUT_BYTES,
  createHostActionInvocation,
  createHostActionStatus,
  createHostActionsManifest,
  isHostActionInvocation,
  isHostActionStatus,
  isHostActionsManifest,
  isSafeJsonValue,
  parseHostActionInvocation,
  type HostActionDescriptor,
} from '../packages/protocol/src/wire/host-actions.js';

const descriptor: HostActionDescriptor = {
  id: 'send-feedback',
  label: 'Send feedback',
  icon: 'message',
  slot: 'annotation-footer',
  tone: 'primary',
  requires: ['model', 'annotations'],
};

describe('host action wire protocol', () => {
  it('validates bounded typed completion details without interpreting diagnostic text', () => {
    const base = {
      requestId: 'request-1',
      actionId: 'export-stl-file',
      state: 'succeeded' as const,
      message: 'raw diagnostic',
    };
    const saved = createHostActionStatus({ ...base, resultDetails: { kind: 'stl-saved', path: '/exports/模型.stl' } });
    expect(saved.resultDetails).toEqual({ kind: 'stl-saved', path: '/exports/模型.stl' });
    expect(saved.message).toBe('raw diagnostic');
    expect(
      createHostActionStatus({
        ...base,
        resultDetails: { kind: 'annotations-attached', count: 2 },
      }).resultDetails,
    ).toEqual({ kind: 'annotations-attached', count: 2 });
    for (const resultDetails of [
      { kind: 'annotations-attached', count: -1 },
      { kind: 'annotations-attached', count: 129 },
      { kind: 'annotations-attached', count: 1.5 },
      { kind: 'stl-saved', path: '' },
      { kind: 'stl-saved', path: 'x'.repeat(513) },
      { kind: 'stl-saved', path: '/model.stl', url: 'https://example.com' },
      { kind: 'unknown' },
    ]) {
      expect(isHostActionStatus({ ...saved, resultDetails })).toBe(false);
    }
    expect(isHostActionStatus({ ...saved, state: 'running' })).toBe(false);
  });

  it('accepts versioned safe descriptors, invocations, and statuses', () => {
    const manifest = createHostActionsManifest([
      descriptor,
      { ...descriptor, id: 'batch', slot: 'annotation-batch' },
      { ...descriptor, id: 'selection', slot: 'selection-gesture' },
      { ...descriptor, id: 'export-handler', slot: 'export-handler' },
    ]);
    const invocation = createHostActionInvocation({
      requestId: 'request-1',
      actionId: descriptor.id,
      modelVersion: 'v1',
      annotationRevision: 3,
      annotationIds: ['ann-1'],
      input: { prompt: 'Please revise', count: 1, flags: [true, null] },
    });
    const status = createHostActionStatus({
      requestId: 'request-1',
      actionId: descriptor.id,
      state: 'running',
      operationId: 'operation-1',
      message: 'Working',
    });

    expect(manifest.protocolVersion).toBe(HOST_ACTION_PROTOCOL_VERSION);
    expect(isHostActionsManifest(manifest)).toBe(true);
    expect(isHostActionInvocation(invocation)).toBe(true);
    expect(isHostActionStatus(status)).toBe(true);
  });

  it('rejects executable/remote descriptor fields and unknown enums', () => {
    expect(
      isHostActionsManifest({ ...createHostActionsManifest([]), actions: [{ ...descriptor, url: 'https://x' }] }),
    ).toBe(false);
    expect(
      isHostActionsManifest({ ...createHostActionsManifest([]), actions: [{ ...descriptor, icon: 'custom-svg' }] }),
    ).toBe(false);
    expect(
      isHostActionsManifest({
        ...createHostActionsManifest([]),
        actions: [{ ...descriptor, render: '<button onclick="x()">x</button>' }],
      }),
    ).toBe(false);
  });

  it('rejects unsafe JSON, dangerous keys, cycles, and oversized input', () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    expect(isSafeJsonValue(cycle)).toBe(false);
    expect(isSafeJsonValue({ value: Number.NaN })).toBe(false);
    expect(isSafeJsonValue(Object.create({ inherited: true }))).toBe(false);
    expect(isSafeJsonValue(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe(false);

    expect(() =>
      parseHostActionInvocation({
        kind: 'host_action_invoke',
        protocolVersion: HOST_ACTION_PROTOCOL_VERSION,
        requestId: 'request-1',
        actionId: descriptor.id,
        modelVersion: 'v1',
        annotationRevision: 0,
        input: 'x'.repeat(MAX_HOST_ACTION_INPUT_BYTES + 1),
      }),
    ).toThrow(/safe JSON/);
  });

  it('rejects missing versions, room identity, duplicate ids, and invalid revisions', () => {
    expect(isHostActionInvocation({ kind: 'host_action_invoke' })).toBe(false);
    expect(
      isHostActionInvocation({
        ...createHostActionInvocation({
          requestId: 'request-1',
          actionId: descriptor.id,
          modelVersion: 'v1',
          annotationRevision: 0,
        }),
        roomId: 'untrusted-room',
      }),
    ).toBe(false);
    expect(
      isHostActionInvocation({
        ...createHostActionInvocation({
          requestId: 'request-1',
          actionId: descriptor.id,
          modelVersion: 'v1',
          annotationRevision: 0,
        }),
        annotationRevision: -1,
      }),
    ).toBe(false);
    expect(isHostActionsManifest({ ...createHostActionsManifest([]), actions: [descriptor, descriptor] })).toBe(false);
  });
});
