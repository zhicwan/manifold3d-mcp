import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';
import { MeasurementGeometry } from '../packages/viewer/src/measurements/geometry.js';
import { pickMeasurement, pickMeasurementCandidates } from '../packages/viewer/src/measurements/picker.js';
import { payloadToGeometry } from '../packages/viewer/src/scene/mesh-bridge.js';
import { prepareMeshPicking } from '../packages/viewer/src/scene/mesh-picking.js';

function fixture(points: number[], indices: number[]): { geometry: MeasurementGeometry; mesh: THREE.Mesh } {
  const payload: ViewerModel = {
    numProp: 3,
    vertices: points.length / 3,
    triangles: indices.length / 3,
    vertProperties: new Float32Array(points),
    triVerts: new Uint32Array(indices),
    mergeFromVert: new Uint32Array(),
    mergeToVert: new Uint32Array(),
    triFeatureIds: new Uint32Array(),
    features: [],
    volume: 0,
    surfaceArea: 0,
    genus: 0,
    bboxMin: [-1, -1, 0],
    bboxMax: [1, 1, 1],
  };
  const mesh = new THREE.Mesh(payloadToGeometry(payload), new THREE.MeshBasicMaterial());
  prepareMeshPicking(mesh);
  return { geometry: new MeasurementGeometry(payload), mesh };
}

const square = (): ReturnType<typeof fixture> => fixture([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], [0, 1, 2, 0, 2, 3]);
function orthographic(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  return camera;
}
const viewport = { width: 400, height: 400 };

describe('measurement candidate picking', () => {
  it('prioritizes visible vertices then edges then plane without triangle diagonals', () => {
    const input = { ...square(), camera: orthographic(), ...viewport };
    const corner = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.49, 0.49) });
    expect(corner.map(c => c.operand.kind)).toEqual(['point', 'edge', 'edge', 'plane', 'point']);
    expect(corner[0]!.operand).toMatchObject({ vertexId: 2 });
    expect(corner.at(-1)?.key).toMatch(/^surface:/);
    const middle = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0, 0) });
    expect(middle.map(c => c.operand.kind)).toEqual(['point', 'plane', 'point']);
    expect(middle[0]!.operand).toMatchObject({ faceCenter: { patchId: 0, onSurface: true } });
  });

  it('shows the hovered face center before the pointer reaches snapping range', () => {
    const input = { ...square(), camera: orthographic(), ...viewport };
    const picked = pickMeasurement({ ...input, ndc: new THREE.Vector2(0.25, 0.1) });
    expect(picked.candidates[0]?.operand.kind).toBe('plane');
    expect(picked.faceCenter?.anchor).toEqual([0, 0, 0]);
    expect(pickMeasurement({ ...input, ndc: new THREE.Vector2(0.02, 0) }).candidates[0]?.key).toMatch(/^face-center:/);
  });

  it('does not snap to a rear face center through an occluding front face', () => {
    const input = {
      ...fixture(
        [-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
        [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
      ),
      camera: orthographic(),
      ...viewport,
    };
    const picked = pickMeasurement({ ...input, ndc: new THREE.Vector2() });
    expect(picked.candidates[0]?.operand).toMatchObject({ faceCenter: { patchId: 0 } });
    expect(
      picked.candidates.filter(candidate => candidate.operand.kind === 'point' && candidate.operand.faceCenter),
    ).toHaveLength(1);
    expect(picked.faceCenter?.anchor).toEqual([0, 0, 1]);
  });

  it('does not offer a hole reference and picks the actual deeper surface instead', () => {
    const input = {
      ...fixture(
        [
          -2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, -2, -2, -1, 2, -2, -1, 2, 2,
          -1, -2, 2, -1,
        ],
        [0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7, 8, 9, 10, 8, 10, 11],
      ),
      camera: orthographic(),
      ...viewport,
    };
    expect(pickMeasurement({ ...input, ndc: new THREE.Vector2(0.75, 0) }).faceCenter).toBeNull();
    const center = pickMeasurement({ ...input, ndc: new THREE.Vector2() });
    expect(center.candidates[0]?.operand).toMatchObject({ faceCenter: { onSurface: true } });
    expect(center.candidates[0]?.anchor[2]).toBe(-1);
    expect(center.candidates.some(candidate => candidate.key === 'face-center:0')).toBe(false);
  });

  it('finds silhouette edges even when the pointer ray misses the surface', () => {
    const input = { ...square(), camera: orthographic(), ...viewport };
    const candidates = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.53, 0) });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.operand.kind).toBe('edge');
    expect(candidates[0]!.triIds).toEqual([0, 1]);
  });

  it('has CSS-pixel release hysteresis without keeping a hidden or remote candidate', () => {
    const input = { ...square(), camera: orthographic(), ...viewport };
    const selected = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.53, 0) })[0]!;
    expect(pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.565, 0) })).toEqual([]);
    expect(
      pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.565, 0), previousKey: selected.key })[0]?.key,
    ).toBe(selected.key);
    expect(pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.58, 0), previousKey: selected.key })).toEqual(
      [],
    );
    expect(pickMeasurementCandidates({ ...input, width: 800, height: 800, ndc: new THREE.Vector2(0.53, 0) })).toEqual(
      [],
    );
  });

  it('rejects background vertices and edges at the same projected position', () => {
    const input = {
      ...fixture(
        [-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
        [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
      ),
      camera: orthographic(),
      ...viewport,
    };
    const candidates = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.49, 0.49) });
    expect(candidates.map(c => c.operand.kind)).toEqual(['point', 'edge', 'edge', 'plane', 'point']);
    expect(candidates.every(c => c.anchor[2] === 1)).toBe(true);
  });

  it('returns deliberate canonical surface points with distinct keys on one triangle', () => {
    const input = { ...square(), camera: orthographic(), ...viewport, surfacePoint: true };
    input.mesh.position.set(0.25, 0, 1);
    input.mesh.scale.set(0.5, 0.75, 2);
    const a = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.125, -0.1) }).find(c =>
      c.key.startsWith('surface:'),
    )!;
    const b = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.15, -0.1) }).find(c =>
      c.key.startsWith('surface:'),
    )!;
    expect(a.operand).toMatchObject({ kind: 'point', triangleId: 0 });
    expect(a.anchor[0]).toBeCloseTo(0);
    expect(a.anchor[1]).toBeCloseTo(-0.2 / 0.75);
    expect(a.anchor[2]).toBeCloseTo(0);
    expect(a.key).not.toBe(b.key);
    expect(b.operand).toMatchObject({ triangleId: 0 });
    expect(input.geometry.measure(a, b)?.distance?.value).toBeCloseTo(0.1);
  });

  it('does not narrow snapping to just the hit triangle', () => {
    const input = {
      ...fixture([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 0, 0.04, 0], [0, 1, 2, 0, 2, 4, 0, 4, 3, 4, 2, 3]),
      camera: orthographic(),
      ...viewport,
    };
    const candidates = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.01, -0.01) });
    expect(candidates.some(candidate => candidate.operand.kind === 'point' && candidate.operand.vertexId === 4)).toBe(
      true,
    );
    expect(candidates.some(c => c.operand.kind === 'plane')).toBe(true);
    const atVertex = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0, 0.02) });
    expect(atVertex[0]?.operand).toMatchObject({ kind: 'point', vertexId: 4 });
  });

  it('uses indirect BVH IDs as-is and narrows a large tessellation spatially', () => {
    const divisions = 80;
    const points: number[] = [];
    const indices: number[] = [];
    for (let y = 0; y <= divisions; y++) {
      for (let x = 0; x <= divisions; x++) {
        points.push((x / divisions) * 2 - 1, (y / divisions) * 2 - 1, 0);
      }
    }
    for (let y = 0; y < divisions; y++) {
      for (let x = 0; x < divisions; x++) {
        const a = y * (divisions + 1) + x;
        indices.push(a, a + 1, a + divisions + 2, a, a + divisions + 2, a + divisions + 1);
      }
    }
    // Shuffle canonical triangle order so accidental double indirect resolution is observable.
    const triangles = Array.from({ length: indices.length / 3 }, (_, i) => indices.slice(i * 3, i * 3 + 3));
    triangles.sort((a, b) => ((a[0]! * 71) % 97) - ((b[0]! * 71) % 97));
    const input = { ...fixture(points, triangles.flat()), camera: orthographic(), ...viewport };
    const before = input.mesh.geometry.index!.array.slice();
    const lookup = vi.spyOn(input.geometry, 'candidatesForTriangle');
    const candidates = pickMeasurementCandidates({ ...input, ndc: new THREE.Vector2(0.375, 0.375) });
    expect(candidates[0]!.operand).toMatchObject({ kind: 'point', vertexId: 70 * 81 + 70 });
    expect(lookup.mock.calls.length).toBeLessThan(triangles.length / 10);
    expect(input.mesh.geometry.index!.array).toEqual(before);
  });

  it('uses perspective-correct edge positions for visibility and clips behind-camera geometry', () => {
    const input = fixture([-1, 0, 1, 1, 0, -3, 0, 1, -1], [0, 1, 2]);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.z = 5;
    camera.updateMatrixWorld();
    const start = new THREE.Vector3(-1, 0, 1).project(camera);
    const end = new THREE.Vector3(1, 0, -3).project(camera);
    const candidates = pickMeasurementCandidates({
      ...input,
      camera,
      ...viewport,
      ndc: new THREE.Vector2((start.x + end.x) / 2, 0),
    });
    expect(candidates[0]!.operand.kind).toBe('edge');
    input.mesh.position.z = 20;
    expect(pickMeasurementCandidates({ ...input, camera, ...viewport, ndc: new THREE.Vector2() })).toEqual([]);
  });

  it.each([
    ['perspective', false],
    ['orthographic', false],
    ['perspective', true],
    ['orthographic', true],
  ] as const)('ignores depth-clipped surfaces with a %s camera and transformed model=%s', (kind, transformed) => {
    const input = fixture(
      [-1, -1, 9.5, 1, -1, 9.5, 1, 1, 9.5, -1, 1, 9.5, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
      [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    );
    const camera =
      kind === 'perspective'
        ? new THREE.PerspectiveCamera(45, 1, 1, 20)
        : new THREE.OrthographicCamera(-2, 2, 2, -2, 1, 20);
    camera.position.z = 10;
    camera.updateMatrixWorld();
    if (transformed) {
      input.mesh.scale.set(2, 0.5, 0.5);
      input.mesh.position.z = 5;
    }
    const picked = pickMeasurement({ ...input, camera, ...viewport, ndc: new THREE.Vector2() });
    expect(picked.faceCenter?.anchor).toEqual([0, 0, 0]);
    expect(picked.candidates[0]?.anchor).toEqual([0, 0, 0]);
    expect(picked.candidates.every(candidate => candidate.anchor[2] === 0)).toBe(true);
    input.mesh.position.z = -30;
    expect(pickMeasurement({ ...input, camera, ...viewport, ndc: new THREE.Vector2() })).toEqual({
      candidates: [],
      faceCenter: null,
    });
    input.mesh.geometry.dispose();
    (input.mesh.material as THREE.Material).dispose();
  });
});
