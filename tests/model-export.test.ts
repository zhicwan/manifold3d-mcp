import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Logger, Verbosity, WebIO } from '@gltf-transform/core';
import { strFromU8, unzipSync } from 'fflate';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import type { ViewerModel } from '../packages/protocol/src/wire/model.js';
import { modelExportFilename } from '../packages/viewer/src/exporters/filename.js';
import { serializeModel } from '../packages/viewer/src/exporters/model.js';
import { fromArrayBuffer } from 'manifold-3d/lib/import-model.js';

const wasmBinary = new Uint8Array(await readFile(fileURLToPath(import.meta.resolve('manifold-3d/manifold.wasm'))));

function model(): ViewerModel {
  return {
    description: 'Original Model',
    numProp: 5,
    triangles: 4,
    vertices: 5,
    vertProperties: new Float32Array([0, 0, 0, 9, 8, 10, 0, 0, 9, 8, 0, 20, 0, 9, 8, 0, 0, 30, 9, 8, 0, 0, 0, 7, 6]),
    triVerts: new Uint32Array([0, 2, 1, 4, 1, 3, 0, 3, 2, 1, 2, 3]),
    mergeFromVert: new Uint32Array([4]),
    mergeToVert: new Uint32Array([0]),
    features: [],
    triFeatureIds: new Uint32Array(4),
    volume: 1000,
    surfaceArea: 600,
    genus: 0,
    bboxMin: [0, 0, 0],
    bboxMax: [10, 20, 30],
  };
}

describe('model export filenames', () => {
  it.each([
    ['3mf', undefined, 'original-model.3mf'],
    ['glb', 12, 'original-model-r12.glb'],
  ] as const)('creates deterministic %s names', (format, revision, expected) => {
    expect(modelExportFilename(model(), format, revision)).toBe(expected);
  });

  it('preserves the fallback name and slug limit', () => {
    expect(modelExportFilename({ ...model(), description: '---' }, '3mf')).toBe('model.3mf');
    expect(modelExportFilename({ ...model(), description: 'A'.repeat(41) }, 'glb')).toBe(`${'a'.repeat(40)}.glb`);
  });
});

describe('canonical Manifold exports', () => {
  it.each([
    ['3mf', 'model/3mf'],
    ['glb', 'model/gltf-binary'],
  ] as const)('round-trips %s with canonical dimensions and welded topology', async (format, mimeType) => {
    const payload = model();
    const positions = payload.vertProperties.slice();
    const indices = payload.triVerts.slice();
    const mergeFrom = payload.mergeFromVert.slice();
    const mergeTo = payload.mergeToVert.slice();

    const exported = await serializeModel(payload, format, { revision: 3, wasmBinary });
    expect(exported).toMatchObject({
      format,
      filename: `original-model-r3.${format}`,
      mimeType,
    });
    expect(exported.bytes.byteLength).toBeGreaterThan(100);

    const document = await fromArrayBuffer(
      exported.bytes.buffer.slice(
        exported.bytes.byteOffset,
        exported.bytes.byteOffset + exported.bytes.byteLength,
      ) as ArrayBuffer,
      format,
    );
    expect(worldDimensions(document).sort((a, b) => a - b)).toEqual([
      expect.closeTo(10, 6),
      expect.closeTo(20, 6),
      expect.closeTo(30, 6),
    ]);
    expect(payload.vertProperties).toEqual(positions);
    expect(payload.triVerts).toEqual(indices);
    expect(payload.mergeFromVert).toEqual(mergeFrom);
    expect(payload.mergeToVert).toEqual(mergeTo);
  });

  it('writes GLB dimensions in metres', async () => {
    const exported = await serializeModel(model(), 'glb', { wasmBinary });
    const document = await new WebIO().setLogger(new Logger(Verbosity.SILENT)).readBinary(exported.bytes);
    expect(worldDimensions(document).sort((a, b) => a - b)).toEqual([
      expect.closeTo(0.01, 6),
      expect.closeTo(0.02, 6),
      expect.closeTo(0.03, 6),
    ]);
  });

  it('writes a core 3MF archive with explicit millimetre metadata', async () => {
    const exported = await serializeModel({ ...model(), description: 'A\u0001 & B <C> "quoted" \u{1f600}' }, '3mf', {
      wasmBinary,
    });
    const files = unzipSync(exported.bytes);
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const xml = strFromU8(files['3D/3dmodel.model']!);
    expect(xml).toContain('unit="millimeter"');
    expect(xml).toContain('A &amp; B &lt;C&gt; &quot;quoted&quot; \u{1f600}');
    expect(xml).not.toContain('\u0001');
    expect(xml).not.toContain('A & B <C>');
  });
});

function worldDimensions(document: Awaited<ReturnType<typeof fromArrayBuffer>>): [number, number, number] {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) {
      continue;
    }
    matrix.fromArray(node.getWorldMatrix());
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION');
      if (!positions) {
        continue;
      }
      for (let index = 0; index < positions.getCount(); index += 1) {
        point.fromArray(positions.getElement(index, [0, 0, 0])).applyMatrix4(matrix);
        bounds.expandByPoint(point);
      }
    }
  }
  const size = bounds.getSize(new THREE.Vector3());
  return [size.x, size.y, size.z];
}
