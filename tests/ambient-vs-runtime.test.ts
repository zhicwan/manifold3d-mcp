/**
 * Drift test for the sandbox ambient TypeScript declarations.
 *
 * The sandbox publishes a curated `.d.ts` (sourced from
 * `packages/modeling/src/sandbox/ambient-types.ts`) that promises a specific subset of
 * the manifold-3d API to user snippets. If the runtime drops or renames a
 * method we declared, snippets that typecheck cleanly will explode at
 * runtime — exactly the situation this test is designed to catch.
 *
 * Approach: parse the ambient declaration template literal at test time and
 * extract the method names declared on Manifold / CrossSection / Mesh, then
 * assert each one is actually a function on the live WASM instance (or its
 * prototype). We also smoke-test a few static factories to make sure they
 * really produce a valid Manifold.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import Module, { type CrossSection, type Manifold, type Mat3, type Mat4 } from 'manifold-3d';
import ts from 'typescript';

import { compileSnippetTypeScript } from '../packages/modeling/src/compiler/typescript-compiler.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const ambientSourcePath = resolve(repoRoot, 'packages/modeling/src/sandbox/ambient-types.ts');
const upstreamDeclarationPath = resolve(repoRoot, 'node_modules/manifold-3d/manifold.d.ts');

interface DeclaredApi {
  classes: Map<string, ClassMembers>;
}

interface ClassMembers {
  staticMethods: Set<string>;
  instanceMethods: Set<string>;
}

/**
 * Pull the ambient declarations out of the template literal in
 * `ambient-types.ts`. Mirrors the logic in `scripts/emit-sandbox-types.mjs`
 * so the two views stay in lock-step.
 */
function extractTemplateLiteral(source: string): string {
  const marker = 'sandboxAmbientDeclarations';
  const markerIdx = source.indexOf(marker);
  if (markerIdx < 0) {
    throw new Error(`Could not find export "${marker}" in ambient-types.ts`);
  }
  const openTick = source.indexOf('`', markerIdx);
  if (openTick < 0) {
    throw new Error(`Could not find opening backtick after "${marker}"`);
  }
  for (let i = openTick + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '`') {
      return source.slice(openTick + 1, i);
    }
  }
  throw new Error(`Could not find closing backtick after "${marker}"`);
}

/**
 * Parse the ambient declarations into a map of class name -> declared
 * static and instance method names. Constructors, fields, and overload
 * groups collapse to a single name.
 */
function parseDeclaredApi(declarations: string): DeclaredApi {
  const classes = new Map<string, ClassMembers>();
  const classRegex = /declare\s+class\s+(\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = classRegex.exec(declarations)) !== null) {
    const className = match[1];
    if (className === undefined) {
      continue;
    }
    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMatchingBrace(declarations, bodyStart - 1);
    const body = declarations.slice(bodyStart, bodyEnd);
    classes.set(className, parseClassBody(body));
  }
  return { classes };
}

function findMatchingBrace(source: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error('Unbalanced braces in ambient declarations');
}

function parseClassBody(body: string): ClassMembers {
  const staticMethods = new Set<string>();
  const instanceMethods = new Set<string>();
  // Match member declarations of the form
  //   [static] name(...): ReturnType;
  // with optional surrounding whitespace. Skip `constructor`.
  const memberRegex = /^[ \t]*(static\s+)?([A-Za-z_$][\w$]*)\s*\(/gm;
  let match: RegExpExecArray | null;
  while ((match = memberRegex.exec(body)) !== null) {
    const isStatic = Boolean(match[1]);
    const name = match[2];
    if (name === undefined || name === 'constructor') {
      continue;
    }
    if (isStatic) {
      staticMethods.add(name);
    } else {
      instanceMethods.add(name);
    }
  }
  return { staticMethods, instanceMethods };
}

interface InitializedWasm {
  Manifold: unknown;
  CrossSection: unknown;
  Mesh: unknown;
}

let wasmPromise: Promise<InitializedWasm> | undefined;
function initWasm(): Promise<InitializedWasm> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const wasm = (await Module()) as unknown as {
        setup: () => void;
        Manifold: unknown;
        CrossSection: unknown;
        Mesh: unknown;
      };
      wasm.setup();
      return { Manifold: wasm.Manifold, CrossSection: wasm.CrossSection, Mesh: wasm.Mesh };
    })();
  }
  return wasmPromise;
}

async function loadDeclaredApi(): Promise<DeclaredApi> {
  const source = await readFile(ambientSourcePath, 'utf8');
  return parseDeclaredApi(extractTemplateLiteral(source));
}

async function compileUpstreamCompatibilityCheck(): Promise<readonly ts.Diagnostic[]> {
  const source = await readFile(ambientSourcePath, 'utf8');
  const ambientPath = resolve(repoRoot, '.sandbox-api-compat.d.ts');
  const checkPath = resolve(repoRoot, '.sandbox-api-compat.ts');
  const sources = new Map([
    [ambientPath, extractTemplateLiteral(source)],
    [
      checkPath,
      `
import {
  CrossSection as UpstreamCrossSection,
  Manifold as UpstreamManifold,
  Mesh as UpstreamMesh,
  type Box as UpstreamBox,
  type ErrorStatus as UpstreamErrorStatus,
  type FillRule as UpstreamFillRule,
  type JoinType as UpstreamJoinType,
  type Mat3 as UpstreamMat3,
  type Mat4 as UpstreamMat4,
  type MeshOptions as UpstreamMeshOptions,
  type Polygons as UpstreamPolygons,
  type RayHit as UpstreamRayHit,
  type Rect as UpstreamRect,
  type SimplePolygon as UpstreamSimplePolygon,
  type Smoothness as UpstreamSmoothness,
  type Vec2 as UpstreamVec2,
  type Vec3 as UpstreamVec3,
} from 'manifold-3d';

type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type UnsupportedMembers<Published, Upstream> = {
  [K in keyof Published]: K extends keyof Upstream
    ? Upstream[K] extends Published[K]
      ? never
      : K
    : K;
}[keyof Published];
type AssertNever<T extends never> = T;

type _Vec2 = Assert<Same<Vec2, UpstreamVec2>>;
type _Vec3 = Assert<Same<Vec3, UpstreamVec3>>;
type _Mat3 = Assert<Same<Mat3, UpstreamMat3>>;
type _Mat4 = Assert<Same<Mat4, UpstreamMat4>>;
type _Rect = Assert<Same<Rect, UpstreamRect>>;
type _Box = Assert<Same<Box, UpstreamBox>>;
type _ErrorStatus = Assert<Same<ErrorStatus, UpstreamErrorStatus>>;
type _SimplePolygon = Assert<Same<SimplePolygon, UpstreamSimplePolygon>>;
type _Polygons = Assert<Same<Polygons, UpstreamPolygons>>;
type _FillRule = Assert<Same<FillRule, UpstreamFillRule>>;
type _JoinType = Assert<Same<JoinType, UpstreamJoinType>>;
type _Smoothness = Assert<Same<Smoothness, UpstreamSmoothness>>;
type _RayHit = Assert<Same<RayHit, UpstreamRayHit>>;
type _MeshOptions = Assert<Same<MeshOptions, UpstreamMeshOptions>>;

type _ManifoldStatics = AssertNever<UnsupportedMembers<typeof Manifold, typeof UpstreamManifold>>;
type _ManifoldInstances = AssertNever<UnsupportedMembers<Manifold, UpstreamManifold>>;
type _CrossSectionStatics = AssertNever<UnsupportedMembers<typeof CrossSection, typeof UpstreamCrossSection>>;
type _CrossSectionInstances = AssertNever<UnsupportedMembers<CrossSection, UpstreamCrossSection>>;
type _MeshStatics = AssertNever<UnsupportedMembers<typeof Mesh, typeof UpstreamMesh>>;
type _MeshInstances = AssertNever<UnsupportedMembers<Mesh, UpstreamMesh>>;

const _manifoldConstructor: typeof Manifold = UpstreamManifold;
const _crossSectionConstructor: typeof CrossSection = UpstreamCrossSection;
const _meshConstructor: typeof Mesh = UpstreamMesh;
`,
    ],
  ]);
  const options: ts.CompilerOptions = {
    lib: ['lib.es2022.d.ts'],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = fileName => sources.has(fileName) || originalFileExists(fileName);
  host.readFile = fileName => sources.get(fileName) ?? originalReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const virtualSource = sources.get(fileName);
    return virtualSource === undefined
      ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(fileName, virtualSource, languageVersion, true);
  };
  return ts.getPreEmitDiagnostics(ts.createProgram([...sources.keys()], options, host));
}

function isFunction(value: unknown): boolean {
  return typeof value === 'function';
}

function lookup(target: unknown, name: string): unknown {
  if (target === null || target === undefined) {
    return undefined;
  }
  return (target as Record<string, unknown>)[name];
}

describe('sandbox ambient declarations vs. live manifold-3d runtime', () => {
  it('every published signature is fulfilled by installed upstream declarations', async () => {
    const diagnostics = await compileUpstreamCompatibilityCheck();
    expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  });

  it('exposes every compatible upstream class method except owned lifecycle and ID registration', async () => {
    const [ambient, upstreamSource] = await Promise.all([loadDeclaredApi(), readFile(upstreamDeclarationPath, 'utf8')]);
    const upstream = parseDeclaredApi(upstreamSource);
    const intentionalOmissions: Record<string, Set<string>> = {
      CrossSection: new Set(['delete']),
      Manifold: new Set(['delete', 'reserveIDs', 'withContext']),
      Mesh: new Set(),
    };
    const missing: string[] = [];
    for (const [className, upstreamMembers] of upstream.classes) {
      const published = ambient.classes.get(className);
      if (!published || !(className in intentionalOmissions)) {
        continue;
      }
      const omitted = intentionalOmissions[className] ?? new Set<string>();
      for (const name of upstreamMembers.staticMethods) {
        if (!omitted.has(name) && !published.staticMethods.has(name)) {
          missing.push(`${className}.${name} (static)`);
        }
      }
      for (const name of upstreamMembers.instanceMethods) {
        if (!omitted.has(name) && !published.instanceMethods.has(name)) {
          missing.push(`${className}.${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.concurrent('every declared static method exists on the live class', async () => {
    const [api, wasm] = await Promise.all([loadDeclaredApi(), initWasm()]);
    const targets: Record<string, unknown> = {
      Manifold: wasm.Manifold,
      CrossSection: wasm.CrossSection,
      Mesh: wasm.Mesh,
    };
    const missing: string[] = [];
    for (const [className, members] of api.classes) {
      const target = targets[className];
      expect(target, `runtime is missing class ${className}`).toBeDefined();
      for (const name of members.staticMethods) {
        if (!isFunction(lookup(target, name))) {
          missing.push(`${className}.${name} (static)`);
        }
      }
    }
    expect(
      missing,
      `static methods declared in ambient-types.ts but missing at runtime: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it.concurrent('every declared instance method exists on the live prototype', async () => {
    const [api, wasm] = await Promise.all([loadDeclaredApi(), initWasm()]);
    const targets: Record<string, unknown> = {
      Manifold: wasm.Manifold,
      CrossSection: wasm.CrossSection,
      Mesh: wasm.Mesh,
    };
    const missing: string[] = [];
    for (const [className, members] of api.classes) {
      const ctor = targets[className] as { prototype?: unknown } | undefined;
      const proto = ctor?.prototype;
      expect(proto, `runtime is missing prototype for ${className}`).toBeDefined();
      for (const name of members.instanceMethods) {
        // Mesh is the JS-side wrapper class; instance members may live on the
        // prototype OR be regular methods set in the constructor (e.g.
        // `merge`). Walk the prototype chain to be safe.
        let found = false;
        let cursor: unknown = proto;
        while (cursor !== null && cursor !== undefined) {
          const value = lookup(cursor, name);
          if (isFunction(value)) {
            found = true;
            break;
          }
          cursor = Object.getPrototypeOf(cursor as object);
        }
        if (!found) {
          missing.push(`${className}.prototype.${name}`);
        }
      }
    }
    expect(
      missing,
      `instance methods declared in ambient-types.ts but missing at runtime: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it.concurrent('Manifold.cube produces a valid manifold', async () => {
    const wasm = await initWasm();
    const Mfd = wasm.Manifold as {
      cube(
        size: [number, number, number],
        center?: boolean,
      ): {
        numTri(): number;
        volume(): number;
        delete(): void;
      };
    };
    const cube = Mfd.cube([2, 3, 4], true);
    try {
      expect(cube.numTri()).toBe(12);
      expect(cube.volume()).toBeCloseTo(24, 5);
    } finally {
      cube.delete();
    }
  });

  it.concurrent('Manifold.sphere produces a non-empty manifold', async () => {
    const wasm = await initWasm();
    const Mfd = wasm.Manifold as {
      sphere(radius: number, segments?: number): { numTri(): number; isEmpty(): boolean; delete(): void };
    };
    const sphere = Mfd.sphere(5, 32);
    try {
      expect(sphere.isEmpty()).toBe(false);
      expect(sphere.numTri()).toBeGreaterThan(0);
    } finally {
      sphere.delete();
    }
  });

  it.concurrent('Manifold.cylinder produces a valid manifold', async () => {
    const wasm = await initWasm();
    const Mfd = wasm.Manifold as {
      cylinder(
        height: number,
        rLow: number,
        rHigh?: number,
        segments?: number,
        center?: boolean,
      ): { numTri(): number; volume(): number; delete(): void };
    };
    const cyl = Mfd.cylinder(10, 2, 2, 16, false);
    try {
      expect(cyl.numTri()).toBeGreaterThan(0);
      expect(cyl.volume()).toBeGreaterThan(0);
    } finally {
      cyl.delete();
    }
  });

  it('supports audited geometry and measurement APIs', async () => {
    const wasm = await initWasm();
    const Mfd = wasm.Manifold as typeof Manifold;
    const Section = wasm.CrossSection as typeof CrossSection;
    const section = Section.square([6, 4], true);
    const left = Mfd.cube([2, 2, 2], true).translate([-2.5, 0, 0]);
    const right = Mfd.cube([2, 2, 2], true).translate([2.5, 0, 0]);
    const combined = Mfd.union([left, right]);
    const warped = Mfd.cube([2, 2, 2], true).warpBatch((verts, count) => {
      for (let i = 0; i < count; i++) {
        verts[3 * i] = (verts[3 * i] ?? 0) + 3;
      }
    });
    const minkowskiLeft = Mfd.cube([2, 2, 2], true);
    const minkowskiRight = Mfd.cube([1, 1, 1], true);
    const minkowski = minkowskiLeft.minkowskiSum(minkowskiRight);
    const simplified = combined.simplify();
    try {
      expect(section.area()).toBeCloseTo(24, 5);
      expect(section.bounds()).toEqual({ min: [-3, -2], max: [3, 2] });
      expect(section.numContour()).toBe(1);
      expect(section.numVert()).toBe(4);
      expect(section.toPolygons()).toHaveLength(1);
      expect(combined.numEdge()).toBeGreaterThan(0);
      expect(combined.numProp()).toBe(0);
      expect(combined.numPropVert()).toBe(combined.numVert());
      expect(left.minGap(right, 10)).toBeCloseTo(3, 5);
      expect(left.rayCast([-5, 0, 0], [5, 0, 0])).toHaveLength(2);
      expect(warped.boundingBox()).toEqual({ min: [2, -1, -1], max: [4, 1, 1] });
      expect(minkowski.boundingBox()).toEqual({ min: [-1.5, -1.5, -1.5], max: [1.5, 1.5, 1.5] });
      expect(simplified.numTri()).toBeLessThanOrEqual(combined.numTri());
    } finally {
      simplified.delete();
      minkowski.delete();
      minkowskiRight.delete();
      minkowskiLeft.delete();
      warped.delete();
      combined.delete();
      right.delete();
      left.delete();
      section.delete();
    }
  });

  it('preserves original IDs and run transforms through array booleans', async () => {
    const wasm = await initWasm();
    const Mfd = wasm.Manifold as typeof Manifold;
    const first = Mfd.cube([2, 2, 2], true).asOriginal();
    const second = Mfd.sphere(1, 16).asOriginal();
    const firstPlaced = first.translate([4, 0, 0]);
    const secondPlaced = second.translate([-4, 0, 0]);
    const combined = Mfd.union([firstPlaced, secondPlaced]);
    try {
      const mesh = combined.getMesh();
      expect(new Set(mesh.runOriginalID)).toEqual(new Set([first.originalID(), second.originalID()]));
      expect(mesh.runTransform).toHaveLength(mesh.runOriginalID.length * 12);
      const translations = Array.from({ length: mesh.numRun }, (_, run) => mesh.transform(run)[12]).sort(
        (a, b) => a - b,
      );
      expect(translations).toEqual([-4, 4]);
    } finally {
      combined.delete();
      secondPlaced.delete();
      firstPlaced.delete();
      second.delete();
      first.delete();
    }
  });

  describe.each([
    { name: 'identity', x: 0, y: 0, z: 0 },
    { name: 'column-major translation', x: 5, y: -7, z: 11 },
  ])('$name matrices', ({ x, y, z }) => {
    it('typechecks Mat3 and preserves the expected 2D geometry at runtime', async () => {
      const matrix: Mat3 = [1, 0, 0, 0, 1, 0, x, y, 1];
      const compiled = compileSnippetTypeScript(`
const matrix: Mat3 = [${matrix.join(', ')}];
result = CrossSection.square([2, 3], true).transform(matrix).extrude(4);
`);
      expect(compiled.issues).toEqual([]);
      expect(compiled.ok).toBe(true);

      const wasm = await initWasm();
      const original = (wasm.CrossSection as typeof CrossSection).square([2, 3], true);
      const transformed = original.transform(matrix);
      try {
        expect(transformed.area()).toBeCloseTo(6, 5);
        expect(transformed.bounds()).toEqual({
          min: [-1 + x, -1.5 + y],
          max: [1 + x, 1.5 + y],
        });
        expect(transformed.toPolygons()).toEqual(
          original.toPolygons().map(polygon => polygon.map(([px, py]) => [px + x, py + y])),
        );
      } finally {
        transformed.delete();
        original.delete();
      }
    });

    it('typechecks Mat4 and preserves the expected 3D geometry at runtime', async () => {
      const matrix: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
      const compiled = compileSnippetTypeScript(`
const matrix: Mat4 = [${matrix.join(', ')}];
result = Manifold.cube([2, 3, 4], true).transform(matrix);
`);
      expect(compiled.issues).toEqual([]);
      expect(compiled.ok).toBe(true);

      const wasm = await initWasm();
      const original = (wasm.Manifold as typeof Manifold).cube([2, 3, 4], true);
      const transformed = original.transform(matrix);
      try {
        expect(transformed.volume()).toBeCloseTo(24, 5);
        expect(transformed.boundingBox()).toEqual({
          min: [-1 + x, -1.5 + y, -2 + z],
          max: [1 + x, 1.5 + y, 2 + z],
        });
        const originalMesh = original.getMesh();
        const transformedMesh = transformed.getMesh();
        expect(transformedMesh.triVerts).toEqual(originalMesh.triVerts);
        expect(Array.from(transformedMesh.vertProperties)).toEqual(
          Array.from(originalMesh.vertProperties, (value, index) => {
            const offset = index % 3 === 0 ? x : index % 3 === 1 ? y : z;
            return value + offset;
          }),
        );
      } finally {
        transformed.delete();
        original.delete();
      }
    });
  });
});
