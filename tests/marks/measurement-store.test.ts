import { describe, expect, it } from 'vitest';
import type { MeasurementEvidence } from '../../packages/protocol/src/wire/measurements.js';
import { AnnotationStore } from '../../packages/viewer/src/marks/annotation-store.js';

function evidence(): MeasurementEvidence {
  return {
    kind: 'relation',
    operands: [
      { kind: 'point', position: [0, 0, 0] },
      { kind: 'point', position: [3, 4, 0] },
    ],
    distance: { method: 'point-point', unit: 'mm', value: 5, start: [0, 0, 0], end: [3, 4, 0] },
  };
}

describe('measurement annotations', () => {
  it.each(['attach', 'send'] as const)(
    'keeps direct %s ownership separate from a concurrently submitted note batch',
    delivery => {
      const store = new AnnotationStore();
      const direct = store.addMeasurement(evidence(), [1.5, 2, 0]);
      const batched = store.addMeasurement(evidence(), [1.5, 2, 0]);
      store.updateMeasurementNote(direct.id, 'direct');
      store.updateMeasurementNote(batched.id, 'batch');
      store.setMeasurementState(direct.id, 'draft', 'pending');
      const batch = store.getDraftBatch();
      expect(batch.annotationIds).toEqual([batched.id]);
      store.sealBatch(batch.batchId);
      expect(store.completeMeasurementDelivery(batched.id, delivery)).toBe(false);
      expect(store.setMeasurementState(batched.id, 'pending', 'draft')).toBe(false);
      store.freezeBatch(batch.batchId, delivery);
      expect(store.get(direct.id)).toMatchObject({ state: 'pending', pendingDelivery: 'direct' });
      expect(store.get(direct.id)).not.toHaveProperty(delivery === 'attach' ? 'attachedNote' : 'sentNote');
      expect(store.get(batched.id)).toMatchObject({ state: 'committed' });
      expect(store.get(batched.id)).not.toHaveProperty('pendingDelivery');
      expect(store.completeMeasurementDelivery(direct.id, delivery)).toBe(true);
      expect(store.get(direct.id)).toMatchObject({ state: 'committed' });
      expect(store.get(direct.id)).not.toHaveProperty('pendingDelivery');
    },
  );

  it('does not settle a direct request on Done and restores a failed direct note to the current batch', () => {
    const store = new AnnotationStore();
    const direct = store.addMeasurement(evidence(), [1.5, 2, 0]);
    const local = store.addMeasurement(evidence(), [1.5, 2, 0]);
    store.updateMeasurementNote(direct.id, 'restore me');
    store.updateMeasurementNote(local.id, 'done locally');
    store.setMeasurementState(direct.id, 'draft', 'pending');
    store.freezeBatch(store.getDraftBatch().batchId);
    expect(store.get(direct.id)?.state).toBe('pending');
    store.setMeasurementState(direct.id, 'pending', 'draft');
    const restored = store.getDraftBatch();
    expect(restored.annotationIds).toEqual([direct.id]);
    store.cancelBatch(restored.batchId);
    expect(store.get(direct.id)).toMatchObject({ note: '', measurement: evidence() });
    expect(store.get(local.id)).toMatchObject({ state: 'committed', note: 'done locally' });
  });

  it('restores only batch-owned pending notes when a mixed delivery fails', () => {
    const store = new AnnotationStore();
    const direct = store.addMeasurement(evidence(), [1.5, 2, 0]);
    const batched = store.addMeasurement(evidence(), [1.5, 2, 0]);
    store.updateMeasurementNote(direct.id, 'direct');
    store.updateMeasurementNote(batched.id, 'batch');
    store.setMeasurementState(direct.id, 'draft', 'pending');
    const batch = store.getDraftBatch();
    store.sealBatch(batch.batchId);
    store.restoreBatch(batch.batchId);
    expect(store.getDraftBatch().annotationIds).toEqual([batched.id]);
    expect(store.get(direct.id)).toMatchObject({ state: 'pending', pendingDelivery: 'direct' });
    expect(store.get(batched.id)).not.toHaveProperty('pendingDelivery');
  });

  it('counts saved measurement comments alongside ordinary notes but excludes plain dimensions', () => {
    const store = new AnnotationStore();
    const measured = store.addMeasurement(evidence(), [1.5, 2, 0]);
    const plain = store.addMeasurement(evidence(), [1.5, 2, 0]);
    const ordinary = store.addComment({
      kind: 'point',
      worldCoord: [0, 0, 0],
      anchorWorld: [0, 0, 0],
      triIds: [],
      note: 'ordinary',
    });
    store.updateMeasurementNote(measured.id, 'Change this length');
    expect(store.getDraftBatch().annotationIds).toEqual([measured.id, ordinary.id]);
    expect(store.getDraftBatch().annotationIds).not.toContain(plain.id);
    store.freezeBatch(store.getDraftBatch().batchId);
    expect(store.getDraftBatch().annotationIds).toEqual([]);
    expect(store.get(measured.id)).toMatchObject({ state: 'committed', note: 'Change this length' });
    expect(store.get(measured.id)).not.toHaveProperty('commentBase');
    expect(store.get(plain.id)).toBe(plain);
  });

  it('cancels measurement notes without removing dimensions and restores a previously attached note', () => {
    const store = new AnnotationStore();
    const newNote = store.addMeasurement(evidence(), [1.5, 2, 0]);
    const attached = store.addMeasurement(evidence(), [1.5, 2, 0]);
    store.updateMeasurementNote(attached.id, 'attached original');
    store.setMeasurementState(attached.id, 'draft', 'pending');
    store.completeMeasurementDelivery(attached.id, 'attach');
    const snapshot = store.get(attached.id);
    store.updateMeasurementNote(attached.id, 'edited draft');
    store.updateMeasurementNote(newNote.id, 'new comment');
    const ordinary = store.addComment({
      kind: 'point',
      worldCoord: [0, 0, 0],
      anchorWorld: [0, 0, 0],
      triIds: [],
      note: 'remove me',
    });
    store.cancelBatch(store.getDraftBatch().batchId);
    expect(store.get(newNote.id)).toMatchObject({ intent: 'measurement', note: '', measurement: evidence() });
    expect(store.get(attached.id)).toEqual(snapshot);
    expect(store.get(ordinary.id)).toBeUndefined();
    expect(store.getDraftBatch().annotationIds).toEqual([]);
  });

  it('restores failed mixed batches and adds delivery receipts only to submitted measurement notes', () => {
    const store = new AnnotationStore();
    const item = store.addMeasurement(evidence(), [1.5, 2, 0]);
    store.updateMeasurementNote(item.id, 'submit this');
    const batch = store.getDraftBatch();
    store.sealBatch(batch.batchId);
    const later = store.addMeasurement(evidence(), [1.5, 2, 0]);
    store.updateMeasurementNote(later.id, 'later draft');
    expect(store.restoreBatch(batch.batchId)).toBe(true);
    expect(store.getDraftBatch().annotationIds).toEqual([item.id, later.id]);
    const retry = store.getDraftBatch();
    store.sealBatch(retry.batchId);
    store.freezeBatch(retry.batchId, 'attach');
    expect(store.get(item.id)).toMatchObject({ state: 'committed', attachedNote: 'submit this' });
    expect(store.get(later.id)).toMatchObject({ state: 'committed', attachedNote: 'later draft' });
    store.updateMeasurementNote(item.id, '');
    expect(store.getDraftBatch().annotationIds).toEqual([]);
    expect(store.get(item.id)).toMatchObject({ note: '', attachedNote: 'submit this' });
  });

  it('replaces only untouched draft geometry while retaining the measurement identity', () => {
    const store = new AnnotationStore();
    const original = store.addMeasurement(evidence(), [1.5, 2, 0]);
    const replacement: MeasurementEvidence = {
      kind: 'relation',
      operands: [
        { kind: 'point', position: [0, 0, 0] },
        { kind: 'point', position: [0, 0, 10] },
      ],
      distance: { method: 'point-point', unit: 'mm', value: 10, start: [0, 0, 0], end: [0, 0, 10] },
    };
    expect(store.replaceMeasurement(original.id, replacement, [0, 0, 5])).toBe(true);
    expect(store.list()).toHaveLength(1);
    expect(store.get(original.id)).toMatchObject({
      displayNumber: original.displayNumber,
      measurement: { distance: { value: 10 } },
      anchorWorld: [0, 0, 5],
    });
    store.updateMeasurementNote(original.id, 'keep my instruction');
    expect(store.replaceMeasurement(original.id, evidence(), [1.5, 2, 0])).toBe(false);
    store.setMeasurementState(original.id, 'draft', 'pending');
    expect(store.replaceMeasurement(original.id, evidence(), [1.5, 2, 0])).toBe(false);
  });

  it('retains empty notes without mixing measurements into comment transactions', () => {
    const store = new AnnotationStore();
    const batch = store.getDraftBatch();
    const item = store.addMeasurement(evidence(), [1.5, 2, 0]);
    expect(item).toMatchObject({ intent: 'measurement', kind: 'measurement', state: 'draft', note: '' });
    expect(store.getDraftBatch()).toEqual(batch);
    store.cancelBatch(batch.batchId);
    expect(store.get(item.id)).toBe(item);
    expect(store.update(item.id, { note: 'not a comment' })).toBe(false);
    expect(store.updateMeasurementNote(item.id, 'make this 6 mm')).toBe(true);
    expect(store.get(item.id)?.note).toBe('make this 6 mm');
  });

  it('copies and freezes geometric evidence, leaving caller data mutable', () => {
    const store = new AnnotationStore();
    const input = evidence();
    const item = store.addMeasurement(input, [1.5, 2, 0]);
    expect(Object.isFrozen(item.measurement)).toBe(true);
    expect(Object.isFrozen(item.measurement.operands[0])).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    input.distance!.value = 999;
    expect(item.measurement.distance?.value).toBe(5);
  });

  it('guards attachment, restores failed results and keeps attached evidence immutable', () => {
    const store = new AnnotationStore();
    const item = store.addMeasurement(evidence(), [1.5, 2, 0]);
    expect(store.setMeasurementState(item.id, 'draft', 'pending')).toBe(true);
    expect(store.setMeasurementState(item.id, 'draft', 'pending')).toBe(false);
    expect(store.updateMeasurementNote(item.id, 'too late')).toBe(false);
    expect(store.removeMeasurement(item.id)).toBe(false);
    expect(store.setMeasurementState(item.id, 'pending', 'draft')).toBe(true);
    expect(store.updateMeasurementNote(item.id, '')).toBe(true);
    expect(store.setMeasurementState(item.id, 'draft', 'pending')).toBe(true);
    expect(store.setMeasurementState(item.id, 'pending', 'committed')).toBe(true);
    const attached = store.get(item.id)!;
    expect(store.updateMeasurementNote(item.id, 'new draft after attachment')).toBe(true);
    expect(attached.note).toBe('');
    expect(store.get(item.id)).toMatchObject({ note: 'new draft after attachment', state: 'draft' });
    expect(store.removeMeasurement(item.id)).toBe(true);
  });

  it('clears measurements only for a different model version and rejects late transitions', () => {
    const store = new AnnotationStore();
    store.setModelVersion('a');
    const item = store.addMeasurement(evidence(), [1.5, 2, 0]);
    store.setMeasurementState(item.id, 'draft', 'pending');
    store.setModelVersion('a');
    expect(store.get(item.id)).toBeDefined();
    store.setModelVersion('b');
    expect(store.get(item.id)).toBeUndefined();
    expect(store.setMeasurementState(item.id, 'pending', 'committed')).toBe(false);
    expect(store.getDraftBatch().annotationIds).toEqual([]);
  });
});
