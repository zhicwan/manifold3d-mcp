import * as THREE from 'three';

import type { PreviewFeature, PreviewPayload } from '../types.js';

/**
 * Resolves a triangle index (or a set of them) back to a semantic
 * feature label like "sphere#1" or "extrude#1 (8/47 tris) near +X".
 *
 * One resolver instance per loaded model. Whenever the viewer receives
 * a new mesh it should construct a fresh resolver and discard the old.
 *
 * Implementation notes:
 *   - Per-feature local AABBs are computed lazily from the actual
 *     triangles assigned to each feature (post-boolean), not from the
 *     primitive's input parameters. This makes spatial hints accurate
 *     for shapes that have been clipped (e.g. a half-sphere bowl).
 *   - Region "dominant feature" is by triangle area, not raw count, so
 *     a coarsely tessellated face doesn't lose to a fine-tessellated one.
 */
export class FeatureResolver {
  private readonly features: PreviewFeature[];
  private readonly triFeatureIds: Uint32Array;
  private readonly positions: Float32Array;
  private readonly indices: Uint32Array;
  private readonly numProp: number;
  private readonly localBboxes = new Map<number, THREE.Box3>();
  private readonly featureTriCount = new Map<number, number>();
  private readonly featureTriIds = new Map<number, Uint32Array>();

  constructor(payload: PreviewPayload) {
    this.features = payload.features;
    this.triFeatureIds = payload.triFeatureIds;
    this.positions = payload.vertProperties;
    this.indices = payload.triVerts;
    this.numProp = payload.numProp;
    for (let t = 0; t < this.triFeatureIds.length; t++) {
      const idx = this.triFeatureIds[t];
      this.featureTriCount.set(idx, (this.featureTriCount.get(idx) ?? 0) + 1);
    }
  }

  hasFeatures(): boolean {
    return this.features.length > 0 && this.triFeatureIds.length > 0;
  }

  /** Look up feature index for one triangle, or -1 if unknown. */
  triIdToFeatureIdx(triId: number): number {
    if (triId < 0 || triId >= this.triFeatureIds.length) {
      return -1;
    }
    return this.triFeatureIds[triId];
  }

  /**
   * Returns every triangle index belonging to the given feature. Built
   * lazily and cached so repeated calls (e.g. hover refresh) are O(1).
   */
  triIdsForFeature(featureIdx: number): Uint32Array {
    let cached = this.featureTriIds.get(featureIdx);
    if (cached) {
      return cached;
    }
    const total = this.featureTriCount.get(featureIdx) ?? 0;
    const out = new Uint32Array(total);
    let cursor = 0;
    for (let t = 0; t < this.triFeatureIds.length && cursor < total; t++) {
      if (this.triFeatureIds[t] === featureIdx) {
        out[cursor++] = t;
      }
    }
    cached = out.subarray(0, cursor);
    this.featureTriIds.set(featureIdx, cached);
    return cached;
  }

  /** Resolve a single triangle pick to a partLabel. */
  labelForPoint(triId: number, worldCoord: THREE.Vector3): string | null {
    const idx = this.triIdToFeatureIdx(triId);
    if (idx < 0) {
      return null;
    }
    const feature = this.features[idx];
    if (!feature) {
      return null;
    }
    const hint = this.spatialHint(idx, [worldCoord]);
    return hint ? `${feature.label} ${hint}` : feature.label;
  }

  /**
   * Resolve a multi-triangle region pick. Picks the dominant feature by
   * triangle AREA, then includes selected/total counts and a spatial
   * hint based on the region's centroid relative to the feature's AABB.
   */
  labelForRegion(triIds: number[]): string | null {
    if (triIds.length === 0) {
      return null;
    }
    // Tally area per feature.
    const areaByFeature = new Map<number, number>();
    const triCentroids: THREE.Vector3[] = [];
    for (const t of triIds) {
      const idx = this.triIdToFeatureIdx(t);
      if (idx < 0) {
        continue;
      }
      const { area, centroid } = this.triangleAreaAndCentroid(t);
      areaByFeature.set(idx, (areaByFeature.get(idx) ?? 0) + area);
      triCentroids.push(centroid);
    }
    if (areaByFeature.size === 0) {
      return null;
    }
    let bestIdx = -1;
    let bestArea = -Infinity;
    for (const [idx, a] of areaByFeature) {
      if (a > bestArea) {
        bestArea = a;
        bestIdx = idx;
      }
    }
    const feature = this.features[bestIdx];
    if (!feature) {
      return null;
    }
    // Count tris belonging to dominant feature (for the "x/y tris" hint).
    let countOnFeature = 0;
    const dominantTriCentroids: THREE.Vector3[] = [];
    for (let i = 0; i < triIds.length; i++) {
      const t = triIds[i];
      if (this.triIdToFeatureIdx(t) === bestIdx) {
        countOnFeature++;
        dominantTriCentroids.push(triCentroids[i]);
      }
    }
    const totalOnFeature = this.featureTriCount.get(bestIdx) ?? 0;
    const hint = this.spatialHint(bestIdx, dominantTriCentroids);
    const counts = totalOnFeature > 0 ? ` (${countOnFeature}/${totalOnFeature} tris)` : '';
    return hint ? `${feature.label}${counts} ${hint}` : `${feature.label}${counts}`;
  }

  /**
   * Compute a 6-axis spatial hint ("near top", "left side", etc.) by
   * comparing the centroid of the selection (in world space) to the
   * feature's AABB (also in world space). Returns null when the
   * centroid sits roughly in the middle of the feature.
   */
  private spatialHint(featureIdx: number, points: THREE.Vector3[]): string | null {
    if (points.length === 0) {
      return null;
    }
    const bbox = this.bboxFor(featureIdx);
    if (!bbox || bbox.isEmpty()) {
      return null;
    }
    const centroid = new THREE.Vector3();
    for (const p of points) {
      centroid.add(p);
    }
    centroid.multiplyScalar(1 / points.length);
    const size = bbox.getSize(new THREE.Vector3());
    const center = bbox.getCenter(new THREE.Vector3());
    const offset = new THREE.Vector3().subVectors(centroid, center);
    // Normalised offset: -1..1 along each axis (relative to bbox half-extents).
    const nx = size.x > 1e-6 ? (2 * offset.x) / size.x : 0;
    const ny = size.y > 1e-6 ? (2 * offset.y) / size.y : 0;
    const nz = size.z > 1e-6 ? (2 * offset.z) / size.z : 0;
    const candidates: Array<[number, string]> = [
      [Math.abs(nx), nx > 0 ? 'near +X side' : 'near -X side'],
      [Math.abs(ny), ny > 0 ? 'near +Y side' : 'near -Y side'],
      [Math.abs(nz), nz > 0 ? 'on top' : 'underneath'],
    ];
    candidates.sort((a, b) => b[0] - a[0]);
    const [strongest, label] = candidates[0];
    if (strongest < 0.4) {
      return null; // close to centre — no hint
    }
    return label;
  }

  /** Lazily compute the world-space AABB of a feature from its triangles. */
  private bboxFor(featureIdx: number): THREE.Box3 | null {
    let bbox = this.localBboxes.get(featureIdx);
    if (bbox) {
      return bbox;
    }
    bbox = new THREE.Box3();
    const v = new THREE.Vector3();
    let any = false;
    for (let t = 0; t < this.triFeatureIds.length; t++) {
      if (this.triFeatureIds[t] !== featureIdx) {
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const vi = this.indices[t * 3 + k];
        v.set(
          this.positions[vi * this.numProp + 0],
          this.positions[vi * this.numProp + 1],
          this.positions[vi * this.numProp + 2],
        );
        bbox.expandByPoint(v);
        any = true;
      }
    }
    if (!any) {
      return null;
    }
    this.localBboxes.set(featureIdx, bbox);
    return bbox;
  }

  private triangleAreaAndCentroid(triId: number): { area: number; centroid: THREE.Vector3 } {
    const a = this.vertexAt(this.indices[triId * 3]);
    const b = this.vertexAt(this.indices[triId * 3 + 1]);
    const c = this.vertexAt(this.indices[triId * 3 + 2]);
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const cross = new THREE.Vector3().crossVectors(ab, ac);
    const area = 0.5 * cross.length();
    const centroid = new THREE.Vector3()
      .addVectors(a, b)
      .add(c)
      .multiplyScalar(1 / 3);
    return { area, centroid };
  }

  private vertexAt(vi: number): THREE.Vector3 {
    return new THREE.Vector3(
      this.positions[vi * this.numProp + 0],
      this.positions[vi * this.numProp + 1],
      this.positions[vi * this.numProp + 2],
    );
  }
}
