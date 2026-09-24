import { describe, expect, it } from 'vitest';
import type { MeasurementEvidence } from '../packages/protocol/src/wire/measurements.js';
import { createHelloMessage } from '../packages/protocol/src/wire/model.js';
import {
  createHostActionsManifest,
  createHostActionStatus,
  parseHostActionInvocation,
  type HostActionInvocationMessage,
} from '../packages/protocol/src/wire/host-actions.js';
import { HostActionsClient } from '../packages/viewer/src/host-actions/client.js';
import { createViewerI18n } from '../packages/viewer/src/i18n/index.js';
import { AnnotationStore } from '../packages/viewer/src/marks/annotation-store.js';
import { measurementBadges, measurementLabelAction } from '../packages/viewer/src/measurements/presentation.js';
import { ATTACH_MEASUREMENT, submitMeasurement } from '../packages/viewer/src/measurements/submission.js';

const evidence: MeasurementEvidence = {
  kind: 'edge-length',
  operands: [{ kind: 'edge', edgeId: 'e', start: [0, 0, 0], end: [10, 0, 0] }],
  distance: { method: 'segment-length', unit: 'mm', value: 10, start: [0, 0, 0], end: [10, 0, 0] },
};

function setup() {
  const store = new AnnotationStore();
  store.setModelVersion('v1');
  const measurement = store.addMeasurement(evidence, [5, 0, 0]);
  const requests: HostActionInvocationMessage[] = [];
  const snapshots: unknown[] = [];
  const owner = { current: true };
  const transport = { connected: true, canFlush: true };
  const client = new HostActionsClient({
    send: message => {
      requests.push(parseHostActionInvocation(message));
      snapshots.push(structuredClone(store.get(measurement.id)));
    },
    isOpen: () => transport.connected,
    flushAnnotations: () => transport.canFlush,
    getInvocationContext: () => ({ modelVersion: store.getModelVersion(), annotationRevision: store.getRevision() }),
    createRequestId: () => `request-${requests.length}`,
  });
  client.receiveManifest(
    createHostActionsManifest([
      {
        id: ATTACH_MEASUREMENT,
        label: ATTACH_MEASUREMENT,
        slot: 'measurement-result',
        icon: 'message',
        tone: 'default',
        requires: ['model', 'annotations'],
      },
    ]),
  );
  const submit = () =>
    submitMeasurement({
      id: measurement.id,
      store,
      client,
      i18n: createViewerI18n('en'),
      isCurrent: () => owner.current,
      flush: () => true,
    });
  const complete = (state: 'succeeded' | 'failed') => {
    const request = requests.at(-1)!;
    client.receiveStatus(
      createHostActionStatus({
        requestId: request.requestId,
        actionId: request.actionId,
        state,
        ...(state === 'failed' ? { message: 'Retry this request' } : {}),
      }),
    );
  };
  const current = () => {
    const item = store.get(measurement.id);
    if (item?.intent !== 'measurement') {
      throw new Error('Expected measurement.');
    }
    return item;
  };
  return { store, measurement, client, requests, snapshots, owner, transport, submit, complete, current };
}

describe('measurement mode and delivery separation', () => {
  it('never routes Measure or Orbit clicks into comment editing or attachment', () => {
    expect(measurementLabelAction('measure')).toBe('manage');
    expect(measurementLabelAction('orbit')).toBe('inspect');
    expect(measurementLabelAction('annotate')).toBe('comment');
    expect(measurementLabelAction('select')).toBe('attach');
  });

  it('records attachment separately from comments, and permits edits without mutating prior snapshots', async () => {
    const { store, measurement, requests, snapshots, submit, complete, current } = setup();
    const operation = submit();
    expect(measurementBadges(current())).toMatchObject({ pending: true, attached: false, commented: false });
    complete('succeeded');
    await expect(operation).resolves.toBe('succeeded');
    expect(measurementBadges(current())).toMatchObject({ attached: true, commented: false, attachmentChanged: false });
    store.updateMeasurementNote(measurement.id, 'Make this 12 mm');
    expect(measurementBadges(current())).toMatchObject({ attached: true, commented: true, attachmentChanged: true });
    expect(snapshots[0]).toMatchObject({ note: '' });
    expect(requests).toHaveLength(1);
    const updated = submit();
    complete('succeeded');
    await updated;
    expect(requests).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({ note: 'Make this 12 mm' });
    expect(measurementBadges(current()).attachmentChanged).toBe(false);
    expect(snapshots[0]).toMatchObject({ note: '' });
  });

  it('rejects concurrent delivery and ignores duplicate terminal statuses during the next operation', async () => {
    const { store, measurement, client, requests, submit, complete, current } = setup();
    store.updateMeasurementNote(measurement.id, 'first note');
    const first = submit();
    expect(requests[0]).toMatchObject({
      modelVersion: 'v1',
      annotationRevision: store.getRevision(),
      annotationIds: [measurement.id],
      input: { markerNumbers: [measurement.displayNumber] },
    });
    await expect(submit()).rejects.toThrow(/already/);
    expect(requests).toHaveLength(1);
    complete('succeeded');
    await first;
    const oldStatus = client.getSnapshot().latestStatus!;
    store.updateMeasurementNote(measurement.id, 'second note');
    const second = submit();
    client.receiveStatus(oldStatus);
    await Promise.resolve();
    expect(current()).toMatchObject({ state: 'pending', note: 'second note', attachedNote: 'first note' });
    expect(current()).not.toHaveProperty('attachedNote', 'second note');
    complete('succeeded');
    await second;
    const finished = current();
    client.receiveStatus(oldStatus);
    expect(current()).toBe(finished);
    expect(current()).toMatchObject({ state: 'committed', attachedNote: 'second note' });
    expect(requests).toHaveLength(2);
  });

  it('restores notes after sync failure or lost connection identity, without receipts or extra sends', async () => {
    const { store, measurement, client, requests, transport, submit, current } = setup();
    store.updateMeasurementNote(measurement.id, 'keep for retry');
    transport.canFlush = false;
    await expect(submit()).resolves.toBe('failed');
    expect(current()).toMatchObject({ state: 'draft', note: 'keep for retry' });
    expect(requests).toEqual([]);
    expect(client.getSnapshot().latestStatus).toMatchObject({ state: 'failed', localFailure: 'annotation-sync' });
    transport.canFlush = true;
    const operation = submit();
    const rejected = expect(operation).rejects.toThrow(/identity changed/);
    transport.connected = false;
    client.setConnectionStatus('disconnected');
    expect(current().state).toBe('pending');
    client.receiveHello(createHelloMessage('replacement-client', 'new-token', false));
    await rejected;
    expect(current()).toMatchObject({ state: 'draft', note: 'keep for retry' });
    await expect(submit()).rejects.toThrow(/connect/i);
    expect(requests).toHaveLength(1);
  });

  it('preserves prior receipts and editable notes after failure without falsely adding an attachment badge', async () => {
    const { store, measurement, client, submit, complete, current } = setup();
    store.updateMeasurementNote(measurement.id, 'Keep this note');
    const first = submit();
    const rejected = expect(first).resolves.toBe('failed');
    complete('failed');
    await rejected;
    expect(client.getSnapshot().latestStatus).toMatchObject({ state: 'failed', message: 'Retry this request' });
    expect(current()).toMatchObject({ state: 'draft', note: 'Keep this note' });
    expect(measurementBadges(current()).attached).toBe(false);
    const retry = submit();
    complete('succeeded');
    await retry;
    const repeated = submit();
    const rejectedAgain = expect(repeated).resolves.toBe('failed');
    complete('failed');
    await rejectedAgain;
    expect(current()).toMatchObject({ state: 'committed', attachedNote: 'Keep this note' });
  });

  it.each(['succeeded', 'failed'] as const)(
    'does not apply late %s delivery to a replaced model or runtime',
    async state => {
      for (const replacement of ['model', 'runtime']) {
        const { store, owner, submit, complete, measurement } = setup();
        const operation = submit();
        if (replacement === 'model') {
          store.setModelVersion('v2');
        } else {
          owner.current = false;
        }
        complete(state);
        await expect(operation).resolves.toBe('stale');
        const remaining = store.get(measurement.id);
        if (remaining) {
          expect(remaining).not.toHaveProperty('attachedNote');
        } else {
          expect(replacement).toBe('model');
        }
      }
    },
  );
});
