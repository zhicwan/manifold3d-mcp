import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { AnnotationStore } from '../../packages/viewer/src/marks/annotation-store.js';
import { MarkerRenderer } from '../../packages/viewer/src/marks/marker-renderer.js';

describe('Annotation surface presentation', () => {
  it('does not draw world-sized point spheres; anchors belong to the screen projection', () => {
    const scene = new THREE.Scene();
    const store = new AnnotationStore();
    const renderer = new MarkerRenderer(scene, store, () => null, vi.fn());
    store.addComment({ kind: 'point', anchorWorld: [0, 0, 0], worldCoord: [0, 0, 0], triIds: [], note: 'here' });
    expect(scene.getObjectByName('marks-overlay')?.children).toHaveLength(0);
    renderer.dispose();
  });

  it.each([false, true])('outlines only the perimeter (attribute seams=%s) and subdues committed regions', seams => {
    const scene = new THREE.Scene();
    const store = new AnnotationStore();
    const geometry = new THREE.PlaneGeometry(10, 10);
    const mesh = new THREE.Mesh(seams ? geometry.toNonIndexed() : geometry);
    if (seams) {
      mesh.geometry.setIndex([0, 1, 2, 3, 4, 5]);
      geometry.dispose();
    }
    const renderer = new MarkerRenderer(scene, store, () => mesh, vi.fn());
    store.addComment({
      kind: 'region',
      anchorWorld: [0, 0, 0],
      worldCoord: [0, 0, 0],
      triIds: [0, 1],
      note: 'this area',
    });
    const overlay = scene.getObjectByName('marks-overlay')!.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    const outline = overlay.children[0] as THREE.LineSegments;
    expect(overlay.material.depthTest).toBe(true);
    expect(overlay.material.opacity).toBeLessThan(0.25);
    expect(outline.geometry.getAttribute('position').count).toBe(8);
    const dispose = vi.spyOn(overlay.geometry, 'dispose');
    store.freezeBatch(store.getDraftBatch().batchId);
    const committed = scene.getObjectByName('marks-overlay')!.children[0] as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    expect(committed.material.opacity).toBeLessThan(overlay.material.opacity);
    expect(dispose).toHaveBeenCalledOnce();
    renderer.dispose();
    mesh.geometry.dispose();
  });
});
