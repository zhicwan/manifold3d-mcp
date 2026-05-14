import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { AnnotationStore } from './annotation-store.js';
import type { FeatureResolver } from './feature-resolver.js';
import { eventToNdc, pickPoint, pickRegion } from './picker.js';
import type { FlyoutLayer } from './flyout.js';

/**
 * Wires Ctrl+click and Ctrl+drag input on the canvas to the annotation
 * store. Also draws the rubber-band rectangle while a region drag is in
 * progress, and disables OrbitControls during a Ctrl-modified gesture
 * so the camera doesn't fight the user.
 *
 * State machine:
 *
 *   idle ──Ctrl+mousedown─► armed
 *   armed ──move>threshold─► dragging
 *   armed ──mouseup────────► point pick (single Ctrl+click)
 *   dragging ──mouseup─────► region pick
 *
 * If the gesture begins inside a flyout, we let it bubble (so users can
 * type / click delete) and skip the state machine entirely.
 */
export class MarkTool {
  private readonly rubberBand: HTMLDivElement;
  private state: 'idle' | 'armed' | 'dragging' = 'idle';
  private startScreen = { x: 0, y: 0 };
  private startNdc = new THREE.Vector2();
  private endNdc = new THREE.Vector2();
  private listeners: Array<() => void> = [];

  constructor(
    overlayParent: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    private readonly controls: OrbitControls,
    private readonly store: AnnotationStore,
    private readonly flyouts: FlyoutLayer,
    private readonly getMesh: () => THREE.Mesh | null,
    private readonly getResolver: () => FeatureResolver | null,
  ) {
    this.rubberBand = document.createElement('div');
    this.rubberBand.className = 'marks-rubber-band';
    this.rubberBand.style.display = 'none';
    overlayParent.appendChild(this.rubberBand);

    const onDown = (ev: MouseEvent) => this.handleDown(ev);
    const onMove = (ev: MouseEvent) => this.handleMove(ev);
    const onUp = (ev: MouseEvent) => this.handleUp(ev);
    const onDocClick = (ev: MouseEvent) => this.handleDocClick(ev);

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('click', onDocClick, true);

    this.listeners = [
      () => canvas.removeEventListener('mousedown', onDown),
      () => window.removeEventListener('mousemove', onMove),
      () => window.removeEventListener('mouseup', onUp),
      () => window.removeEventListener('click', onDocClick, true),
    ];
  }

  dispose(): void {
    for (const off of this.listeners) {
      off();
    }
    this.rubberBand.remove();
  }

  private isMarkGesture(ev: MouseEvent): boolean {
    return ev.button === 0 && (ev.ctrlKey || ev.metaKey);
  }

  private handleDown(ev: MouseEvent): void {
    if (!this.isMarkGesture(ev)) {
      return;
    }
    if (this.flyouts.ownsTarget(ev.target)) {
      return;
    }
    this.state = 'armed';
    this.startScreen = { x: ev.clientX, y: ev.clientY };
    this.startNdc.copy(eventToNdc(ev, this.canvas));
    this.controls.enabled = false;
    ev.preventDefault();
    ev.stopPropagation();
  }

  private handleMove(ev: MouseEvent): void {
    if (this.state === 'idle') {
      return;
    }
    const dx = ev.clientX - this.startScreen.x;
    const dy = ev.clientY - this.startScreen.y;
    if (this.state === 'armed' && Math.hypot(dx, dy) > 4) {
      this.state = 'dragging';
      this.rubberBand.style.display = '';
    }
    if (this.state === 'dragging') {
      this.endNdc.copy(eventToNdc(ev, this.canvas));
      this.updateRubberBandRect(ev);
    }
  }

  private handleUp(ev: MouseEvent): void {
    if (this.state === 'idle') {
      return;
    }
    const wasDragging = this.state === 'dragging';
    this.state = 'idle';
    this.rubberBand.style.display = 'none';
    this.controls.enabled = true;

    const mesh = this.getMesh();
    if (!mesh) {
      return;
    }
    if (wasDragging) {
      const region = pickRegion(this.startNdc, this.endNdc, this.camera, mesh);
      if (region) {
        const resolver = this.getResolver();
        const partLabel = resolver?.labelForRegion(region.triIds) ?? undefined;
        const ann = this.store.add({
          kind: 'region',
          worldCoord: region.centroidWorld.toArray() as [number, number, number],
          anchorWorld: region.centroidWorld.toArray() as [number, number, number],
          triIds: region.triIds,
          note: '',
          partLabel,
        });
        this.flyouts.openExpanded(ann.id);
      }
    } else {
      const ndc = eventToNdc(ev, this.canvas);
      const hit = pickPoint(ndc, this.camera, mesh);
      if (hit) {
        const resolver = this.getResolver();
        const partLabel = resolver?.labelForPoint(hit.triId, hit.worldCoord) ?? undefined;
        const ann = this.store.add({
          kind: 'point',
          worldCoord: hit.worldCoord.toArray() as [number, number, number],
          anchorWorld: hit.worldCoord.toArray() as [number, number, number],
          triIds: [],
          note: '',
          partLabel,
        });
        this.flyouts.openExpanded(ann.id);
      }
    }
  }

  /**
   * Any plain (non-Ctrl) click outside flyouts dismisses an open flyout.
   * Captured at window level so it works even when clicking on the
   * canvas (which would otherwise be swallowed by OrbitControls).
   */
  private handleDocClick(ev: MouseEvent): void {
    if (ev.ctrlKey || ev.metaKey) {
      return;
    }
    if (this.flyouts.ownsTarget(ev.target)) {
      return;
    }
    this.flyouts.dismissAll();
  }

  private updateRubberBandRect(ev: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const left = Math.min(this.startScreen.x, ev.clientX) - rect.left;
    const top = Math.min(this.startScreen.y, ev.clientY) - rect.top;
    const width = Math.abs(ev.clientX - this.startScreen.x);
    const height = Math.abs(ev.clientY - this.startScreen.y);
    this.rubberBand.style.left = `${left}px`;
    this.rubberBand.style.top = `${top}px`;
    this.rubberBand.style.width = `${width}px`;
    this.rubberBand.style.height = `${height}px`;
  }
}
