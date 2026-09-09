import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { isViewerShortcutEvent } from '../lib/keyboard.js';
import type { AnnotationStore } from './annotation-store.js';
import type { FeatureResolver } from './feature-resolver.js';
import { eventToNdc, pickPoint, pickRegion } from './picker.js';
import type { FlyoutLayer } from './flyout/index.js';
import type { AnnotationGeometryInput, MarkMode } from './types.js';

/**
 * Marking takes only the primary pointer. OrbitControls still tracks pointers
 * and owns capture, wheel, middle/right pan and two-finger navigation; disabling
 * its LEFT/ONE mapping avoids two tools handling the same gesture.
 */
export class MarkTool {
  private readonly rubberBand: HTMLDivElement;
  private readonly targetPreview: HTMLDivElement;
  private readonly root: HTMLElement;
  private readonly pointers = new Set<number>();
  private readonly originalLeft: OrbitControls['mouseButtons']['LEFT'];
  private readonly originalTouch: OrbitControls['touches']['ONE'];
  private enabled = true;
  private state: 'idle' | 'armed' | 'dragging' = 'idle';
  private mode: MarkMode = 'orbit';
  private gesturePointer: number | null = null;
  private spacePressed = false;
  private cameraGesture = false;
  private startScreen = { x: 0, y: 0 };
  private startNdc = new THREE.Vector2();
  private previewFrame = 0;
  private previewEvent: Pick<PointerEvent, 'clientX' | 'clientY'> | null = null;
  private readonly listeners: Array<() => void>;

  constructor(
    overlayParent: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly controls: OrbitControls,
    private readonly store: AnnotationStore,
    private readonly flyouts: FlyoutLayer,
    private readonly getMesh: () => THREE.Mesh | null,
    private readonly getResolver: () => FeatureResolver | null,
    private readonly onModeChange?: (mode: MarkMode) => void,
    private readonly onSelectionCreated?: (id: string) => void,
  ) {
    this.root = canvas.closest<HTMLElement>('[data-viewer-root]') ?? canvas;
    this.originalLeft = controls.mouseButtons.LEFT;
    this.originalTouch = controls.touches.ONE;
    canvas.tabIndex = 0;
    this.rubberBand = document.createElement('div');
    this.rubberBand.className = 'marks-rubber-band';
    this.rubberBand.hidden = true;
    this.targetPreview = document.createElement('div');
    this.targetPreview.className = 'marks-target-preview';
    this.targetPreview.hidden = true;
    overlayParent.appendChild(this.rubberBand);
    overlayParent.appendChild(this.targetPreview);

    const onDown = (event: PointerEvent) => this.handleDown(event);
    const onMove = (event: PointerEvent) => this.handleMove(event);
    const onUp = (event: PointerEvent) => this.handleUp(event);
    const onCancel = (event: PointerEvent) => {
      if (this.gesturePointer === event.pointerId) {
        this.cancelGesture();
      }
      this.finishPointer(event.pointerId);
    };
    const onLeave = () => this.clearPreview();
    const onKeyDown = (event: KeyboardEvent) => this.handleKeyDown(event);
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') {
        this.spacePressed = false;
        this.updateNavigation();
      }
    };
    const onBlur = () => {
      this.cancelGesture();
      this.pointers.clear();
      this.spacePressed = false;
      this.cameraGesture = false;
      this.updateNavigation();
    };
    const onOutside = (event: PointerEvent) => {
      if (
        this.enabled &&
        event.target instanceof Node &&
        this.root.contains(event.target) &&
        !this.flyouts.ownsTarget(event.target) &&
        this.mode === 'orbit'
      ) {
        this.flyouts.dismissAll();
      }
    };
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('lostpointercapture', onCancel);
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('pointerdown', onOutside);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.listeners = [
      () => canvas.removeEventListener('pointerdown', onDown, true),
      () => canvas.removeEventListener('pointerleave', onLeave),
      () => canvas.removeEventListener('lostpointercapture', onCancel),
      () => document.removeEventListener('pointermove', onMove),
      () => document.removeEventListener('pointerup', onUp),
      () => document.removeEventListener('pointercancel', onCancel),
      () => document.removeEventListener('pointerdown', onOutside),
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
    ];
    this.updateNavigation();
  }

  dispose(): void {
    for (const off of this.listeners) {
      off();
    }
    this.clearPreview();
    this.rubberBand.remove();
    this.targetPreview.remove();
    this.controls.mouseButtons.LEFT = this.originalLeft;
    this.controls.touches.ONE = this.originalTouch;
    delete this.canvas.dataset.markMode;
    delete this.canvas.dataset.navigating;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    this.cancelGesture();
    this.spacePressed = false;
    this.cameraGesture = false;
    this.pointers.clear();
    this.updateNavigation();
  }

  setMode(mode: MarkMode): void {
    if (mode === 'select' && this.store.list().some(item => item.intent === 'selection' && item.state === 'pending')) {
      return;
    }
    if (this.mode === mode) {
      return;
    }
    this.cancelGesture();
    this.mode = mode;
    this.spacePressed = false;
    this.updateNavigation();
    this.onModeChange?.(mode);
  }

  private updateNavigation(): void {
    const navigating = !this.enabled || this.mode === 'orbit' || this.spacePressed || this.cameraGesture;
    this.controls.mouseButtons.LEFT = navigating ? this.originalLeft : null;
    this.controls.touches.ONE = navigating ? this.originalTouch : null;
    this.canvas.dataset.markMode = navigating ? 'orbit' : this.mode;
    this.canvas.dataset.navigating = String(this.cameraGesture && this.pointers.size > 0);
    if (navigating) {
      this.clearPreview();
    }
  }

  private cancelGesture(): void {
    this.state = 'idle';
    this.gesturePointer = null;
    this.rubberBand.hidden = true;
    this.clearPreview();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.enabled || !isViewerShortcutEvent(event, this.root) || this.flyouts.ownsTarget(event.target)) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.state !== 'idle') {
        this.cancelGesture();
      } else {
        this.setMode('orbit');
      }
    } else if (
      (event.code === 'Space' || event.key === ' ') &&
      document.activeElement === this.canvas &&
      this.state === 'idle' &&
      this.pointers.size === 0
    ) {
      event.preventDefault();
      this.spacePressed = true;
      this.updateNavigation();
    }
  }

  private handleDown(event: PointerEvent): void {
    if (!this.enabled || this.flyouts.ownsTarget(event.target)) {
      return;
    }
    this.canvas.focus({ preventScroll: true });
    this.pointers.add(event.pointerId);
    if (this.pointers.size > 1) {
      this.cancelGesture();
      this.cameraGesture = true;
      this.updateNavigation();
      return;
    }
    if (this.mode === 'orbit' || this.spacePressed || event.button !== 0) {
      this.cameraGesture = true;
      this.updateNavigation();
      return;
    }
    if (!event.isPrimary) {
      return;
    }
    this.state = 'armed';
    this.gesturePointer = event.pointerId;
    this.startScreen = { x: event.clientX, y: event.clientY };
    this.startNdc.copy(eventToNdc(event, this.canvas));
    this.clearPreview();
  }

  private handleMove(event: PointerEvent): void {
    if (!this.enabled) {
      return;
    }
    if (this.state === 'idle') {
      if (event.target === this.canvas && this.pointers.size === 0 && this.mode !== 'orbit' && !this.spacePressed) {
        this.previewEvent = { clientX: event.clientX, clientY: event.clientY };
        if (this.previewFrame === 0) {
          this.previewFrame = requestAnimationFrame(() => this.updatePreview());
        }
      }
      return;
    }
    if (event.pointerId !== this.gesturePointer) {
      return;
    }
    const dx = event.clientX - this.startScreen.x;
    const dy = event.clientY - this.startScreen.y;
    if (this.state === 'armed' && Math.hypot(dx, dy) > (event.pointerType === 'touch' ? 8 : 4)) {
      this.state = 'dragging';
      this.rubberBand.hidden = false;
    }
    if (this.state === 'dragging') {
      const rect = this.canvas.getBoundingClientRect();
      Object.assign(this.rubberBand.style, {
        left: `${Math.min(this.startScreen.x, event.clientX) - rect.left}px`,
        top: `${Math.min(this.startScreen.y, event.clientY) - rect.top}px`,
        width: `${Math.abs(dx)}px`,
        height: `${Math.abs(dy)}px`,
      });
    }
  }

  private handleUp(event: PointerEvent): void {
    if (this.enabled && event.pointerId === this.gesturePointer) {
      const wasDragging = this.state === 'dragging';
      this.cancelGesture();
      const mesh = this.getMesh();
      if (mesh) {
        const end = eventToNdc(event, this.canvas);
        if (wasDragging) {
          const region = pickRegion(this.startNdc, end, this.camera, mesh);
          if (region) {
            const partLabel = this.getResolver()?.labelForRegion(region.triIds) ?? undefined;
            this.createAnnotation({
              kind: 'region',
              worldCoord: region.centroidWorld.toArray(),
              anchorWorld: region.centroidWorld.toArray(),
              triIds: region.triIds,
              ...(partLabel !== undefined ? { partLabel } : {}),
            });
          }
        } else if (Math.abs(end.x) <= 1 && Math.abs(end.y) <= 1) {
          const hit = pickPoint(end, this.camera, mesh);
          if (hit) {
            const partLabel = this.getResolver()?.labelForPoint(hit.triId, hit.worldCoord) ?? undefined;
            this.createAnnotation({
              kind: 'point',
              worldCoord: hit.worldCoord.toArray(),
              anchorWorld: hit.worldCoord.toArray(),
              triIds: [],
              ...(partLabel !== undefined ? { partLabel } : {}),
            });
          }
        }
      }
    }
    this.finishPointer(event.pointerId);
  }

  private finishPointer(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size === 0) {
      this.cameraGesture = false;
    }
    this.updateNavigation();
  }

  private createAnnotation(input: AnnotationGeometryInput): void {
    if (this.mode === 'select') {
      const selection = this.store.addSelection(input);
      // One-shot selection ends before async delivery. A late result never
      // changes the user's next tool, and pending state still blocks re-entry.
      this.setMode('orbit');
      this.onSelectionCreated?.(selection.id);
    } else if (this.mode === 'annotate') {
      const annotation = this.store.addComment({ ...input, note: '' });
      this.flyouts.openExpanded(annotation.id);
    }
  }

  private updatePreview(): void {
    this.previewFrame = 0;
    const event = this.previewEvent;
    const mesh = this.getMesh();
    if (!event || !mesh) {
      this.targetPreview.hidden = true;
      return;
    }
    const hit = pickPoint(eventToNdc(event, this.canvas), this.camera, mesh);
    this.targetPreview.hidden = hit === null;
    if (hit) {
      const rect = this.canvas.getBoundingClientRect();
      this.targetPreview.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px)`;
    }
  }

  private clearPreview(): void {
    if (this.previewFrame !== 0) {
      cancelAnimationFrame(this.previewFrame);
      this.previewFrame = 0;
    }
    this.previewEvent = null;
    this.targetPreview.hidden = true;
  }
}
