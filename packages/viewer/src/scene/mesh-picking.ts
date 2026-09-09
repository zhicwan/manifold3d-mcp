import type { Mesh } from 'three';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

/** Keep spatial queries with the displayed model, without changing canonical triangle ids. */
export function prepareMeshPicking(mesh: Mesh): void {
  const geometry = mesh.geometry;
  geometry.boundsTree = new MeshBVH(geometry, { indirect: true });
  mesh.raycast = acceleratedRaycast;
  geometry.addEventListener('dispose', release);
  function release(): void {
    delete geometry.boundsTree;
    geometry.removeEventListener('dispose', release);
  }
}
