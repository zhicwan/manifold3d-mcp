import * as THREE from 'three';
import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';
import type { MeasurementEvidence, MeasurementVec3 } from '@manifold3d/protocol/wire/measurements.js';
import { MAX_ANNOTATIONS } from '@manifold3d/protocol/wire/annotations.js';
import type { AnnotationStore } from '../marks/annotation-store.js';
import type { MeasurementAnnotation } from '../marks/types.js';
import { eventToNdc } from '../marks/picker.js';
import { MeasurementGeometry, type MeasurementCandidate } from './geometry.js';
import { pickMeasurement } from './picker.js';
import { MeasurementRenderer } from './renderer.js';
import { projectMeasurement, type DimensionStroke, type ProjectedMeasurement } from './projection.js';
import { RadialPlacementResolver } from './radial-placement.js';
import { contextualizeMeasurement } from './context.js';

export interface MeasurementLabel extends ProjectedMeasurement {
  id: string;
  x: number;
  y: number;
}

export interface RulerSnapshot {
  active: boolean;
  activeMeasurementId: string | null;
  locked: MeasurementCandidate | null;
  candidate: MeasurementCandidate | null;
  faceCenter: MeasurementCandidate | null;
  preview: MeasurementEvidence | null;
  previewLabel: ProjectedMeasurement | null;
  expandedId: string | null;
  labels: readonly MeasurementLabel[];
  width: number;
  height: number;
  notice: 'changed' | 'limit' | null;
  error: string | null;
}

export class RulerController {
  private geometry: MeasurementGeometry | null = null;
  private placementResolver: RadialPlacementResolver | null = null;
  private payload: ViewerModel | null = null;
  private readonly renderer: MeasurementRenderer;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private readonly cameraMatrix = new THREE.Matrix4();
  private readonly projectionMatrix = new THREE.Matrix4();
  private readonly modelMatrix = new THREE.Matrix4();
  private projectionDirty = true;
  private disposed = false;
  private immersive = false;
  private navigating = false;
  private lastPointer: Pick<PointerEvent, 'clientX' | 'clientY'> | null = null;
  private pickedPointer: Pick<PointerEvent, 'clientX' | 'clientY'> | null = null;
  private snapshot: RulerSnapshot = {
    active: false,
    activeMeasurementId: null,
    locked: null,
    candidate: null,
    faceCenter: null,
    preview: null,
    previewLabel: null,
    expandedId: null,
    labels: [],
    width: 0,
    height: 0,
    notice: null,
    error: null,
  };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
    scene: THREE.Scene,
    private readonly store: AnnotationStore,
    private readonly getMesh: () => THREE.Mesh | null,
    private readonly requestRender: () => void,
    private readonly finish: () => void,
    private readonly featureFor: (candidate: MeasurementCandidate) => string | null = () => null,
  ) {
    this.renderer = new MeasurementRenderer(scene, getMesh);
    this.unsubscribe = store.subscribe(() => {
      if (this.snapshot.activeMeasurementId && !store.get(this.snapshot.activeMeasurementId)) {
        this.updatePreview({ activeMeasurementId: null, locked: null, candidate: null });
      }
      if (this.snapshot.expandedId && !store.get(this.snapshot.expandedId)) {
        this.patch({ expandedId: null });
      }
      this.renderer.setResults(
        this.measurements(),
        this.snapshot.expandedId,
        triangleId => this.geometry?.planeForTriangle(triangleId) ?? null,
      );
      this.projectionDirty = true;
      this.requestRender();
    });
  }

  getSnapshot = (): RulerSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setPayload(payload: ViewerModel): void {
    if (this.payload === payload) {
      return;
    }
    this.payload = payload;
    this.geometry = null;
    this.placementResolver = null;
    this.lastPointer = null;
    this.patch({
      locked: null,
      activeMeasurementId: null,
      candidate: null,
      faceCenter: null,
      preview: null,
      previewLabel: null,
      labels: [],
      error: null,
    });
    this.renderer.clear();
    this.renderer.setResults(this.measurements(), this.snapshot.expandedId);
    this.projectionDirty = true;
    this.requestRender();
  }

  modelChanging(): void {
    const changed = this.snapshot.locked !== null || this.measurements().length > 0;
    this.patch({
      locked: null,
      activeMeasurementId: null,
      candidate: null,
      faceCenter: null,
      preview: null,
      previewLabel: null,
      expandedId: null,
      labels: [],
      notice: changed ? 'changed' : this.snapshot.notice,
    });
    this.renderer.clear();
    this.projectionDirty = true;
    if (this.snapshot.active) {
      this.finish();
    }
  }

  setActive(active: boolean): void {
    this.patch({
      active,
      activeMeasurementId: null,
      locked: null,
      candidate: null,
      faceCenter: null,
      preview: null,
      expandedId: null,
      error: null,
    });
    this.lastPointer = null;
    this.updatePreview();
  }

  hover(event: Pick<PointerEvent, 'clientX' | 'clientY'>): void {
    if (!this.snapshot.active || this.immersive || !this.payload) {
      return;
    }
    const mesh = this.getMesh();
    if (!mesh) {
      return;
    }
    this.lastPointer = { clientX: event.clientX, clientY: event.clientY };
    this.pickedPointer = this.lastPointer;
    try {
      this.geometry ??= new MeasurementGeometry(this.payload);
      const rect = this.canvas.getBoundingClientRect();
      const picked = pickMeasurement({
        geometry: this.geometry,
        mesh,
        camera: this.camera,
        ndc: eventToNdc(event, this.canvas),
        width: rect.width,
        height: rect.height,
        ...(this.snapshot.candidate ? { previousKey: this.snapshot.candidate.key } : {}),
      });
      const { candidates, faceCenter } = picked;
      const candidate = candidates[0] ?? null;
      if (
        candidate?.key === this.snapshot.candidate?.key &&
        faceCenter?.key === this.snapshot.faceCenter?.key &&
        !this.snapshot.error
      ) {
        return;
      }
      this.updatePreview({ candidate, faceCenter, error: null });
    } catch (error) {
      this.reportError(error);
    }
  }

  trackPointer(event: Pick<PointerEvent, 'clientX' | 'clientY'>): void {
    this.lastPointer = { clientX: event.clientX, clientY: event.clientY };
  }

  setNavigating(navigating: boolean): void {
    if (this.navigating === navigating) {
      return;
    }
    this.navigating = navigating;
    if (navigating) {
      this.clearHover();
    } else if (this.snapshot.active && this.lastPointer) {
      this.hover(this.lastPointer);
    }
  }

  /** Pointer completion uses the last visible choice unless the pointer moved. */
  click(event: Pick<PointerEvent, 'clientX' | 'clientY'>): void {
    if (
      !this.pickedPointer ||
      Math.hypot(event.clientX - this.pickedPointer.clientX, event.clientY - this.pickedPointer.clientY) > 2
    ) {
      this.hover(event);
    }
    this.confirmCandidate();
  }

  confirmCandidate(): void {
    const { candidate, locked, preview } = this.snapshot;
    if (!this.snapshot.active || !candidate) {
      return;
    }
    if (!locked) {
      if (candidate.operand.kind === 'edge' && this.geometry) {
        if (this.store.list().length >= MAX_ANNOTATIONS) {
          this.patch({ notice: 'limit' });
          return;
        }
        try {
          const measured = this.geometry.measure(candidate);
          const length = measured ? contextualizeMeasurement(measured, [candidate], this.featureFor) : null;
          if (!length) {
            throw new Error('The selected edge has no measurable length.');
          }
          const annotation = this.store.addMeasurement(length.evidence, candidate.anchor, length.partLabel);
          this.updatePreview({
            locked: candidate,
            candidate: null,
            activeMeasurementId: annotation.id,
          });
        } catch (error) {
          this.reportError(error);
        }
      } else {
        this.updatePreview({ locked: candidate, candidate: null });
      }
    } else if (preview?.kind === 'relation') {
      this.complete(preview, locked);
    } else if (this.snapshot.activeMeasurementId && candidate.key === locked.key) {
      this.finish();
    }
  }

  escape(): boolean {
    if (this.snapshot.activeMeasurementId) {
      this.finish();
      return true;
    }
    if (!this.snapshot.locked) {
      return false;
    }
    this.patch({ locked: null, candidate: null, preview: null });
    this.updatePreview();
    return true;
  }

  clearHover(): void {
    this.pickedPointer = null;
    if (this.snapshot.candidate || this.snapshot.preview || this.snapshot.faceCenter) {
      this.patch({ candidate: null, preview: null, faceCenter: null });
      this.updatePreview();
    }
  }

  dismissNotice(): void {
    this.patch({ notice: null, error: null });
  }

  expand(id: string | null): void {
    this.patch({ expandedId: id });
    this.renderer.setResults(
      this.measurements(),
      id,
      triangleId => this.geometry?.planeForTriangle(triangleId) ?? null,
    );
    this.projectionDirty = true;
    this.requestRender();
  }

  inspect(id: string): void {
    if (this.snapshot.active) {
      this.updatePreview({
        locked: null,
        activeMeasurementId: null,
        candidate: null,
        faceCenter: null,
      });
    }
    this.expand(id);
  }

  clearInspection(): void {
    if (this.snapshot.expandedId !== null) {
      this.expand(null);
    }
  }

  setDimension(id: string, strokes: readonly DimensionStroke[], width: number, height: number, color: string): void {
    if (!this.disposed) {
      this.renderer.setDimension(id, strokes, this.camera, width, height, color);
      this.requestRender();
    }
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.renderer.setTheme(theme);
    this.requestRender();
  }

  removeDimension(id: string): void {
    if (!this.disposed) {
      this.renderer.removeDimension(id);
      this.requestRender();
    }
  }

  setImmersivePresenting(presenting: boolean): void {
    this.immersive = presenting;
    this.renderer.setVisible(!presenting);
    if (presenting) {
      this.patch({ labels: [], expandedId: null });
      if (this.snapshot.active) {
        this.finish();
      }
    }
    this.projectionDirty = true;
  }

  frame(): void {
    if (this.immersive || this.disposed) {
      return;
    }
    const mesh = this.getMesh();
    if (!mesh) {
      return;
    }
    this.camera.updateMatrixWorld();
    mesh.updateWorldMatrix(true, false);
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const viewMoved =
      this.cameraMatrix.elements.some(
        (value, index) => Math.abs(value - this.camera.matrixWorld.elements[index]!) > 1e-7,
      ) ||
      this.projectionMatrix.elements.some(
        (value, index) => Math.abs(value - this.camera.projectionMatrix.elements[index]!) > 1e-7,
      );
    const pickViewChanged =
      viewMoved ||
      width !== this.snapshot.width ||
      height !== this.snapshot.height ||
      !this.modelMatrix.equals(mesh.matrixWorld);
    if (this.snapshot.active && pickViewChanged && !this.navigating && this.lastPointer) {
      this.hover(this.lastPointer);
    }
    if (
      !this.projectionDirty &&
      width === this.snapshot.width &&
      height === this.snapshot.height &&
      this.cameraMatrix.equals(this.camera.matrixWorld) &&
      this.projectionMatrix.equals(this.camera.projectionMatrix) &&
      this.modelMatrix.equals(mesh.matrixWorld)
    ) {
      return;
    }
    const labels: MeasurementLabel[] = [];
    for (const annotation of this.measurements()) {
      const placement = this.project(annotation.measurement, annotation.anchorWorld, width, height);
      if (!placement) {
        continue;
      }
      labels.push({
        id: annotation.id,
        ...placement,
      });
    }
    this.cameraMatrix.copy(this.camera.matrixWorld);
    this.projectionMatrix.copy(this.camera.projectionMatrix);
    this.modelMatrix.copy(mesh.matrixWorld);
    this.renderer.updateTransform();
    this.renderer.updateMarkers(this.camera, width, height);
    this.projectionDirty = false;
    const previewTarget = this.snapshot.candidate ?? this.snapshot.locked;
    const previewLabel = previewTarget
      ? this.project(this.snapshot.preview, previewTarget.anchor, width, height)
      : null;
    this.patch({ labels, width, height, previewLabel });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
    this.renderer.dispose();
    this.geometry = null;
    this.placementResolver = null;
    this.payload = null;
  }

  private measurements(): MeasurementAnnotation[] {
    return this.store.list().filter((item): item is MeasurementAnnotation => item.intent === 'measurement');
  }

  private project(evidence: MeasurementEvidence | null, anchor: MeasurementVec3, width: number, height: number) {
    const mesh = this.getMesh();
    if (!mesh) {
      return null;
    }
    let offset: readonly [number, number, number] = [0, 0, 0];
    if (evidence?.distance) {
      this.placementResolver ??= new RadialPlacementResolver(mesh.geometry);
      offset = this.placementResolver.resolve(evidence).offset;
    }
    return projectMeasurement(evidence, anchor, this.camera, mesh.matrixWorld, width, height, offset);
  }

  private complete(evidence: MeasurementEvidence, candidate: MeasurementCandidate): void {
    const currentId = this.snapshot.activeMeasurementId;
    if (!currentId && this.store.list().length >= MAX_ANNOTATIONS) {
      this.patch({ notice: 'limit' });
      return;
    }
    try {
      const anchor = evidence.distance
        ? new THREE.Vector3()
            .fromArray(evidence.distance.start)
            .lerp(new THREE.Vector3().fromArray(evidence.distance.end), 0.5)
            .toArray()
        : candidate.anchor;
      if (currentId) {
        const partLabel = evidence.operands
          .map(operand => operand.feature)
          .filter((feature): feature is string => feature !== undefined)
          .join(' to ');
        if (!this.store.replaceMeasurement(currentId, evidence, anchor, partLabel || 'Measurement')) {
          throw new Error('The measurement changed before the comparison was completed.');
        }
      } else {
        const partLabel = evidence.operands
          .map(operand => operand.feature)
          .filter((feature): feature is string => feature !== undefined)
          .join(' to ');
        this.store.addMeasurement(evidence, anchor, partLabel || 'Measurement');
      }
      this.finish();
    } catch (error) {
      this.reportError(error);
    }
  }

  private updatePreview(changes: Partial<RulerSnapshot> = {}): void {
    try {
      const { locked, candidate, faceCenter } = { ...this.snapshot, ...changes };
      const measured =
        this.geometry && candidate
          ? locked
            ? this.geometry.measure(locked, candidate)
            : this.geometry.measure(candidate)
          : null;
      const relation =
        measured && candidate
          ? contextualizeMeasurement(measured, locked ? [locked, candidate] : [candidate], this.featureFor).evidence
          : null;
      const single = locked?.operand.kind === 'edge' ? this.geometry?.measure(locked) : null;
      const preview =
        relation ?? (single ? contextualizeMeasurement(single, [locked!], this.featureFor).evidence : null);
      const previewTarget = candidate ?? locked;
      const mesh = this.getMesh();
      this.camera.updateMatrixWorld();
      mesh?.updateWorldMatrix(true, false);
      const previewLabel =
        previewTarget && mesh
          ? this.project(preview, previewTarget.anchor, this.canvas.clientWidth, this.canvas.clientHeight)
          : null;
      this.patch({ ...changes, preview, previewLabel });
      this.projectionDirty = true;
      this.renderer.setPreview(
        locked,
        candidate,
        preview,
        this.snapshot.active && !this.navigating ? faceCenter : null,
      );
      this.requestRender();
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    console.error('Viewer measurement failed.', error);
    this.patch({
      candidate: null,
      preview: null,
      previewLabel: null,
      faceCenter: null,
      error: error instanceof Error ? error.message : String(error),
    });
    this.renderer.setPreview(this.snapshot.locked, null, null);
    this.requestRender();
  }

  private patch(patch: Partial<RulerSnapshot>): void {
    if (this.disposed) {
      return;
    }
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
