import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MeasurementEvidence, MeasurementVec3 } from '../packages/protocol/src/wire/measurements.js';
import { RadialPlacementResolver, largestFreeSector } from '../packages/viewer/src/measurements/radial-placement.js';
import { prepareMeshPicking } from '../packages/viewer/src/scene/mesh-picking.js';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0)) {
    dispose();
  }
});

function fixture(geometry: THREE.BufferGeometry) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  prepareMeshPicking(mesh);
  const tree = geometry.boundsTree;
  if (!(tree instanceof MeshBVH)) {
    throw new Error('The measurement fixture did not create a mesh BVH.');
  }
  cleanup.push(() => {
    geometry.dispose();
    mesh.material.dispose();
  });
  return { resolver: new RadialPlacementResolver(geometry), tree };
}

function edge(start: MeasurementVec3, end: MeasurementVec3): MeasurementEvidence {
  return {
    kind: 'edge-length',
    operands: [{ kind: 'edge', edgeId: 'edge', start, end }],
    distance: {
      method: 'segment-length',
      unit: 'mm',
      value: new THREE.Vector3(...start).distanceTo(new THREE.Vector3(...end)),
      start,
      end,
    },
  };
}

function postPair(obstacle?: THREE.BufferGeometry, opposed = false) {
  const left = new THREE.CylinderGeometry(1, 1, 2, 32).rotateX(Math.PI / 2).translate(-5, 0, 0);
  const right = new THREE.CylinderGeometry(1, 1, 2, 32).rotateX(Math.PI / 2).translate(5, 0, opposed ? 2 : 0);
  const parts = obstacle ? [left, right, obstacle] : [left, right];
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) {
    part.dispose();
  }
  return fixture(geometry);
}

describe('model-space radial dimension placement', () => {
  it('chooses the common opening above both post tops instead of empty midpoint space', () => {
    const { resolver } = postPair();
    const first = resolver.resolve(edge([-5, 0, 1], [5, 0, 1]));
    expect(first.kind).toBe('free');
    expect(first.offset[2]).toBeGreaterThan(0.59);
    expect(Math.abs(first.offset[1])).toBeLessThan(0.01);
    expect(first.freeAngleDegrees).toBeLessThan(181);
    expect(resolver.resolve(edge([5, 0, 1], [-5, 0, 1])).offset).toEqual(first.offset);
  });

  it('does not force an offset when endpoint openings conflict despite an empty midpoint', () => {
    const { resolver } = postPair(undefined, true);
    expect(resolver.resolve(edge([-5, 0, 1], [5, 0, 1]))).toMatchObject({
      kind: 'blocked',
      offset: [0, 0, 0],
      freeAngleDegrees: 0,
    });
  });

  it.each([0.3, 0.0005])(
    'checks the complete shifted segment for a width-%s obstruction between the three sections',
    width => {
      const obstacle = new THREE.BoxGeometry(0.3, width, 0.3).translate(-2.5, 0, 1.6);
      const { resolver, tree } = postPair(obstacle);
      const first = resolver.resolve(edge([-5, 0, 1], [5, 0, 1]));
      expect(first.kind).toBe('free');
      expect(first.offset[2]).toBeGreaterThan(0);
      expect(Math.abs(first.offset[1])).toBeGreaterThan(0.1);
      const shiftedStart = new THREE.Vector3(-5, 0, 1).add(new THREE.Vector3(...first.offset));
      const ray = new THREE.Ray(shiftedStart, new THREE.Vector3(1, 0, 0));
      expect(tree.raycastFirst(ray, THREE.DoubleSide, 1e-8, 10 - 1e-8)).toBeNull();
      expect(resolver.resolve(edge([5, 0, 1], [-5, 0, 1])).offset).toEqual(first.offset);
    },
  );

  it('merges the maximum free sector across the zero-degree boundary and resolves ties deterministically', () => {
    expect(largestFreeSector([false, false, true, true, true, false, false, false])).toEqual({ start: 5, count: 5 });
    expect(largestFreeSector([false, false, true, false, false, true])).toEqual({ start: 0, count: 2 });
    expect(largestFreeSector([false, false, false])).toEqual({ start: 0, count: 3 });
    expect(largestFreeSector([true, true, true])).toBeNull();
    expect(() => largestFreeSector([])).toThrow(/empty/);
  });

  it('bisects the exterior 270-degree sector of a convex edge', () => {
    const { resolver } = fixture(new THREE.BoxGeometry(2, 2, 2));
    const placement = resolver.resolve(edge([1, 1, -1], [1, 1, 1]));
    expect(placement.kind).toBe('free');
    expect(placement.freeAngleDegrees).toBeCloseTo(270, 0);
    const direction = new THREE.Vector3(...placement.offset).normalize();
    expect(direction.dot(new THREE.Vector3(1, 1, 0).normalize())).toBeGreaterThan(0.999);
    expect(placement.radius).toBeCloseTo(0.12);
    expect(Math.abs(direction.z)).toBeLessThan(1e-10);
  });

  it('bisects the open 90-degree sector of a concave edge', () => {
    const shape = new THREE.Shape();
    shape.moveTo(-1, -1);
    for (const [x, y] of [
      [1, -1],
      [1, 0],
      [0, 0],
      [0, 1],
      [-1, 1],
    ] as const) {
      shape.lineTo(x, y);
    }
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false }).translate(0, 0, -1);
    const placement = fixture(geometry).resolver.resolve(edge([0, 0, -1], [0, 0, 1]));
    expect(placement.kind).toBe('free');
    expect(placement.freeAngleDegrees).toBeCloseTo(90, 0);
    expect(
      new THREE.Vector3(...placement.offset).normalize().dot(new THREE.Vector3(1, 1, 0).normalize()),
    ).toBeGreaterThan(0.999);
  });

  it('accounts for a nearby second solid instead of following only the incident face normals', () => {
    const cube = new THREE.BoxGeometry(2, 2, 2);
    const obstacle = new THREE.BoxGeometry(0.1, 0.1, 2).translate(1.08, 1, 0);
    const geometry = mergeGeometries([cube, obstacle])!;
    cube.dispose();
    obstacle.dispose();
    const placement = fixture(geometry).resolver.resolve(edge([1, 1, -1], [1, 1, 1]));
    expect(placement.kind).toBe('free');
    expect(placement.freeAngleDegrees).toBeLessThan(180);
    expect(placement.offset[0]).toBeLessThan(0);
    expect(placement.offset[1]).toBeGreaterThan(0);
  });

  it('caches the model-space choice and is invariant to endpoint reversal', () => {
    const { resolver, tree } = fixture(new THREE.BoxGeometry(2, 2, 2));
    const query = vi.spyOn(tree, 'raycastFirst');
    const measurement = edge([1, 1, -1], [1, 1, 1]);
    const first = resolver.resolve(measurement);
    const queries = query.mock.calls.length;
    expect(queries).toBeGreaterThanOrEqual(360);
    expect(resolver.resolve(measurement)).toBe(first);
    expect(query).toHaveBeenCalledTimes(queries);
    expect(resolver.resolve(edge([1, 1, 1], [1, 1, -1])).offset).toEqual(first.offset);
    expect(Object.isFrozen(first.offset)).toBe(true);
  });

  it('does not invent free space when the midpoint is enclosed in material', () => {
    const { resolver } = fixture(new THREE.BoxGeometry(2, 2, 2));
    expect(resolver.resolve(edge([0, 0, -0.5], [0, 0, 0.5]))).toMatchObject({
      kind: 'blocked',
      offset: [0, 0, 0],
      freeAngleDegrees: 0,
    });

    expect(resolver.resolve(edge([0, 0, 0], [0, 0, 0]))).toMatchObject({ kind: 'degenerate', offset: [0, 0, 0] });
  });

  it('does not mistake entry into a nested component for being outside the containing solid', () => {
    const outer = new THREE.BoxGeometry(4, 4, 4);
    const inner = new THREE.BoxGeometry(1, 1, 2).translate(1, 0, 0);
    const geometry = mergeGeometries([outer, inner])!;
    outer.dispose();
    inner.dispose();
    expect(fixture(geometry).resolver.resolve(edge([0, 0, -0.5], [0, 0, 0.5]))).toMatchObject({
      kind: 'blocked',
      offset: [0, 0, 0],
    });
  });
});
