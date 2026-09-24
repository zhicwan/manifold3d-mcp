import * as THREE from 'three';
import type { MeasurementEvidence, MeasurementVec3 } from '@manifold3d/protocol/wire/measurements.js';

export interface ScreenPoint {
  x: number;
  y: number;
}
export interface DepthPoint extends ScreenPoint {
  depth: number;
}
export interface DimensionStroke {
  start: DepthPoint;
  end: DepthPoint;
}

export interface ProjectedMeasurement extends DepthPoint {
  segment?: {
    start: DepthPoint;
    end: DepthPoint;
    sourceStart: DepthPoint | null;
    sourceEnd: DepthPoint | null;
    clippedStart: boolean;
    clippedEnd: boolean;
  };
}

/** Projection never chooses a side: the offset is fixed in canonical model space. */
export function projectMeasurement(
  evidence: MeasurementEvidence | null,
  anchor: MeasurementVec3,
  camera: THREE.Camera,
  modelMatrix: THREE.Matrix4,
  width: number,
  height: number,
  modelOffset: readonly [number, number, number] = [0, 0, 0],
): ProjectedMeasurement | null {
  if (width <= 0 || height <= 0) {
    return null;
  }
  const transform = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .multiply(modelMatrix);
  const clip = (point: MeasurementVec3, shift = false) =>
    new THREE.Vector4(
      point[0] + (shift ? modelOffset[0] : 0),
      point[1] + (shift ? modelOffset[1] : 0),
      point[2] + (shift ? modelOffset[2] : 0),
      1,
    ).applyMatrix4(transform);
  const screen = (point: THREE.Vector4): DepthPoint => ({
    x: ((point.x / point.w + 1) * width) / 2,
    y: ((1 - point.y / point.w) * height) / 2,
    depth: point.z / point.w,
  });
  const sourcePoint = (point: THREE.Vector4): DepthPoint | null =>
    point.w > 0 && Math.abs(point.z) <= point.w ? screen(point) : null;
  if (!evidence?.distance) {
    const point = clip(anchor);
    if (point.w <= 0 || Math.abs(point.x) > point.w || Math.abs(point.y) > point.w || Math.abs(point.z) > point.w) {
      return null;
    }
    return screen(point);
  }
  const a = clip(evidence.distance.start, true);
  const b = clip(evidence.distance.end, true);
  const centerClip = a.clone().add(b).multiplyScalar(0.5);
  if (
    centerClip.w <= 0 ||
    Math.abs(centerClip.x) > centerClip.w ||
    Math.abs(centerClip.y) > centerClip.w ||
    Math.abs(centerClip.z) > centerClip.w
  ) {
    return null;
  }
  let low = 0;
  let high = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const sign of [-1, 1]) {
      const fa = a.w + sign * a[axis];
      const fb = b.w + sign * b[axis];
      if (fa < 0 && fb < 0) {
        return null;
      }
      if (fa < 0) {
        low = Math.max(low, fa / (fa - fb));
      }
      if (fb < 0) {
        high = Math.min(high, fa / (fa - fb));
      }
    }
  }
  if (low > high) {
    return null;
  }
  const startClip = a.clone().lerp(b, low);
  const endClip = a.clone().lerp(b, high);
  if (startClip.w <= 0 || endClip.w <= 0) {
    return null;
  }
  const start = screen(startClip);
  const end = screen(endClip);
  return {
    ...screen(centerClip),
    segment: {
      start,
      end,
      sourceStart: low === 0 ? sourcePoint(clip(evidence.distance.start)) : null,
      sourceEnd: high === 1 ? sourcePoint(clip(evidence.distance.end)) : null,
      clippedStart: low > 0,
      clippedEnd: high < 1,
    },
  };
}

export function layoutDimension(projected: ProjectedMeasurement, textWidth: number) {
  const strokes: DimensionStroke[] = [];
  const segment = projected.segment;
  if (!segment) {
    return { x: projected.x, y: projected.y - 16, rotation: 0, strokes };
  }
  const { start, end } = segment;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < 1) {
    return { x: projected.x, y: projected.y, rotation: 0, strokes };
  }
  const ux = (end.x - start.x) / length;
  const uy = (end.y - start.y) / length;
  // Only the text's reading direction is normalized; this never moves the dimension.
  const direction = ux < 0 || (Math.abs(ux) < 1e-8 && uy > 0) ? -1 : 1;
  const nx = uy * direction;
  const ny = -ux * direction;
  const gap = textWidth / 2 + 7;
  const middle = Math.max(0, Math.min(1, ((projected.x - start.x) * ux + (projected.y - start.y) * uy) / length));
  const at = (t: number): DepthPoint => ({
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    depth: start.depth + (end.depth - start.depth) * t,
  });
  if (length * middle > gap + 8 && length * (1 - middle) > gap + 8) {
    strokes.push({ start, end: at(middle - gap / length) }, { start: at(middle + gap / length), end });
  } else {
    strokes.push({ start, end });
  }
  for (const [source, endpoint, clipped] of [
    [segment.sourceStart, start, segment.clippedStart],
    [segment.sourceEnd, end, segment.clippedEnd],
  ] as const) {
    if (!clipped) {
      if (source) {
        strokes.push({ start: source, end: endpoint });
      }
      strokes.push({
        start: { x: endpoint.x - nx * 4, y: endpoint.y - ny * 4, depth: endpoint.depth },
        end: { x: endpoint.x + nx * 4, y: endpoint.y + ny * 4, depth: endpoint.depth },
      });
    }
  }
  return {
    x: projected.x,
    y: projected.y,
    rotation: (Math.atan2(uy * direction, ux * direction) * 180) / Math.PI,
    strokes,
  };
}
