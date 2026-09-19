import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { createManifoldCadShareLink, createManifoldCadSource } from '../packages/modeling/src/manifoldcad-link.js';
import type { ManifoldCadLinkError } from '../packages/modeling/src/manifoldcad-link.js';

describe('ManifoldCAD source adapter', () => {
  it('wraps ambient sandbox source as an editable ManifoldCAD module', () => {
    const source = createManifoldCadSource('const cube = Manifold.cube(2);\nresult = cube;');

    expect(source).toContain("import { Manifold } from 'manifold-3d/manifoldCAD';");
    expect(source).not.toContain('CrossSection');
    expect(source).not.toContain('Mesh');
    expect(source).toContain('let result: Manifold;');
    expect(source).toContain('const cube = Manifold.cube(2);\nresult = cube;');
    expect(source.endsWith('export default result;\n')).toBe(true);
  });

  it('formats source and declares referenced ambient types locally', () => {
    const source = createManifoldCadSource(
      "// Keep this model note.\nconst rule:FillRule='EvenOdd';\nconst size:Vec3=[2,3,4];\n// Keep this result note.\nresult=Manifold.cube(size);",
    );

    expect(source).toContain('// Keep this model note.');
    expect(source).toContain('// Keep this result note.');
    expect(source).toContain("type FillRule = 'EvenOdd' | 'NonZero' | 'Positive' | 'Negative';");
    expect(source).toMatch(/type Vec3 = \[\s*number,\s*number,\s*number\s*\];/);
    expect(source).toContain("const rule: FillRule = 'EvenOdd';");
    expect(source).toContain('const size: Vec3 = [2, 3, 4];');
    expect(source).not.toMatch(/import\s*\{[^}]*FillRule/);
  });

  it('does not redeclare a top-level result binding', () => {
    const source = createManifoldCadSource('const result = Manifold.cube(2);');

    expect(source).not.toContain('let result: Manifold;');
    expect(source).toContain('const result = Manifold.cube(2);');
  });

  it('keeps global imports when the same names are shadowed only in nested scopes', () => {
    const source = createManifoldCadSource(`
function describe(Manifold: number, Vec3: string): string {
  return \`\${Manifold}:\${Vec3}\`;
}
const label = describe(2, 'cube');
const size: Vec3 = [2, 3, 4];
result = Manifold.cube(size);
`);

    expect(source).toContain("import { Manifold } from 'manifold-3d/manifoldCAD';");
    expect(source).toMatch(/type Vec3 = \[\s*number,\s*number,\s*number\s*\];/);
  });

  it('detects globals independently of TypeScript suppression directives', () => {
    const source = createManifoldCadSource(`
// @ts-nocheck
const profile: CrossSection = CrossSection.circle(2);
// @ts-ignore
const options: MeshOptions = { numProp: 3, vertProperties: new Float32Array(), triVerts: new Uint32Array() };
const mesh = new Mesh(options);
result = profile.extrude(3).add(Manifold.ofMesh(mesh));
`);

    expect(source).toContain("import { Manifold, CrossSection, Mesh } from 'manifold-3d/manifoldCAD';");
    expect(source).toContain('interface MeshOptions');
  });

  it('encodes the official name-code fragment and normalizes unsafe names', () => {
    const link = createManifoldCadShareLink({
      code: 'result = Manifold.cube(2);',
      name: '  Demo <code>\n model  ',
    });

    expect(link.name).toBe('Demo code model');
    expect(decodeURIComponent(new URL(link.url).hash.slice(1))).toBe(`${link.name}<code>${link.source}`);
  });

  it('uses a stable fallback name', () => {
    expect(createManifoldCadShareLink({ code: 'result = Manifold.cube(2);' }).name).toBe('Manifold MCP Model');
  });

  it('rejects links beyond the configured limit', () => {
    expect(() =>
      createManifoldCadShareLink({
        code: 'result = Manifold.cube(2);',
        maxUrlLength: 100,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ManifoldCadLinkError>>({
        name: 'ManifoldCadLinkError',
        code: 'URL_TOO_LONG',
      }),
    );
  });

  it('type-checks every transformed sample against the official ManifoldCAD declarations', async () => {
    const samplesDirectory = join(import.meta.dirname, '..', 'samples');
    const sampleNames = (await readdir(samplesDirectory)).filter(name => /^\d.*\.ts$/.test(name)).sort();
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'manifoldcad-samples-'));

    try {
      const generatedPaths = await Promise.all(
        sampleNames.map(async sampleName => {
          const sample = await readFile(join(samplesDirectory, sampleName), 'utf8');
          const generatedPath = join(temporaryDirectory, sampleName);
          await writeFile(generatedPath, createManifoldCadSource(sample));
          return generatedPath;
        }),
      );
      const program = ts.createProgram(generatedPaths, {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        ignoreDeprecations: '6.0',
        baseUrl: join(import.meta.dirname, '..'),
        paths: {
          'manifold-3d/manifoldCAD': ['node_modules/manifold-3d/types/manifoldCAD.d.ts'],
        },
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);

      expect(
        diagnostics.map(diagnostic => {
          const location =
            diagnostic.file && diagnostic.start !== undefined
              ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
              : undefined;
          return {
            file: diagnostic.file?.fileName,
            line: location ? location.line + 1 : undefined,
            col: location ? location.character + 1 : undefined,
            code: diagnostic.code,
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
          };
        }),
      ).toEqual([]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
