import * as THREE from 'three';

import type { AnnotationStore } from '../annotation-store.js';
import type { Annotation } from '../types.js';
import { FlyoutController } from './flyout-controller.js';
import { updatePositions as projectFlyouts, type ScreenRect } from './flyout-projection.js';
import { FlyoutView, type FlyoutViewModel } from './flyout-view.js';

/**
 * Top-level flyout subsystem -- the facade that wires together the
 * three concerns the original monolithic `flyout.ts` used to mix:
 *
 *   - {@link FlyoutController} owns the draft state machine (which
 *     annotation is open, what unsaved text each draft holds, the
 *     open/commit/cancel/dismissAll lifecycle).
 *   - {@link FlyoutView} owns each annotation's DOM (template, event
 *     wiring, focus). One view instance per visible annotation.
 *   - {@link updatePositions} (in `flyout-projection.ts`) is the pure
 *     per-frame screen-projection helper.
 *
 * The facade subscribes to the {@link AnnotationStore} to create and
 * dispose views as annotations come and go, and exposes the small
 * public surface the rest of the viewer (mark tool, React controls,
 * `installMarks`) actually needs.
 *
 * We intentionally avoid CSS2DRenderer here: a small bespoke layer is
 * simpler, gives us full control over events (mark gestures should not
 * start when the user clicks inside the flyout), and avoids
 * pulling another three.js addon.
 *
 * Save semantics for draft comments:
 *  - opening a flyout puts focus in the textarea
 *  - clicking outside commits a non-empty draft; Escape cancels the edit
 *  - an empty, never-saved annotation is discarded
 *  - committed comments and selections can be inspected without editing
 */
export class FlyoutLayer {
  private readonly host: HTMLDivElement;
  private readonly views = new Map<string, FlyoutView>();
  private readonly elements = new Map<string, HTMLElement>();
  private readonly numbers = new Map<string, number>();
  private nextNumber = 1;
  private readonly controller: FlyoutController;
  private unsubscribe: (() => void) | null = null;

  /** Cached CSS-pixel dimensions, invalidated by canvas resizing rather than every frame. */
  private readonly screenSize = { x: 0, y: 0 };
  private readonly projectionScratch = new THREE.Vector3();
  private readonly cameraMatrix = new THREE.Matrix4();
  private readonly projectionMatrix = new THREE.Matrix4();
  private projectionDirty = true;
  private layoutDirty = true;
  private obstacles: ScreenRect[] = [];
  private readonly observer: ResizeObserver;
  private readonly onResize = () => {
    this.refreshScreenSize();
    this.invalidateLayout();
  };
  private readonly onPointerDown = () => this.invalidateLayout();

  constructor(
    parent: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly store: AnnotationStore,
    private readonly requestRender: () => void,
    onCommit?: () => void,
    private readonly getMesh: () => THREE.Mesh | null = () => null,
  ) {
    this.host = document.createElement('div');
    this.host.className = 'marks-flyout-layer';
    parent.appendChild(this.host);

    this.controller = new FlyoutController(
      store,
      {
        refresh: id => this.refreshView(id),
        focus: id => this.focusView(id),
        setTextareaValue: (id, value) => {
          const v = this.views.get(id);
          v?.setTextareaValue(value);
        },
      },
      onCommit,
    );

    this.refreshScreenSize();
    this.observer = new ResizeObserver(this.onResize);
    this.observer.observe(canvas);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerdown', this.onPointerDown);
    this.unsubscribe = store.subscribe(items => this.sync(items));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerdown', this.onPointerDown);
    this.observer.disconnect();
    for (const v of this.views.values()) {
      v.dispose();
    }
    this.views.clear();
    this.elements.clear();
    this.host.remove();
  }

  /**
   * Update screen positions for every flyout. Called once per render
   * frame from the viewer loop so labels follow the model.
   */
  updatePositions(): void {
    this.camera.updateMatrixWorld();
    if (
      !this.projectionDirty &&
      this.cameraMatrix.equals(this.camera.matrixWorld) &&
      this.projectionMatrix.equals(this.camera.projectionMatrix)
    ) {
      return;
    }
    if (this.layoutDirty) {
      const canvasRect = this.canvas.getBoundingClientRect();
      const root = this.canvas.closest('[data-viewer-root]') ?? this.canvas.parentElement;
      const obstacles =
        root?.querySelectorAll<HTMLElement>(
          '[data-viewer-obstacle], header, nav, [aria-label="Annotation batch actions"]',
        ) ?? [];
      this.obstacles = [...obstacles]
        .filter(element => !this.host.contains(element))
        .map(element => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.left - canvasRect.left,
            y: rect.top - canvasRect.top,
            width: rect.width,
            height: rect.height,
          };
        });
      this.layoutDirty = false;
    }
    const editorSizes = new Map([...this.views].map(([id, view]) => [id, view.editorSize]));
    projectFlyouts(this.camera, this.store, this.elements, this.screenSize, this.projectionScratch, {
      mesh: this.getMesh(),
      editorSizes,
      obstacles: this.obstacles,
    });
    this.cameraMatrix.copy(this.camera.matrixWorld);
    this.projectionMatrix.copy(this.camera.projectionMatrix);
    this.projectionDirty = false;
  }

  /** Open the flyout for a freshly created annotation in expanded mode. */
  openExpanded(id: string): void {
    this.controller.open(id);
  }

  /** Returns true if the click target is inside any flyout DOM. */
  ownsTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) {
      return false;
    }
    return this.host.contains(target);
  }

  /** Called when the user clicks somewhere outside any flyout. */
  dismissAll(): void {
    this.controller.dismissAll();
  }

  private sync(items: readonly Annotation[]): void {
    const aliveIds = new Set(items.map(a => a.id));
    const editableIds = new Set(
      items
        .filter(annotation => annotation.intent === 'comment' && annotation.state === 'draft')
        .map(annotation => annotation.id),
    );
    for (const [id, v] of this.views) {
      if (!aliveIds.has(id)) {
        v.dispose();
        this.views.delete(id);
        this.elements.delete(id);
      }
    }
    this.controller.syncAlive(aliveIds, editableIds);
    if (items.length === 0) {
      this.numbers.clear();
      this.nextNumber = 1;
    }
    for (const ann of items) {
      if (!this.numbers.has(ann.id)) {
        this.numbers.set(ann.id, this.nextNumber++);
      }
      const existing = this.views.get(ann.id);
      if (existing) {
        existing.setView(this.toViewModel(ann));
      } else {
        const view = new FlyoutView(ann.id, this.toViewModel(ann), {
          onPillClick: () => {
            if (this.controller.getExpandedId() === ann.id) {
              this.controller.commit(ann.id);
            } else {
              this.controller.open(ann.id);
            }
          },
          onInput: value => {
            this.controller.setDraft(ann.id, value);
            const cur = this.store.get(ann.id);
            if (cur) {
              const v = this.views.get(ann.id);
              v?.setView(this.toViewModelWithNote(cur, value));
            }
          },
          onCommit: () => {
            this.controller.commit(ann.id);
            this.canvas.focus({ preventScroll: true });
          },
          onCancel: () => {
            this.controller.cancel(ann.id);
            this.canvas.focus({ preventScroll: true });
          },
          onLayout: () => this.invalidateLayout(),
        });
        this.views.set(ann.id, view);
        this.elements.set(ann.id, view.element);
        this.host.appendChild(view.element);
      }
    }
    this.projectionDirty = true;
    this.layoutDirty = true;
    this.updatePositions();
    this.requestRender();
  }

  private refreshView(id: string): void {
    const view = this.views.get(id);
    const ann = this.store.get(id);
    if (!view || !ann) {
      return;
    }
    view.setView(this.toViewModel(ann));
  }

  private focusView(id: string): void {
    const v = this.views.get(id);
    if (!v) {
      return;
    }
    requestAnimationFrame(() => {
      if (this.views.get(id) === v && this.controller.getExpandedId() === id) {
        v.focusTextarea();
      }
    });
  }

  private toViewModel(ann: Annotation): FlyoutViewModel {
    const draft = this.controller.getDraft(ann.id);
    return this.toViewModelWithNote(ann, draft ?? ann.note);
  }

  private toViewModelWithNote(ann: Annotation, note: string): FlyoutViewModel {
    return {
      partLabel: ann.partLabel,
      note,
      kind: ann.kind,
      expanded: this.controller.getExpandedId() === ann.id,
      readOnly: ann.intent === 'selection' || ann.state !== 'draft',
      number: this.numbers.get(ann.id)!,
      intent: ann.intent,
      state: ann.state,
    };
  }

  private refreshScreenSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.screenSize.x = rect.width;
    this.screenSize.y = rect.height;
  }

  private invalidateLayout(): void {
    this.projectionDirty = true;
    this.layoutDirty = true;
    this.requestRender();
  }
}
