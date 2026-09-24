import { MAX_ANNOTATION_NOTE_LENGTH } from '@manifold3d/protocol/wire/annotations.js';
import {
  parseMeasurementEvidence,
  type MeasurementEvidence,
  type MeasurementVec3,
} from '@manifold3d/protocol/wire/measurements.js';

import type {
  Annotation,
  AnnotationKind,
  CommentAnnotation,
  CommentAnnotationInput,
  CommentBatchSnapshot,
  SelectionAnnotation,
  SelectionAnnotationInput,
  MeasurementAnnotation,
} from './types.js';

type Listener = (annotations: readonly Annotation[]) => void;
type BatchNote = CommentAnnotation | MeasurementAnnotation;

/**
 * In-memory transactional store for the viewer's active annotations.
 *
 * Comment annotations accumulate in one active draft batch. Freezing the
 * batch commits every draft atomically and rotates to a fresh batch; cancel
 * removes ordinary drafts and restores measurement notes without deleting
 * dimensions. Direct measurement delivery and selections own their requests.
 */
export class AnnotationStore {
  private readonly items = new Map<string, Annotation>();
  private readonly listeners = new Set<Listener>();
  private seqByKind: Record<AnnotationKind, number> = { point: 0, region: 0, measurement: 0 };
  private idSequence = 0;
  private displaySequence = 0;
  private batchSequence = 0;
  private currentCommentBatchId = this.createBatchId('comments');
  private modelVersion = 'unknown';
  private revision = 0;
  private snapshot: readonly Annotation[] = Object.freeze([]);

  /** Immutable snapshot of the active draft comment transaction. */
  getDraftBatch(): CommentBatchSnapshot {
    return makeBatchSnapshot(this.currentCommentBatchId, this.getDraftNotes(this.currentCommentBatchId));
  }

  /**
   * Commit every draft comment in the active (or explicitly captured) batch.
   * A non-empty successful freeze rotates the active batch.
   */
  freezeBatch(batchId: string, delivery?: 'attach' | 'send'): boolean {
    const comments = this.getBatchNotes(batchId, new Set(['draft', 'pending']));
    if (comments.length === 0) {
      return false;
    }
    for (const comment of comments) {
      this.items.set(
        comment.id,
        comment.intent === 'measurement'
          ? finishMeasurementNote(comment, delivery)
          : freezeAnnotation({ ...comment, state: 'committed' }),
      );
    }
    if (batchId === this.currentCommentBatchId) {
      this.rotateCommentBatch();
    }
    this.commit();
    return true;
  }

  /** Seal the current batch while a host action is in flight and rotate writes. */
  sealBatch(batchId: string): boolean {
    const drafts = this.getDraftNotes(batchId);
    if (drafts.length === 0) {
      return false;
    }
    for (const draft of drafts) {
      this.items.set(
        draft.id,
        freezeAnnotation({
          ...draft,
          state: 'pending',
          ...(draft.intent === 'measurement' ? { pendingDelivery: 'batch' as const } : {}),
        }),
      );
    }
    if (batchId === this.currentCommentBatchId) {
      this.rotateCommentBatch();
    }
    this.commit();
    return true;
  }

  /** Merge a failed sealed batch back into the active editable transaction. */
  restoreBatch(batchId: string): boolean {
    const pending = this.getBatchNotes(batchId, new Set(['pending']));
    if (pending.length === 0) {
      return false;
    }
    for (const comment of pending) {
      const restored = comment.intent === 'measurement' ? withoutPendingDelivery(comment) : comment;
      this.items.set(
        comment.id,
        freezeAnnotation({
          ...restored,
          state: 'draft',
          batchId: this.currentCommentBatchId,
        }),
      );
    }
    this.commit();
    return true;
  }

  /** Cancel a captured batch only if it is still the active draft batch. */
  cancelBatch(batchId: string): boolean {
    if (batchId !== this.currentCommentBatchId) {
      return false;
    }
    const ids = this.getDraftBatch().annotationIds;
    for (const id of ids) {
      const annotation = this.items.get(id);
      if (annotation?.intent === 'measurement' && annotation.commentBase) {
        const { commentBase, ...retained } = annotation;
        this.items.set(id, freezeAnnotation({ ...retained, ...commentBase }));
      } else {
        this.items.delete(id);
      }
    }
    this.rotateCommentBatch();
    if (ids.length > 0) {
      this.commit();
    }
    return true;
  }

  /** Transition one pending selection to committed after attachment succeeds. */
  commitSelection(id: string): boolean {
    const current = this.items.get(id);
    if (!current || current.intent !== 'selection' || current.state !== 'pending') {
      return false;
    }
    const committed: SelectionAnnotation = freezeAnnotation({ ...current, state: 'committed' });
    this.items.set(id, committed);
    this.commit();
    return true;
  }

  /** Remove one pending selection after attachment fails. */
  removeSelection(id: string): boolean {
    const current = this.items.get(id);
    if (!current || current.intent !== 'selection' || current.state !== 'pending') {
      return false;
    }
    this.items.delete(id);
    this.commit();
    return true;
  }

  /** Reset stale annotations only when the host advances to a new model. */
  setModelVersion(v: string): void {
    if (this.modelVersion === v) {
      return;
    }
    this.modelVersion = v;
    this.items.clear();
    this.seqByKind = { point: 0, region: 0, measurement: 0 };
    this.idSequence = 0;
    this.displaySequence = 0;
    this.rotateCommentBatch();
    this.commit();
  }

  getModelVersion(): string {
    return this.modelVersion;
  }

  getRevision(): number {
    return this.revision;
  }

  /**
   * Rebase a reloaded page above the revision retained by Viewer Host.
   * The next local commit will advance beyond this floor.
   */
  rebaseRevision(committedRevision: number): void {
    if (!Number.isSafeInteger(committedRevision) || committedRevision < 0) {
      throw new RangeError('Committed annotation revision must be a nonnegative safe integer.');
    }
    this.revision = Math.max(this.revision, committedRevision);
  }

  /** Create a draft comment in the current transaction batch. */
  addComment(input: CommentAnnotationInput): CommentAnnotation {
    assertNoteLength(input.note);
    const ann: CommentAnnotation = freezeAnnotation({
      ...this.createBase(input),
      kind: input.kind,
      intent: 'comment',
      state: 'draft',
      batchId: this.currentCommentBatchId,
      note: input.note,
    });
    this.items.set(ann.id, ann);
    this.commit();
    return ann;
  }

  /** Create a geometry-only selection awaiting attachment by ViewerCanvas. */
  addSelection(input: SelectionAnnotationInput): SelectionAnnotation {
    const ann: SelectionAnnotation = freezeAnnotation({
      ...this.createBase(input),
      kind: input.kind,
      intent: 'selection',
      state: 'pending',
      batchId: this.createBatchId('selection'),
      note: '',
    });
    this.items.set(ann.id, ann);
    this.commit();
    return ann;
  }

  /** Normal note edits are allowed only for draft comments. */
  update(id: string, patch: Partial<Pick<CommentAnnotation, 'note'>>): boolean {
    const cur = this.items.get(id);
    if (!cur || cur.intent !== 'comment' || cur.state !== 'draft') {
      return false;
    }
    if (patch.note !== undefined) {
      assertNoteLength(patch.note);
    }

    this.items.set(id, freezeAnnotation({ ...cur, ...patch }));
    this.commit();
    return true;
  }

  /** Normal removal cannot mutate committed annotations. */
  remove(id: string): boolean {
    const current = this.items.get(id);
    if (!current || current.intent !== 'comment' || current.state !== 'draft') {
      return false;
    }
    this.items.delete(id);
    this.commit();
    return true;
  }

  get(id: string): Annotation | undefined {
    return this.items.get(id);
  }

  addMeasurement(measurement: MeasurementEvidence, anchor: MeasurementVec3): MeasurementAnnotation {
    const evidence = deepFreeze(parseMeasurementEvidence(measurement));
    const ann: MeasurementAnnotation = freezeAnnotation({
      ...this.createBase(
        {
          kind: 'measurement',
          anchorWorld: anchor,
          worldCoord: anchor,
          triIds: [],
        },
        false,
      ),
      kind: 'measurement',
      intent: 'measurement',
      state: 'draft',
      batchId: this.createBatchId('measurement'),
      note: '',
      measurement: evidence,
    });
    this.items.set(ann.id, ann);
    this.commit();
    return ann;
  }

  updateMeasurementNote(id: string, note: string): boolean {
    const current = this.items.get(id);
    if (current?.intent !== 'measurement' || current.state === 'pending') {
      return false;
    }
    assertNoteLength(note);
    if (current.note === note) {
      return true;
    }
    if (note.trim() === '') {
      const { commentBase, ...retained } = current;
      this.items.set(
        id,
        freezeAnnotation({
          ...retained,
          note,
          state: 'draft',
          batchId: commentBase?.batchId ?? current.batchId,
          displayNumber:
            current.attachedNote === undefined && current.sentNote === undefined
              ? (commentBase?.displayNumber ?? 0)
              : current.displayNumber,
        }),
      );
    } else {
      const displayNumber = current.displayNumber || ++this.displaySequence;
      this.items.set(
        id,
        freezeAnnotation({
          ...current,
          displayNumber,
          note,
          state: 'draft',
          batchId: this.currentCommentBatchId,
          commentBase:
            current.commentBase ??
            Object.freeze({
              note: current.note,
              state: current.state,
              batchId: current.batchId,
              displayNumber: current.displayNumber,
            }),
        }),
      );
    }
    this.commit();
    return true;
  }

  ensureMeasurementDisplayNumber(id: string): number | undefined {
    const current = this.items.get(id);
    if (current?.intent !== 'measurement' || current.state === 'pending') {
      return undefined;
    }
    if (current.displayNumber > 0) {
      return current.displayNumber;
    }
    const displayNumber = ++this.displaySequence;
    this.items.set(id, freezeAnnotation({ ...current, displayNumber }));
    this.commit();
    return displayNumber;
  }

  releaseMeasurementDisplayNumber(id: string): boolean {
    const current = this.items.get(id);
    if (
      current?.intent !== 'measurement' ||
      current.state === 'pending' ||
      current.note.trim() !== '' ||
      current.attachedNote !== undefined ||
      current.sentNote !== undefined ||
      current.displayNumber === 0
    ) {
      return false;
    }
    this.items.set(id, freezeAnnotation({ ...current, displayNumber: 0 }));
    this.commit();
    return true;
  }

  replaceMeasurement(id: string, measurement: MeasurementEvidence, anchor: MeasurementVec3): boolean {
    const current = this.items.get(id);
    if (
      current?.intent !== 'measurement' ||
      current.state !== 'draft' ||
      current.note !== '' ||
      current.attachedNote !== undefined ||
      current.sentNote !== undefined
    ) {
      return false;
    }
    this.items.set(
      id,
      freezeAnnotation({
        ...current,
        measurement: deepFreeze(parseMeasurementEvidence(measurement)),
        anchorWorld: frozenTuple3(anchor),
        worldCoord: frozenTuple3(anchor),
      }),
    );
    this.commit();
    return true;
  }

  setMeasurementState(
    id: string,
    expected: MeasurementAnnotation['state'],
    state: MeasurementAnnotation['state'],
  ): boolean {
    const current = this.items.get(id);
    const validTransition =
      ((expected === 'draft' || expected === 'committed') && state === 'pending') ||
      (expected === 'pending' && (state === 'draft' || state === 'committed'));
    if (
      !validTransition ||
      current?.intent !== 'measurement' ||
      current.state !== expected ||
      (expected === 'pending' && current.pendingDelivery !== 'direct')
    ) {
      return false;
    }
    const next = withoutPendingDelivery(current);
    this.items.set(
      id,
      freezeAnnotation({
        ...next,
        state,
        ...(state === 'pending' ? { pendingDelivery: 'direct' as const } : {}),
        ...(state === 'draft' && current.commentBase ? { batchId: this.currentCommentBatchId } : {}),
      }),
    );
    this.commit();
    return true;
  }

  removeMeasurement(id: string): boolean {
    const current = this.items.get(id);
    if (current?.intent !== 'measurement' || current.state === 'pending') {
      return false;
    }
    this.items.delete(id);
    this.commit();
    return true;
  }

  completeMeasurementDelivery(id: string, kind: 'attach' | 'send'): boolean {
    const current = this.items.get(id);
    if (current?.intent !== 'measurement' || current.state !== 'pending' || current.pendingDelivery !== 'direct') {
      return false;
    }
    this.items.set(
      id,
      finishMeasurementNote(
        current.displayNumber === 0 ? { ...current, displayNumber: ++this.displaySequence } : current,
        kind,
      ),
    );
    this.commit();
    return true;
  }

  list(): readonly Annotation[] {
    return this.snapshot;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => this.listeners.delete(fn);
  }

  private commit(): void {
    this.revision += 1;
    const snapshot = [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt);
    Object.freeze(snapshot);
    this.snapshot = snapshot;
    this.displaySequence = snapshot.reduce((highest, annotation) => Math.max(highest, annotation.displayNumber), 0);
    const snap = this.snapshot;
    for (const fn of this.listeners) {
      fn(snap);
    }
  }

  private createBase(
    input: Omit<SelectionAnnotationInput, 'kind'> & { kind: AnnotationKind },
    allocateDisplayNumber = true,
  ) {
    const seq = ++this.seqByKind[input.kind];
    return {
      id: `ann_${Date.now().toString(36)}_${(++this.idSequence).toString(36)}`,
      createdAt: Date.now(),
      displayNumber: allocateDisplayNumber ? ++this.displaySequence : 0,
      modelVersion: this.modelVersion,
      kind: input.kind,
      anchorWorld: frozenTuple3(input.anchorWorld),
      worldCoord: frozenTuple3(input.worldCoord),
      triIds: frozenNumbers(input.triIds),
      partLabel: input.partLabel && input.partLabel.length > 0 ? input.partLabel : `${input.kind}#${seq}`,
    };
  }

  private getDraftNotes(batchId: string): BatchNote[] {
    return this.getBatchNotes(batchId, new Set(['draft']));
  }

  private getBatchNotes(batchId: string, states: ReadonlySet<CommentAnnotation['state']>): BatchNote[] {
    return this.snapshot
      .filter(
        (annotation): annotation is BatchNote =>
          (annotation.intent === 'comment' ||
            (annotation.intent === 'measurement' &&
              annotation.commentBase !== undefined &&
              (annotation.state !== 'pending' || annotation.pendingDelivery === 'batch') &&
              annotation.note.trim() !== '')) &&
          states.has(annotation.state) &&
          annotation.batchId === batchId,
      )
      .sort((a, b) => a.displayNumber - b.displayNumber);
  }

  private rotateCommentBatch(): void {
    this.currentCommentBatchId = this.createBatchId('comments');
  }

  private createBatchId(intent: 'comments' | 'selection' | 'measurement'): string {
    this.batchSequence += 1;
    return `batch_${intent}_${Date.now().toString(36)}_${this.batchSequence.toString(36)}`;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function assertNoteLength(note: string): void {
  if (note.length > MAX_ANNOTATION_NOTE_LENGTH) {
    throw new RangeError(`Annotation note cannot exceed ${MAX_ANNOTATION_NOTE_LENGTH} characters.`);
  }
}

function makeBatchSnapshot(batchId: string, annotations: readonly BatchNote[]): CommentBatchSnapshot {
  const annotationIds = annotations.map(annotation => annotation.id);
  Object.freeze(annotationIds);
  const snapshot = {
    batchId,
    annotationIds,
  };
  Object.freeze(snapshot);
  return snapshot;
}

function finishMeasurementNote(annotation: MeasurementAnnotation, delivery?: 'attach' | 'send'): MeasurementAnnotation {
  const { commentBase: _base, ...retained } = withoutPendingDelivery(annotation);
  return freezeAnnotation({
    ...retained,
    state: 'committed',
    ...(delivery === 'attach'
      ? { attachedNote: annotation.note }
      : delivery === 'send'
        ? { sentNote: annotation.note }
        : {}),
  });
}

function withoutPendingDelivery(annotation: MeasurementAnnotation): MeasurementAnnotation {
  const { pendingDelivery: _pending, ...retained } = annotation;
  return retained;
}

function freezeAnnotation<T extends Annotation>(annotation: T): T {
  Object.freeze(annotation);
  return annotation;
}

function frozenTuple3(value: readonly [number, number, number]): [number, number, number] {
  const copy: [number, number, number] = [value[0], value[1], value[2]];
  Object.freeze(copy);
  return copy;
}

function frozenNumbers(value: readonly number[]): number[] {
  const copy = [...value];
  Object.freeze(copy);
  return copy;
}
