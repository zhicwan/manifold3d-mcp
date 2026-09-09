import * as THREE from 'three';

import type { AnnotationStore } from './annotation-store.js';
import type { Annotation } from './types.js';

/**
 * Region surface tint and boundary. Point anchors live in the projected DOM
 * layer so their size and accessibility do not depend on model dimensions.
 */
export class MarkerRenderer {
  private readonly group = new THREE.Group();
  private readonly perAnnotation = new Map<string, THREE.Object3D>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    parent: THREE.Scene,
    private readonly store: AnnotationStore,
    private readonly getMesh: () => THREE.Mesh | null,
    private readonly requestRender: () => void,
  ) {
    this.group.name = 'marks-overlay';
    parent.add(this.group);
    this.unsubscribe = store.subscribe(items => this.sync(items));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const obj of this.perAnnotation.values()) {
      this.disposeObject(obj);
    }
    this.perAnnotation.clear();
    this.group.parent?.remove(this.group);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.requestRender();
  }

  private sync(items: readonly Annotation[]): void {
    const aliveIds = new Set(items.map(a => a.id));
    for (const [id, obj] of this.perAnnotation) {
      if (!aliveIds.has(id)) {
        this.group.remove(obj);
        this.disposeObject(obj);
        this.perAnnotation.delete(id);
      }
    }
    for (const ann of items) {
      if (ann.kind === 'point') {
        continue;
      }
      const existing = this.perAnnotation.get(ann.id);
      const visualKey = `${ann.intent}:${ann.state}`;
      if (existing?.userData.annotationVisualKey === visualKey) {
        continue;
      }
      if (existing) {
        this.group.remove(existing);
        this.disposeObject(existing);
      }
      const obj = this.makeRegionMarker(ann);
      if (obj) {
        obj.userData.annotationVisualKey = visualKey;
        this.perAnnotation.set(ann.id, obj);
        this.group.add(obj);
      } else {
        this.perAnnotation.delete(ann.id);
      }
    }
    this.requestRender();
  }

  private makeRegionMarker(ann: Annotation): THREE.Object3D | null {
    const style = markerStyle(ann);
    const mesh = this.getMesh();
    if (!mesh) {
      return null;
    }
    const sourceGeom = mesh.geometry as THREE.BufferGeometry;
    const sourcePos = sourceGeom.getAttribute('position') as THREE.BufferAttribute;
    const sourceIndex = sourceGeom.getIndex();
    if (!sourceIndex) {
      return null;
    }

    // Build a sub-geometry containing just the selected triangles.
    const positions = new Float32Array(ann.triIds.length * 9);
    const edges = new Map<string, { a: number; b: number; count: number }>();
    const vertexKeys = new Map<number, string>();
    const vertexKey = (index: number): string => {
      let key = vertexKeys.get(index);
      if (key === undefined) {
        key = `${sourcePos.getX(index)},${sourcePos.getY(index)},${sourcePos.getZ(index)}`;
        vertexKeys.set(index, key);
      }
      return key;
    };
    let cursor = 0;
    for (const tri of ann.triIds) {
      for (let k = 0; k < 3; k++) {
        const vi = sourceIndex.getX(tri * 3 + k);
        const next = sourceIndex.getX(tri * 3 + ((k + 1) % 3));
        // Attribute seams may duplicate vertices; only the visual perimeter
        // should remain, not a wireframe of every selected triangle.
        const a = vertexKey(vi);
        const b = vertexKey(next);
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const edge = edges.get(key);
        if (edge) {
          edge.count++;
        } else {
          edges.set(key, { a: vi, b: next, count: 1 });
        }
        positions[cursor++] = sourcePos.getX(vi);
        positions[cursor++] = sourcePos.getY(vi);
        positions[cursor++] = sourcePos.getZ(vi);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.MeshBasicMaterial({
      color: style.color,
      transparent: true,
      opacity: style.regionOpacity,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const overlay = new THREE.Mesh(geom, mat);
    overlay.matrix.copy(mesh.matrixWorld);
    overlay.matrixAutoUpdate = false;
    overlay.renderOrder = 998;
    overlay.userData.annotationId = ann.id;
    const boundary: number[] = [];
    for (const edge of edges.values()) {
      if (edge.count === 1) {
        for (const index of [edge.a, edge.b]) {
          boundary.push(sourcePos.getX(index), sourcePos.getY(index), sourcePos.getZ(index));
        }
      }
    }
    const outline = new THREE.BufferGeometry();
    outline.setAttribute('position', new THREE.Float32BufferAttribute(boundary, 3));
    overlay.add(
      new THREE.LineSegments(
        outline,
        new THREE.LineBasicMaterial({
          color: style.color,
          transparent: true,
          opacity: ann.state === 'committed' ? 0.35 : 0.8,
          depthTest: true,
          depthWrite: false,
        }),
      ),
    );
    return overlay;
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse(node => {
      const m = node as THREE.Mesh;
      if (m.geometry) {
        m.geometry.dispose();
      }
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) {
        for (const x of mat) {
          x.dispose();
        }
      } else if (mat) {
        mat.dispose();
      }
    });
  }
}

function markerStyle(ann: Annotation): { color: number; regionOpacity: number } {
  return { color: 0x3979e3, regionOpacity: ann.state === 'committed' ? 0.1 : ann.state === 'pending' ? 0.22 : 0.16 };
}
