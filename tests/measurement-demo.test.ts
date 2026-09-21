import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildDemoPayload } from '../packages/viewer/src/demo-payload.js';
import { MeasurementGeometry } from '../packages/viewer/src/measurements/geometry.js';

describe('boolean-unioned measurement fixture', () => {
  it('matches the deterministic public modeling build without rewriting the fixture', async () => {
    await promisify(execFile)(process.execPath, ['scripts/emit-demo-payload.mjs', '--check'], {
      cwd: new URL('..', import.meta.url),
    });
  });

  it('returns independent data-only models with the original union statistics and feature labels', () => {
    const payload = buildDemoPayload();
    expect(payload).not.toBeInstanceOf(Promise);
    expect(payload.triangles).toBe(350);
    expect(payload.vertices).toBe(177);
    expect(payload.volume).toBeCloseTo(64736.21126346706);
    expect(payload.surfaceArea).toBeCloseTo(18575.727788154818);
    expect(payload.genus).toBe(0);
    expect(payload.features.map(feature => feature.label)).toEqual(['plate#1', 'wall#1', 'boss#1', 'pin#1']);
    const other = buildDemoPayload();
    expect(other).toEqual(payload);
    expect(other.vertProperties).not.toBe(payload.vertProperties);
    expect(other.triVerts).not.toBe(payload.triVerts);
    expect(other.triFeatureIds).not.toBe(payload.triFeatureIds);
    expect(other.features[0]).not.toBe(payload.features[0]);
  });

  it('offers boss and pin top centers but no centers for their cylindrical side facets', () => {
    const geometry = new MeasurementGeometry(buildDemoPayload());
    for (const z of [24, 32]) {
      expect(geometry.centers.some(center => Math.abs(center.anchor[2] - z) < 1e-5)).toBe(true);
    }
    const sideFacets = geometry.planes.filter(plane => {
      if (plane.operand.kind !== 'plane' || Math.abs(plane.operand.normal[2]) > 1e-6) {
        return false;
      }
      const [x, y, z] = plane.anchor;
      return z > 8 && z < 32 && (Math.hypot(x + 18, y + 8) < 12.01 || Math.hypot(x - 22, y + 10) < 4.01);
    });
    expect(sideFacets.length).toBeGreaterThan(20);
    for (const side of sideFacets) {
      if (side.operand.kind !== 'plane') {
        throw new Error('Expected a planar mesh facet.');
      }
      expect(geometry.centerForPatch(side.operand.patchId)).toBeNull();
    }
  });

  it('places the base-to-boss height at the boss, not a remote base corner', () => {
    const geometry = new MeasurementGeometry(buildDemoPayload());
    const planeAt = (z: number) =>
      geometry.planes.find(
        candidate =>
          candidate.operand.kind === 'plane' &&
          Math.abs(candidate.operand.normal[2] - 1) < 1e-8 &&
          Math.abs(candidate.operand.origin[2] - z) < 1e-8,
      )!;
    const base = planeAt(8);
    const boss = planeAt(24);
    const evidence = geometry.measure(base, boss)!;
    expect(evidence.distance?.value).toBeCloseTo(16);
    const witness = evidence.distance!.start;
    expect(Math.hypot(witness[0] + 18, witness[1] + 8)).toBeCloseTo(12, 4);
    expect(evidence.distance?.extended).not.toBe(true);
    expect(geometry.measure(boss, base)?.distance?.value).toBeCloseTo(16);
  });

  it('measures the exposed wall edge to the union intersection, not its buried primitive endpoint', () => {
    const payload = buildDemoPayload();
    const geometry = new MeasurementGeometry(payload);
    const edges = geometry.edges.filter(candidate => {
      const edge = candidate.operand;
      return (
        edge.kind === 'edge' &&
        [edge.start, edge.end].every(point => Math.abs(point[0] - 40) < 1e-6 && Math.abs(point[1] - 17) < 1e-6)
      );
    });
    expect(edges).toHaveLength(1);
    const edge = edges[0]!;
    expect(geometry.measure(edge)?.distance?.value).toBeCloseTo(38);
    expect(edge.operand).toMatchObject({ kind: 'edge' });
    if (edge.operand.kind === 'edge') {
      expect([edge.operand.start[2], edge.operand.end[2]].sort((a, b) => a - b)).toEqual([8, 46]);
    }
    expect(geometry.diagnostics).toEqual([]);
    expect(payload.bboxMin).toEqual([-40, -25, 0]);
    expect(payload.bboxMax).toEqual([40, 25, 46]);
    expect(payload.triFeatureIds).toHaveLength(payload.triangles);
    expect(new Set(payload.triFeatureIds).size).toBe(4);
  });
});
