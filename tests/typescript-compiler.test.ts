import { describe, expect, it } from 'vitest';

import { compileSnippetTypeScript } from '../packages/modeling/src/compiler/typescript-compiler.js';

describe('compileSnippetTypeScript', () => {
  it('emits JavaScript for valid TypeScript snippets with helpers', () => {
    const result = compileSnippetTypeScript(`
function makePost(width: number, depth: number, height: number): Manifold {
  const size: [number, number, number] = [width, depth, height];
  return Manifold.cube(size, true);
}
const offsets: Array<[number, number, number]> = [[-4, 0, 0], [4, 0, 0]];
const posts = offsets.map(offset => makePost(3, 3, 10).translate(offset));
result = Manifold.union(posts);
`);

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.js).toContain('function makePost(width, depth, height)');
    expect(result.js).toContain('Manifold.union(posts)');
    expect(result.js).not.toContain(': number');
    expect(result.js).not.toContain(': Manifold');
  });

  it('reports user-source diagnostics with TypeScript codes and locations', () => {
    const result = compileSnippetTypeScript("result = Manifold.cube('bad');");

    expect(result.ok).toBe(false);
    expect(result.js).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'typecheck',
          code: 'TS_DIAGNOSTIC',
          tsCode: 2345,
          line: 1,
          col: 24,
          snippet: "result = Manifold.cube('bad');",
        }),
      ]),
    );
  });

  it('exposes audited upstream geometry, measurement, provenance, and mesh readers', () => {
    const result = compileSnippetTypeScript(`
const section = CrossSection.square([4, 6], true);
const polygonCount: number = section.toPolygons().length;
const sectionStats: number[] = [
  section.area(),
  section.bounds().max[0],
  section.numContour(),
  section.numVert(),
  section.isEmpty() ? 0 : 1,
  polygonCount,
];
const first = Manifold.cube([2, 2, 2], true).asOriginal();
const second = Manifold.sphere(1, 16).asOriginal();
const combined = Manifold.union([first, second.translate([4, 0, 0])]);
const mesh = combined.getMesh();
const rebuilt = new Mesh({
  numProp: mesh.numProp,
  vertProperties: mesh.vertProperties,
  triVerts: mesh.triVerts,
  runIndex: mesh.runIndex,
  runOriginalID: mesh.runOriginalID,
  runTransform: mesh.runTransform,
});
const firstPosition = mesh.position(0);
const firstTriangle = mesh.verts(0);
const runTransform = mesh.transform(0);
const measurements: number[] = [
  combined.numEdge(),
  combined.numProp(),
  combined.numPropVert(),
  combined.minGap(second.translate([8, 0, 0]), 20),
  combined.rayCast([-10, 0, 0], [10, 0, 0]).length,
  mesh.numTri,
  mesh.numVert,
  mesh.numRun,
  firstPosition[0] ?? 0,
  firstTriangle[0] ?? 0,
  runTransform[0] ?? 0,
  mesh.backside(0) ? 1 : 0,
  mesh.hasNormals(0) ? 1 : 0,
  sectionStats[0] ?? 0,
];
result = Manifold.ofMesh(rebuilt)
  .warpBatch((verts, count) => {
    if (count > 0) verts[0] = verts[0] ?? 0;
  })
  .calculateNormals()
  .calculateCurvature(3, 4)
  .simplify()
  .hull()
  .minkowskiSum(Manifold.cube(0.1, true))
  .minkowskiDifference(Manifold.cube(0.05, true));
`);

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('does not expose Node globals to snippets', () => {
    const result = compileSnippetTypeScript(`
process.exit(1);
result = Manifold.cube();
`);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'typecheck',
          code: 'TS_DIAGNOSTIC',
          tsCode: 2591,
          line: 2,
          col: 1,
          snippet: 'process.exit(1);',
        }),
      ]),
    );
  });

  it.each([
    {
      name: 'unknown Manifold.box API',
      code: 'result = Manifold.box([10, 10, 10]);',
      tsCode: 2339,
    },
    {
      name: 'singular CrossSection.ofPolygon API',
      code: 'result = CrossSection.ofPolygon([[0, 0], [1, 0], [0, 1]]).extrude(2);',
      tsCode: 2551,
    },
    {
      name: 'options-object Manifold.cylinder call',
      code: 'result = Manifold.cylinder({ height: 5 });',
      tsCode: 2554,
    },
    {
      name: 'CrossSection assigned to result',
      code: 'result = CrossSection.square([2, 2]);',
      tsCode: 2740,
      message: /result must be a manifold/i,
    },
    {
      name: 'number assigned to result',
      code: 'result = 42;',
      tsCode: 2322,
    },
    {
      name: 'malformed tuple vector',
      code: 'const size: [number, number, number] = [1, 2]; result = Manifold.cube(size);',
      tsCode: 2322,
    },
    {
      name: 'six-element CrossSection transform matrix',
      code: 'result = CrossSection.square([2, 3]).transform([1, 0, 0, 1, 0, 0]).extrude(4);',
      tsCode: 2345,
    },
    {
      name: 'twelve-element Manifold transform matrix',
      code: 'result = Manifold.cube([2, 3, 4]).transform([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);',
      tsCode: 2345,
    },
    {
      name: 'possibly undefined result assignment',
      code: 'const parts: Manifold[] = []; result = parts[0];',
      tsCode: 2322,
      message: /cannot be undefined/,
    },
    {
      name: 'variadic Manifold union',
      code: 'result = Manifold.union(Manifold.cube(), Manifold.cube(), Manifold.cube());',
      tsCode: 2554,
    },
    {
      name: 'spread Manifold union',
      code: 'const parts = [Manifold.cube(), Manifold.cube()]; result = Manifold.union(...parts);',
      tsCode: 2556,
    },
  ])('blocks $name', ({ code, tsCode, message }) => {
    const result = compileSnippetTypeScript(code);

    expect(result.ok).toBe(false);
    expect(result.js).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: 'typecheck',
          code: 'TS_DIAGNOSTIC',
          tsCode,
        }),
      ]),
    );
    if (message) {
      expect(result.issues.map(issue => issue.message).join('\n')).toMatch(message);
    }
  });
});
