import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MeasurementEvidence, MeasurementVec3 } from '../packages/protocol/src/wire/measurements.js';
import { layoutDimension, projectMeasurement } from '../packages/viewer/src/measurements/projection.js';

function cameraAt(x = 0, y = 0, z = 10) {
  const camera = new THREE.PerspectiveCamera(60, 2, 0.1, 100);
  camera.up.set(0, 1, 0);
  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function distance(a: MeasurementVec3, b: MeasurementVec3): MeasurementEvidence {
  return {
    kind: 'relation',
    operands: [
      { kind: 'point', position: a },
      { kind: 'point', position: b },
    ],
    distance: {
      method: 'point-point',
      value: new THREE.Vector3(...a).distanceTo(new THREE.Vector3(...b)),
      unit: 'mm',
      start: a,
      end: b,
    },
  };
}

describe('model-anchored measurement projection', () => {
  it('projects the offset endpoints and keeps guides connected to the actual measured endpoints', () => {
    const camera = cameraAt();
    const evidence = distance([-2, 0, 0], [2, 0, 0]);
    const projected = projectMeasurement(evidence, [0, 0, 0], camera, new THREE.Matrix4(), 800, 400, [0, 1, 0])!;
    expect(projected.x).toBeCloseTo(400);
    expect(projected.y).toBeLessThan(200);
    expect(projected.segment!.sourceStart!.y).toBeCloseTo(200);
    const layout = layoutDimension(projected, 50);
    expect(layout.x).toBe(projected.x);
    expect(layout.y).toBe(projected.y);
    expect(layout.rotation).toBeCloseTo(0);
    expect(layout.strokes.some(stroke => stroke.start === projected.segment!.sourceStart)).toBe(true);
    expect(evidence.distance!.value).toBe(4);
  });

  it('keeps the exact same model-space offset across camera orbits and model presentation transforms', () => {
    const evidence = distance([-2, 0, 0], [2, 0, 0]);
    const model = new THREE.Matrix4().makeRotationZ(0.3).setPosition(0.2, -0.1, 0);
    for (const camera of [cameraAt(), cameraAt(6, 4, 8), cameraAt(-6, 4, 8)]) {
      const projected = projectMeasurement(evidence, [0, 0, 0], camera, model, 800, 400, [0, 1, 0])!;
      const unproject = (point: { x: number; y: number; depth: number }) =>
        new THREE.Vector3(point.x / 400 - 1, 1 - point.y / 200, point.depth)
          .unproject(camera)
          .applyMatrix4(model.clone().invert());
      expect(unproject(projected.segment!.start).distanceTo(new THREE.Vector3(-2, 1, 0))).toBeLessThan(1e-8);
      expect(unproject(projected.segment!.sourceStart!).distanceTo(new THREE.Vector3(-2, 0, 0))).toBeLessThan(1e-8);
      expect(unproject(projected).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-8);
    }
  });

  it('does not move a short reading away from its model-fixed midpoint to make the text fit', () => {
    const evidence = distance([-0.01, 0, 0], [0.01, 0, 0]);
    const projected = projectMeasurement(evidence, [0, 0, 0], cameraAt(), new THREE.Matrix4(), 800, 400, [0, 1, 0])!;
    const layout = layoutDimension(projected, 90);
    expect(layout.x).toBe(projected.x);
    expect(layout.y).toBe(projected.y);
  });

  it('clips displaced segments crossing the near plane without projecting a guide behind the eye', () => {
    const projected = projectMeasurement(
      distance([0, 0, 11], [2, 0, 0]),
      [1, 0, 5.5],
      cameraAt(),
      new THREE.Matrix4(),
      800,
      400,
    )!;
    expect(projected.segment!.clippedStart).toBe(true);
    expect(projected.segment!.sourceStart).toBeNull();
    expect(projected.x).toBeGreaterThanOrEqual(0);
    expect(projected.x).toBeLessThanOrEqual(800);
    expect(
      projectMeasurement(distance([0, 0, 11], [0, 1, 12]), [0, 0, 11], cameraAt(), new THREE.Matrix4(), 800, 400),
    ).toBeNull();
  });
});
