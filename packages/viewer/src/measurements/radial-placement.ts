import type { BufferGeometry } from 'three';
import { DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { MeasurementEvidence } from '@manifold3d/protocol/wire/measurements.js';

export interface RadialPlacement {
  readonly kind: 'free' | 'blocked' | 'degenerate';
  readonly offset: readonly [number, number, number];
  readonly radius: number;
  readonly freeAngleDegrees: number;
}

/** Treat the samples as a ring, including a free run crossing the array boundary. */
export function largestFreeSector(blocked: readonly boolean[]): { start: number; count: number } | null {
  if (blocked.length === 0) {
    throw new RangeError('A radial occupancy ring cannot be empty.');
  }
  const pivot = blocked.findIndex(value => value);
  if (pivot === -1) {
    return { start: 0, count: blocked.length };
  }
  let best: { start: number; count: number } | null = null;
  let start = 0;
  let count = 0;
  for (let step = 1; step <= blocked.length; step++) {
    const index = (pivot + step) % blocked.length;
    if (!blocked[index]) {
      if (count === 0) {
        start = index;
      }
      count++;
    } else {
      if (count > 0 && (!best || count > best.count || (count === best.count && start < best.start))) {
        best = { start, count };
      }
      count = 0;
    }
  }
  return best;
}

/**
 * Common model-space clearance at both endpoints and the midpoint, including
 * the entire displaced segment. Borrows the model's BVH, never a camera.
 */
export class RadialPlacementResolver {
  private readonly tree: MeshBVH;
  private readonly precision: number;
  private readonly cache = new WeakMap<MeasurementEvidence, RadialPlacement>();

  constructor(geometry: BufferGeometry) {
    if (!(geometry.boundsTree instanceof MeshBVH)) {
      throw new Error('Radial measurement placement requires the model-owned BVH.');
    }
    this.tree = geometry.boundsTree;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    const bounds = geometry.boundingBox;
    if (!bounds || bounds.isEmpty()) {
      throw new Error('Radial measurement placement requires non-empty model bounds.');
    }
    const magnitude = Math.max(...bounds.min.toArray().map(Math.abs), ...bounds.max.toArray().map(Math.abs));
    this.precision = Math.max(bounds.getSize(new Vector3()).length() * 1e-10, magnitude * Number.EPSILON * 32, 1e-10);
  }

  resolve(evidence: MeasurementEvidence): RadialPlacement {
    const cached = this.cache.get(evidence);
    if (cached) {
      return cached;
    }
    const placement = this.compute(evidence);
    this.cache.set(evidence, placement);
    return placement;
  }

  private compute(evidence: MeasurementEvidence): RadialPlacement {
    if (!evidence.distance) {
      return result('degenerate', new Vector3(), 0, 0);
    }
    const start = new Vector3(...evidence.distance.start);
    const end = new Vector3(...evidence.distance.end);
    const axis = end.clone().sub(start);
    const length = axis.length();
    if (length <= this.precision) {
      return result('degenerate', new Vector3(), 0, 0);
    }
    axis.divideScalar(length);
    // Reversing the selected endpoints must not rotate the radial basis.
    let dominant: 'x' | 'y' | 'z' = 'x';
    for (const coordinate of ['y', 'z'] as const) {
      if (Math.abs(axis[coordinate]) > Math.abs(axis[dominant])) {
        dominant = coordinate;
      }
    }
    if (axis[dominant] < 0) {
      axis.negate();
    }
    const reference = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)].sort(
      (a, b) => Math.abs(a.dot(axis)) - Math.abs(b.dot(axis)),
    )[0]!;
    const u = reference.addScaledVector(axis, -reference.dot(axis)).normalize();
    const v = axis.clone().cross(u).normalize();
    const center = start.clone().add(end).multiplyScalar(0.5);
    const sections = [start, center, end];
    const radius = length * 0.06;
    const near = Math.max(this.precision, length * 1e-9);
    const ray = new Ray();
    const segmentRay = new Ray(new Vector3(), end.clone().sub(start).normalize());
    const direction = (angle: number) => u.clone().multiplyScalar(Math.cos(angle)).addScaledVector(v, Math.sin(angle));
    const occupied = (origin: Vector3, d: Vector3): boolean => {
      ray.origin.copy(origin);
      ray.direction.copy(d);
      const hit = this.tree.raycastFirst(ray, DoubleSide, near);
      if (!hit) {
        return false;
      }
      if (!hit.face) {
        throw new Error('The radial clearance query returned no face normal.');
      }
      // Near intersections block the offset. A farther first EXIT means the
      // ray started inside the solid, even if its boundary is beyond the radius.
      if (hit.distance <= radius + near || hit.face.normal.dot(d) > 0) {
        return true;
      }
      // An entry into a farther, nested component can precede the containing
      // solid's exit. Signed crossings distinguish that from genuinely empty space.
      const hits = this.tree.raycast(ray, DoubleSide, near).sort((a, b) => a.distance - b.distance);
      let winding = 0;
      let groupDistance = -Infinity;
      let entering = false;
      let exiting = false;
      const finishGroup = () => {
        if (entering !== exiting) {
          winding += exiting ? 1 : -1;
        }
      };
      for (const crossing of hits) {
        if (!crossing.face) {
          throw new Error('The radial clearance query returned no face normal.');
        }
        if (crossing.distance - groupDistance > near * 4) {
          finishGroup();
          groupDistance = crossing.distance;
          entering = false;
          exiting = false;
        }
        const facing = crossing.face.normal.dot(d);
        entering ||= facing < -1e-10;
        exiting ||= facing > 1e-10;
      }
      finishGroup();
      return winding > 0;
    };
    const clear = (d: Vector3): boolean => {
      if (sections.some(origin => occupied(origin, d))) {
        return false;
      }
      segmentRay.origin.copy(start).addScaledVector(d, radius);
      return this.tree.raycastFirst(segmentRay, DoubleSide, near, length - near) === null;
    };

    for (const samples of [360, 720]) {
      const step = (Math.PI * 2) / samples;
      const blocked = Array.from({ length: samples }, (_, index) => !clear(direction((index + 0.5) * step)));
      let sector = largestFreeSector(blocked);
      while (sector) {
        const middleIndex = sector.start + sector.count / 2;
        const middle = direction(middleIndex * step);
        if (clear(middle)) {
          return result('free', middle.multiplyScalar(radius), radius, (sector.count * 360) / samples);
        }
        // A thin obstruction can fall between angular samples. Split that
        // interval before considering the next widest remaining opening.
        blocked[Math.floor(middleIndex) % samples] = true;
        sector = largestFreeSector(blocked);
      }
    }
    // No sampled local opening: stay on the measured segment rather than
    // inventing a clear direction or extending leaders across the model.
    return result('blocked', new Vector3(), radius, 0);
  }
}

function result(
  kind: RadialPlacement['kind'],
  offset: Vector3,
  radius: number,
  freeAngleDegrees: number,
): RadialPlacement {
  const tuple: [number, number, number] = [offset.x, offset.y, offset.z];
  return Object.freeze({ kind, offset: Object.freeze(tuple), radius, freeAngleDegrees });
}
