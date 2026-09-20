import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeasurementGeometry } from './geometry.js';
import { type MeasurementCandidate } from './geometry.js';

const SNAP_PIXELS = 10;
const RELEASE_PIXELS = 15;

/** CSS-pixel snapping against the existing indirect BVH; never changes mesh/index data. */
interface MeasurementPickInput {
  geometry: MeasurementGeometry;
  mesh: THREE.Mesh;
  camera: THREE.Camera;
  ndc: THREE.Vector2;
  width: number;
  height: number;
  previousKey?: string;
  surfacePoint?: boolean;
}

export interface MeasurementPickResult {
  candidates: MeasurementCandidate[];
  faceCenter: MeasurementCandidate | null;
}

export function pickMeasurementCandidates(input: MeasurementPickInput): MeasurementCandidate[] {
  return pickMeasurement(input).candidates;
}

export function pickMeasurement(input: MeasurementPickInput): MeasurementPickResult {
  const { geometry, mesh, camera, ndc, width, height, previousKey } = input;
  if (!(width > 0 && height > 0) || ![width, height, ndc.x, ndc.y].every(Number.isFinite)) {
    return { candidates: [], faceCenter: null };
  }
  const bvh = mesh.geometry.boundsTree;
  if (!(bvh instanceof MeshBVH)) {
    return { candidates: [], faceCenter: null };
  }
  mesh.updateWorldMatrix(true, false);
  camera.updateWorldMatrix(true, false);
  if (mesh.matrixWorld.determinant() === 0) {
    return { candidates: [], faceCenter: null };
  }
  const inverse = mesh.matrixWorld.clone().invert();
  const projection = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(mesh.matrixWorld);
  const unprojection = projection.clone().invert();
  const crop = new THREE.Matrix4().set(
    width / (2 * RELEASE_PIXELS),
    0,
    0,
    (-ndc.x * width) / (2 * RELEASE_PIXELS),
    0,
    height / (2 * RELEASE_PIXELS),
    0,
    (-ndc.y * height) / (2 * RELEASE_PIXELS),
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  );
  const frustum = new THREE.Frustum().setFromProjectionMatrix(crop.multiply(projection), camera.coordinateSystem);
  const raycaster = new THREE.Raycaster();
  const rayAt = (at: THREE.Vector2): THREE.Ray => {
    raycaster.setFromCamera(at, camera);
    return raycaster.ray.clone().applyMatrix4(inverse);
  };
  const clippedHit = (ray: THREE.Ray, at: THREE.Vector2) => {
    // Camera clipping planes become distances along the local ray, including
    // perspective obliqueness and non-uniform model presentation transforms.
    const distanceAt = (depth: number) =>
      new THREE.Vector3(at.x, at.y, depth).applyMatrix4(unprojection).sub(ray.origin).dot(ray.direction);
    return bvh.raycastFirst(ray, THREE.DoubleSide, Math.max(0, distanceAt(-1)), distanceAt(1));
  };
  const pointerRay = rayAt(ndc);
  const hit = clippedHit(pointerRay, ndc);
  const hitPlane =
    hit?.faceIndex !== undefined && hit.faceIndex !== null ? geometry.planeForTriangle(hit.faceIndex) : null;
  let faceCenter = hitPlane?.operand.kind === 'plane' ? geometry.centerForPatch(hitPlane.operand.patchId) : null;
  const localCandidates = new Map<string, MeasurementCandidate>();
  bvh.shapecast({
    intersectsBounds: box => frustum.intersectsBox(box),
    intersectsTriangle: (_triangle, triangleId) => {
      // In three-mesh-bvh 0.9.15 this callback already resolves indirect indices.
      for (const candidate of geometry.candidatesForTriangle(triangleId)) {
        localCandidates.set(candidate.key, candidate);
      }
      return false;
    },
  });
  if (faceCenter) {
    localCandidates.set(faceCenter.key, faceCenter);
  }
  const clipPoint = (p: THREE.Vector3): THREE.Vector4 => new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(projection);
  const screen = (p: THREE.Vector4): THREE.Vector2 => new THREE.Vector2(p.x / p.w, p.y / p.w);
  const pixelDistance = (p: THREE.Vector2): number =>
    Math.hypot(((p.x - ndc.x) * width) / 2, ((p.y - ndc.y) * height) / 2);
  const inDepth = (p: THREE.Vector4): boolean => p.w > 0 && p.z >= -p.w && p.z <= p.w;
  const visible = (p: THREE.Vector3, projected: THREE.Vector2): boolean => {
    const ray = rayAt(projected);
    const occluder = clippedHit(ray, projected);
    if (!occluder) {
      return true;
    }
    const along = p.clone().sub(ray.origin).dot(ray.direction);
    return occluder.distance >= along - geometry.tolerance * 4;
  };
  const scored: { candidate: MeasurementCandidate; pixels: number; depth: number; rank: number }[] = [];
  for (const candidate of localCandidates.values()) {
    const operand = candidate.operand;
    let local: THREE.Vector3;
    let projected: THREE.Vector2;
    if (operand.kind === 'point') {
      local = new THREE.Vector3(...operand.position);
      const clip = clipPoint(local);
      if (!inDepth(clip)) {
        continue;
      }
      projected = screen(clip);
    } else if (operand.kind === 'edge') {
      const a = new THREE.Vector3(...operand.start);
      const b = new THREE.Vector3(...operand.end);
      const ca = clipPoint(a);
      const cb = clipPoint(b);
      let low = 0;
      let high = 1;
      // Clip near/far before projection; endpoints behind the eye must not invert the segment.
      for (const [fa, fb] of [
        [ca.w + ca.z, cb.w + cb.z],
        [ca.w - ca.z, cb.w - cb.z],
      ]) {
        if (fa! < 0 && fb! < 0) {
          high = -1;
          break;
        }
        if (fa! < 0) {
          low = Math.max(low, fa! / (fa! - fb!));
        }
        if (fb! < 0) {
          high = Math.min(high, fa! / (fa! - fb!));
        }
      }
      if (low > high) {
        continue;
      }
      const ac = ca.clone().lerp(cb, low);
      const bc = ca.clone().lerp(cb, high);
      if (ac.w <= 0 || bc.w <= 0) {
        continue;
      }
      const sa = screen(ac);
      const sb = screen(bc);
      const delta = sb.clone().sub(sa).multiply(new THREE.Vector2(width, height));
      const offset = ndc.clone().sub(sa).multiply(new THREE.Vector2(width, height));
      const t = delta.lengthSq() === 0 ? 0 : THREE.MathUtils.clamp(offset.dot(delta) / delta.lengthSq(), 0, 1);
      projected = sa.clone().lerp(sb, t);
      // Screen-linear t is not world-linear under perspective.
      const perspectiveT = t / bc.w / ((1 - t) / ac.w + t / bc.w);
      local = a.lerp(b, low + (high - low) * perspectiveT);
    } else {
      continue;
    }
    const pixels = pixelDistance(projected);
    if (pixels > (candidate.key === previousKey ? RELEASE_PIXELS : SNAP_PIXELS) || !visible(local, projected)) {
      continue;
    }
    scored.push({
      candidate,
      pixels,
      rank: operand.kind === 'point' ? 0 : 1,
      depth: local.clone().applyMatrix4(mesh.matrixWorld).distanceTo(raycaster.ray.origin),
    });
  }
  if (hit && hit.faceIndex !== null && hit.faceIndex !== undefined && inDepth(clipPoint(hit.point))) {
    const plane = geometry.planeForTriangle(hit.faceIndex);
    if (plane) {
      scored.push({ candidate: plane, pixels: 0, depth: hit.distance, rank: 2 });
    }
    const position: [number, number, number] = [hit.point.x, hit.point.y, hit.point.z];
    const candidate: MeasurementCandidate = {
      // Available as an explicit alternative, without defeating normal snapping.
      key: `surface:${hit.faceIndex}:${position.map(n => n.toPrecision(12)).join(':')}`,
      operand: { kind: 'point', position, triangleId: hit.faceIndex },
      anchor: position,
      triIds: plane?.triIds ?? [hit.faceIndex],
    };
    scored.push({ candidate, pixels: 0, depth: hit.distance, rank: input.surfacePoint ? 0 : 3 });
  }
  const nearestVertex = scored.reduce(
    (nearest, item) =>
      item.candidate.operand.kind === 'point' && item.candidate.operand.vertexId !== undefined
        ? Math.min(nearest, item.pixels)
        : nearest,
    Infinity,
  );
  for (const item of scored) {
    if (
      item.candidate.operand.kind === 'point' &&
      item.candidate.operand.faceCenter &&
      item.pixels <= 6 &&
      item.pixels + 1 < nearestVertex
    ) {
      item.rank = -1;
    }
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(b.candidate.key === previousKey) - Number(a.candidate.key === previousKey) ||
      a.pixels - b.pixels ||
      a.depth - b.depth ||
      a.candidate.key.localeCompare(b.candidate.key),
  );
  const candidates = scored.map(({ candidate }) => candidate);
  const primary = candidates[0];
  if (primary?.operand.kind === 'point' && primary.operand.faceCenter) {
    faceCenter = primary;
  }
  return { candidates, faceCenter };
}
