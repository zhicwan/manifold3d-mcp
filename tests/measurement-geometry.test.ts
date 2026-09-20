import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';
import type {
  MeasurementEvidence,
  MeasurementOperand,
  MeasurementVec3,
} from '@manifold3d/protocol/wire/measurements.js';
import { parseMeasurementEvidence } from '@manifold3d/protocol/wire/measurements.js';
import { MeasurementGeometry, type MeasurementCandidate } from '../packages/viewer/src/measurements/geometry.js';

function model(points: number[], indices: number[], merges: [number, number][] = []): ViewerModel {
  return {
    numProp: 3,
    vertices: points.length / 3,
    triangles: indices.length / 3,
    vertProperties: new Float32Array(points),
    triVerts: new Uint32Array(indices),
    mergeFromVert: new Uint32Array(merges.map(([a]) => a)),
    mergeToVert: new Uint32Array(merges.map(([, b]) => b)),
    triFeatureIds: new Uint32Array(),
    features: [],
    volume: 0,
    surfaceArea: 0,
    genus: 0,
    bboxMin: [-10, -10, -10],
    bboxMax: [10, 10, 10],
  };
}

function cube(subdivisions = 1, seams = true): ViewerModel {
  const box = new THREE.BoxGeometry(2, 2, 2, subdivisions, subdivisions, subdivisions);
  return meshModel(box, seams);
}

function meshModel(box: THREE.BufferGeometry, seams = true): ViewerModel {
  const position = box.getAttribute('position');
  const points = Array.from(position.array);
  const ids = new Map<string, number>();
  const merges: [number, number][] = [];
  for (let i = 0; i < position.count; i++) {
    // Three's cylinder seam contains sin(2π) roundoff; explicitly declare those
    // fixture vertices welded, as a Manifold mesh's merge mapping would.
    const key = [position.getX(i), position.getY(i), position.getZ(i)]
      .map(value => (Math.abs(value) < 1e-12 ? 0 : value))
      .join(':');
    const other = ids.get(key);
    if (other !== undefined && seams) {
      merges.push([i, other]);
    } else {
      ids.set(key, i);
    }
  }
  const result = model(points, Array.from(box.index!.array), merges);
  box.dispose();
  return result;
}

let sequence = 0;
function candidate(operand: MeasurementOperand): MeasurementCandidate {
  return {
    key: `test:${sequence++}`,
    operand,
    triIds: [],
    anchor: operand.kind === 'point' ? operand.position : operand.kind === 'edge' ? operand.start : operand.origin,
  };
}
const point = (position: MeasurementVec3): MeasurementCandidate => candidate({ kind: 'point', position });
const edge = (start: MeasurementVec3, end: MeasurementVec3): MeasurementCandidate =>
  candidate({ kind: 'edge', edgeId: `e${sequence}`, start, end });
const plane = (origin: MeasurementVec3, normal: MeasurementVec3): MeasurementCandidate => {
  const length = Math.hypot(...normal);
  return candidate({
    kind: 'plane',
    patchId: 1_000_000,
    triangleId: 1_000_000,
    origin,
    normal: length === 0 ? normal : (normal.map(component => component / length) as MeasurementVec3),
  });
};
function relation(result: MeasurementEvidence | null): Extract<MeasurementEvidence, { kind: 'relation' }> {
  expect(result?.kind).toBe('relation');
  if (result?.kind !== 'relation') {
    throw new Error('Expected relation.');
  }
  expect(parseMeasurementEvidence(result)).toEqual(result);
  return result;
}

describe('canonical measurement topology', () => {
  it('does not offer a center outside a concave face boundary', () => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    for (const [x, y] of [
      [4, 0],
      [4, 4],
      [3, 4],
      [3, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ] as const) {
      shape.lineTo(x, y);
    }
    shape.closePath();
    const mesh = new THREE.ShapeGeometry(shape);
    try {
      const geometry = new MeasurementGeometry(
        model(Array.from(mesh.getAttribute('position').array), Array.from(mesh.index!.array)),
      );
      expect(geometry.planes).toHaveLength(1);
      expect(geometry.centers).toHaveLength(0);
      expect(geometry.centerForPatch(geometry.planes[0]!.triIds[0]!)).toBeNull();
    } finally {
      mesh.dispose();
    }
  });

  it('computes the same area centroid for different triangulations rather than averaging vertices', () => {
    const rectangle = new MeasurementGeometry(model([0, 0, 0, 4, 0, 0, 4, 2, 0, 0, 2, 0], [0, 1, 2, 0, 2, 3]));
    const subdivided = new MeasurementGeometry(
      model([0, 0, 0, 4, 0, 0, 4, 2, 0, 0, 2, 0, 0.25, 0.25, 0], [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]),
    );
    for (const geometry of [rectangle, subdivided]) {
      expect(geometry.centers).toHaveLength(1);
      expect(geometry.centers[0]!.operand).toMatchObject({
        kind: 'point',
        position: [2, 1, 0],
        faceCenter: { patchId: 0, onSurface: true },
      });
    }
  });

  it('does not offer a center inside a hole', () => {
    const geometry = new MeasurementGeometry(
      model(
        [-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
        [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7],
      ),
    );
    expect(geometry.centers).toHaveLength(0);
    expect(geometry.candidates.some(item => item.key.startsWith('face-center:'))).toBe(false);
  });

  it.each([
    [16, 2, 4],
    [32, 2, 4],
    [64, 2, 4],
    [48, 20, 0.1],
    [32, 0.02, 0.04],
  ])(
    'keeps cylinder caps but hides curved-side facet centers (%i segments, radius %f, height %f)',
    (segments, radius, height) => {
      const geometry = new MeasurementGeometry(meshModel(new THREE.CylinderGeometry(radius, radius, height, segments)));
      expect(geometry.centers).toHaveLength(2);
      for (const center of geometry.centers) {
        expect(Math.abs(center.anchor[1])).toBeCloseTo(height / 2, 5);
        expect(center.anchor[0]).toBeCloseTo(0, 5);
        expect(center.anchor[2]).toBeCloseTo(0, 5);
      }
      expect(geometry.planes.length).toBeGreaterThan(2);
    },
  );

  it('keeps small sharp-edged faces rather than filtering by absolute area', () => {
    const geometry = new MeasurementGeometry(meshModel(new THREE.BoxGeometry(0.001, 0.002, 0.003)));
    expect(geometry.centers).toHaveLength(6);
    expect(
      geometry.centers.every(item => item.operand.kind === 'point' && item.operand.faceCenter?.onSurface === true),
    ).toBe(true);
  });

  it('keeps separate centers for disconnected coplanar regions', () => {
    const geometry = new MeasurementGeometry(
      model([0, 0, 0, 2, 0, 0, 0, 2, 0, 10, 0, 0, 12, 0, 0, 10, 2, 0], [0, 1, 2, 3, 4, 5]),
    );
    expect(geometry.centers).toHaveLength(2);
    expect(geometry.centers[1]!.anchor[0] - geometry.centers[0]!.anchor[0]).toBeCloseTo(10);
    expect(relation(geometry.measure(geometry.centers[0]!, geometry.centers[1]!)).distance?.value).toBeCloseTo(10);
  });

  it('welds declared seams, removes diagonals and coalesces subdivided cube edges', () => {
    const payload = cube(4);
    const before = payload.triVerts.slice();
    const geometry = new MeasurementGeometry(payload);
    expect(geometry.planes).toHaveLength(6);
    expect(geometry.edges).toHaveLength(12);
    expect(geometry.vertices).toHaveLength(98);
    expect(geometry.diagnostics).toEqual([]);
    for (const measuredEdge of geometry.edges) {
      expect(geometry.measure(measuredEdge)?.distance?.value).toBeCloseTo(2);
      expect(parseMeasurementEvidence(geometry.measure(measuredEdge))).toEqual(geometry.measure(measuredEdge));
      expect(measuredEdge.triIds).toHaveLength(64);
    }
    expect(geometry.planeForTriangle(0)?.triIds).toHaveLength(32);
    expect(payload.triVerts).toEqual(before);
    expect(new MeasurementGeometry(payload).candidates).toEqual(geometry.candidates);
    expect(new MeasurementGeometry(cube(4, false)).edges).toHaveLength(24);
  });

  it('does not proximity-weld touching triangle soup or disconnected coplanar islands', () => {
    const geometry = new MeasurementGeometry(
      model([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], [0, 1, 2, 3, 4, 5]),
    );
    expect(geometry.planes).toHaveLength(2);
    expect(geometry.edges).toHaveLength(6);
    expect(geometry.vertices).toHaveLength(6);
  });

  it('checks normals and a common seed plane instead of drifting along curved strips', () => {
    const points: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= 20; i++) {
      points.push(i, 0, i * i * 2e-6, i, 1, i * i * 2e-6);
    }
    for (let i = 0; i < 20; i++) {
      indices.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    }
    const geometry = new MeasurementGeometry(model(points, indices));
    expect(geometry.planes.length).toBeGreaterThan(3);
    expect(geometry.planes.every(patch => patch.triIds.length < 12)).toBe(true);
  });

  it('stops straight boundary chains at a branch or supporting patch change', () => {
    const geometry = new MeasurementGeometry(
      model([-1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, -1, 0], [0, 1, 2, 1, 3, 4]),
    );
    expect(geometry.edges).toHaveLength(6);
    expect(geometry.edges.every(e => geometry.measure(e)?.distance?.value !== 2)).toBe(true);
  });

  it('omits degenerate triangles diagnostically and rejects corrupt buffers/merges', () => {
    const payload = model([0, 0, 0, 1, 0, 0, 2, 0, 0], [0, 1, 2]);
    const geometry = new MeasurementGeometry(payload);
    expect(geometry.candidates).toEqual([]);
    expect(geometry.diagnostics).toEqual(['Omitted degenerate triangle 0.']);
    expect(geometry.planeForTriangle(0)).toBeNull();
    expect(() => new MeasurementGeometry({ ...payload, numProp: 2 })).toThrow(RangeError);
    expect(() => new MeasurementGeometry({ ...payload, triVerts: new Uint32Array([0, 1, 7]) })).toThrow(RangeError);
    expect(
      () =>
        new MeasurementGeometry({ ...payload, mergeFromVert: new Uint32Array([0]), mergeToVert: new Uint32Array([1]) }),
    ).toThrow(RangeError);
  });
});

describe('complete distance/angle matrix', () => {
  const geometry = new MeasurementGeometry(cube());

  it('retains single edge length, not a single point/plane or identical candidate', () => {
    const a = edge([0, 0, 0], [3, 4, 0]);
    expect(geometry.measure(a)).toMatchObject({
      kind: 'edge-length',
      distance: { method: 'segment-length', value: 5 },
    });
    expect(geometry.measure(point([0, 0, 0]))).toBeNull();
    expect(geometry.measure(geometry.planes[0]!)).toBeNull();
    expect(geometry.measure(a, a)).toBeNull();
    expect(() => geometry.measure(edge([1, 1, 1], [1, 1, 1]))).toThrow(/degenerate/);
    expect(() => geometry.measure(plane([0, 0, 0], [0, 0, 0]))).toThrow(/degenerate/);
    expect(() => geometry.measure(point([NaN, 0, 0]))).toThrow(/finite/);
    expect(geometry.measure(edge([0, 0, 0], [1e-12, 0, 0]))?.distance?.value).toBe(1e-12);
  });

  it('measures point-point including distinct coincident points', () => {
    expect(relation(geometry.measure(point([0, 0, 0]), point([2, 3, 6]))).distance).toMatchObject({
      method: 'point-point',
      value: 7,
      start: [0, 0, 0],
      end: [2, 3, 6],
    });
    expect(relation(geometry.measure(point([1, 2, 3]), point([1, 2, 3]))).distance?.value).toBe(0);
  });

  it.each([
    [[1, 3, 0], [1, 0, 0], 3],
    [[-2, 0, 0], [0, 0, 0], 2],
    [[5, 0, 0], [2, 0, 0], 3],
  ] as [MeasurementVec3, MeasurementVec3, number][])('uses finite segment witnesses for %j', (p, foot, value) => {
    const a = point(p);
    const b = edge([0, 0, 0], [2, 0, 0]);
    expect(relation(geometry.measure(a, b)).distance).toMatchObject({
      method: 'point-segment',
      value,
      start: p,
      end: foot,
    });
    expect(relation(geometry.measure(b, a)).distance).toMatchObject({ value, start: foot, end: p });
    expect(relation(geometry.measure(a, edge([2, 0, 0], [0, 0, 0]))).distance?.value).toBe(value);
  });

  it('measures perpendicular supporting-plane feet inside, outside and in a hole', () => {
    const ring = new MeasurementGeometry(
      model(
        [-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0],
        [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7, 8, 9, 10],
      ),
    );
    expect(ring.planes).toHaveLength(2);
    expect(ring.edges).toHaveLength(11);
    const patch = ring.planeForTriangle(0)!;
    const inside = relation(ring.measure(point([1.5, 0, 3]), patch));
    expect(inside.distance).toMatchObject({ method: 'point-plane', value: 3, end: [1.5, 0, 0] });
    expect(inside.distance?.extended).toBeUndefined();
    for (const p of [
      [0, 0, 3],
      [3, 0, 3],
      [4.1, 0.1, 3],
    ] as MeasurementVec3[]) {
      expect(relation(ring.measure(point(p), patch)).distance?.extended).toBe(true);
    }
    const flipped = candidate({
      ...patch.operand,
      kind: 'plane',
      patchId: 0,
      triangleId: 0,
      origin: [-2, -2, 0],
      normal: [0, 0, -1],
    });
    expect(relation(ring.measure(point([1.5, 0, 3]), flipped)).distance).toEqual(inside.distance);
  });

  it.each([
    [[0, 2, 0], [2, 2, 0], 2, 0],
    [[1, -1, 0], [1, 1, 0], 0, 90],
    [[1, -1, 3], [1, 1, 3], 3, 90],
    [[1, 0, 0], [3, 0, 0], 0, 0],
    [[3, 0, 0], [4, 0, 0], 1, 0],
  ] as [MeasurementVec3, MeasurementVec3, number, number][])('finite edge-edge %j to %j', (c, d, gap, angle) => {
    for (const [a, b] of [
      [
        [0, 0, 0],
        [2, 0, 0],
      ],
      [
        [2, 0, 0],
        [0, 0, 0],
      ],
    ] as [MeasurementVec3, MeasurementVec3][]) {
      const first = edge(a, b);
      const second = edge(c, d);
      for (const [u, v] of [
        [first, second],
        [second, first],
      ]) {
        const result = relation(geometry.measure(u!, v!));
        expect(result.distance?.value).toBeCloseTo(gap);
        expect(result.angle?.value).toBeCloseTo(angle);
        expect(
          new THREE.Vector3(...result.distance!.start).distanceTo(new THREE.Vector3(...result.distance!.end)),
        ).toBeCloseTo(gap);
      }
    }
  });

  it('uses a stable closest-line solve for nearly parallel finite segments', () => {
    const result = relation(geometry.measure(edge([0, 0, 0], [1e8, 0, 0]), edge([0, -0.5, 0], [1e8, 0.5, 0])));
    expect(result.distance?.value).toBeCloseTo(0, 12);
    expect(result.distance?.start[0]).toBeCloseTo(5e7);
    expect(result.angle!.value).toBeGreaterThan(0);
  });

  it.each([0, 30, 60, 90, 120])('reports smaller unoriented angles for %s degrees', degrees => {
    const rad = (degrees * Math.PI) / 180;
    const direction: MeasurementVec3 = [Math.cos(rad), Math.sin(rad), 0];
    const smaller = Math.min(degrees, 180 - degrees);
    for (const sign of [-1, 1]) {
      const n = direction.map(v => v * sign) as MeasurementVec3;
      expect(
        relation(geometry.measure(edge([0, 0, 0], [1, 0, 0]), edge([0, 0, 1], [n[0], n[1], 1]))).angle?.value,
      ).toBeCloseTo(smaller);
      expect(relation(geometry.measure(plane([0, 0, 0], [1, 0, 0]), plane([0, 0, 0], n))).angle?.value).toBeCloseTo(
        smaller,
      );
      expect(relation(geometry.measure(edge([0, 0, 0], n), plane([0, 0, 0], [1, 0, 0]))).angle?.value).toBeCloseTo(
        90 - smaller,
      );
    }
  });

  it.each([30, 90, 120, 180])(
    'measures a shared-endpoint corner as %s degrees independent of endpoint order',
    degrees => {
      const radians = (degrees * Math.PI) / 180;
      const origin: MeasurementVec3 = [40, 17, 8];
      const a: MeasurementVec3 = [50, 17, 8];
      const b: MeasurementVec3 = [40 + 10 * Math.cos(radians), 17 + 10 * Math.sin(radians), 8];
      for (const first of [edge(origin, a), edge(a, origin)]) {
        for (const second of [edge(origin, b), edge(b, origin)]) {
          for (const pair of [
            [first, second],
            [second, first],
          ]) {
            const result = relation(geometry.measure(pair[0]!, pair[1]!));
            expect(result.angle?.method).toBe('edge-corner');
            expect(result.angle?.value).toBeCloseTo(degrees, 8);
            expect(result.distance?.value).toBeCloseTo(0, 12);
          }
        }
      }
    },
  );

  it('reports edge-plane gaps only for parallel directions, independent of order', () => {
    const a = edge([0, 0, 3], [2, 0, 3]);
    const b = plane([0, 0, 0], [0, 0, -2]);
    for (const [u, v] of [
      [a, b],
      [b, a],
    ]) {
      const result = relation(geometry.measure(u!, v!));
      expect(result.angle?.value).toBe(0);
      expect(result.distance).toMatchObject({ method: 'parallel-gap', value: 3, extended: true });
    }
    expect(relation(geometry.measure(edge([0, 0, 3], [1, 0, 3 + 1e-8]), b)).distance).toBeUndefined();
    expect(relation(geometry.measure(edge([0, 0, -3], [0, 0, 3]), b)).angle?.value).toBe(90);
  });

  it('reports plane-plane gaps only for parallel normals, including opposite normals', () => {
    const a = plane([0, 0, 3], [0, 0, 1]);
    for (const normal of [
      [0, 0, 1],
      [0, 0, -1],
    ] as MeasurementVec3[]) {
      const b = plane([0, 0, 0], normal);
      for (const [u, v] of [
        [a, b],
        [b, a],
      ]) {
        const result = relation(geometry.measure(u!, v!));
        expect(result.distance?.value).toBe(3);
        expect(result.angle?.value).toBe(0);
      }
    }
    expect(relation(geometry.measure(a, plane([0, 0, 0], [1e-8, 0, 1]))).distance).toBeUndefined();
    expect(relation(geometry.measure(a, plane([0, 0, 0], [1, 0, 0]))).angle?.value).toBe(90);
  });

  it('uses transformed canonical geometry, not nominal primitive parameters', () => {
    const payload = cube();
    const matrix = new THREE.Matrix4()
      .makeRotationZ(Math.PI / 6)
      .scale(new THREE.Vector3(2, 3, 4))
      .setPosition(7, 8, 9);
    for (let i = 0; i < payload.vertices; i++) {
      const p = new THREE.Vector3().fromArray(payload.vertProperties, i * 3).applyMatrix4(matrix);
      p.toArray(payload.vertProperties, i * 3);
    }
    const transformed = new MeasurementGeometry(payload);
    expect(transformed.planes).toHaveLength(6);
    expect(transformed.edges).toHaveLength(12);
    const lengths = transformed.edges.map(e => transformed.measure(e)!.distance!.value).sort((a, b) => a - b);
    [4, 4, 4, 4, 6, 6, 6, 6, 8, 8, 8, 8].forEach((length, i) => expect(lengths[i]).toBeCloseTo(length, 5));
    for (const a of transformed.candidates) {
      for (const b of transformed.candidates) {
        if (a.key !== b.key) {
          const evidence = transformed.measure(a, b);
          expect(parseMeasurementEvidence(evidence)).toEqual(evidence);
        }
      }
    }
  });
});
