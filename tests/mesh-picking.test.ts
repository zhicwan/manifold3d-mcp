import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { prepareMeshPicking } from '../packages/viewer/src/scene/mesh-picking.js';

describe('model-owned picking acceleration', () => {
  it('preserves indices, nearest face identity and world transforms without patching other meshes', () => {
    const geometry = new THREE.SphereGeometry(1, 64, 64);
    const indices = Array.from(geometry.index!.array);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(2, 3, 4);
    mesh.position.set(2, 3, 1);
    mesh.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(2.2, 3.4, 10), new THREE.Vector3(0, 0, -1));
    const expected = ray.intersectObject(mesh)[0]!;
    const defaultRaycast = THREE.Mesh.prototype.raycast;
    prepareMeshPicking(mesh);
    ray.firstHitOnly = true;
    const hits = ray.intersectObject(mesh);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.faceIndex).toBe(expected.faceIndex);
    expect(hits[0]!.point.distanceTo(expected.point)).toBeLessThan(1e-6);
    expect(Array.from(geometry.index!.array)).toEqual(indices);
    expect(THREE.Mesh.prototype.raycast).toBe(defaultRaycast);
    expect(geometry.boundsTree).toBeDefined();
    geometry.dispose();
    expect(geometry.boundsTree).toBeUndefined();
    material.dispose();
  });
});
