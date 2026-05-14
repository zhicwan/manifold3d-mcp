import type { Annotation, AnnotationKind } from './types.js';

type Listener = (annotations: Annotation[]) => void;

/**
 * In-memory store for the viewer's active annotations, with a small
 * pub/sub interface so the sidebar, marker layer, and (in M2) the
 * WS uplink can all stay in sync without explicit wiring.
 *
 * The store is intentionally minimal: no undo stack, no persistence.
 * M1 keeps annotations only for the lifetime of the page.
 */
export class AnnotationStore {
  private readonly items = new Map<string, Annotation>();
  private readonly listeners = new Set<Listener>();
  private seqByKind: Record<AnnotationKind, number> = { point: 0, region: 0 };
  private modelVersion = 'unknown';
  private snapshot: Annotation[] = [];

  /** Replace every annotation with the empty set; used on new model push. */
  clear(): void {
    if (this.items.size === 0) {
      return;
    }
    this.items.clear();
    this.seqByKind = { point: 0, region: 0 };
    this.emit();
  }

  /** Update model version and clear stale annotations. */
  setModelVersion(v: string): void {
    if (this.modelVersion === v) {
      return;
    }
    this.modelVersion = v;
    this.clear();
  }

  getModelVersion(): string {
    return this.modelVersion;
  }

  add(input: Omit<Annotation, 'id' | 'createdAt' | 'modelVersion' | 'partLabel'> & { partLabel?: string }): Annotation {
    const seq = ++this.seqByKind[input.kind];
    const partLabel = input.partLabel && input.partLabel.length > 0 ? input.partLabel : `${input.kind}#${seq}`;
    const ann: Annotation = {
      id: `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
      modelVersion: this.modelVersion,
      ...input,
      partLabel,
    };
    this.items.set(ann.id, ann);
    this.emit();
    return ann;
  }

  update(id: string, patch: Partial<Pick<Annotation, 'note'>>): void {
    const cur = this.items.get(id);
    if (!cur) {
      return;
    }
    this.items.set(id, { ...cur, ...patch });
    this.emit();
  }

  remove(id: string): void {
    if (this.items.delete(id)) {
      this.emit();
    }
  }

  get(id: string): Annotation | undefined {
    return this.items.get(id);
  }

  list(): Annotation[] {
    return this.snapshot;
  }

  size(): number {
    return this.items.size;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.list());
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.snapshot = [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt);
    const snap = this.snapshot;
    for (const fn of this.listeners) {
      fn(snap);
    }
  }
}
