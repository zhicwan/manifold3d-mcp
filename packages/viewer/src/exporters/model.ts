import type { ManifoldToplevel } from 'manifold-3d';
import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';
import type { ModelExportFormat } from '@manifold3d/protocol/wire/host-actions.js';

import { packPositions } from '../scene/mesh-bridge.js';
import { modelExportFilename } from './filename.js';

export interface ModelExportOptions {
  revision?: number;
  wasmBinary?: Uint8Array;
}

export interface SerializedModelExport {
  format: ModelExportFormat;
  filename: string;
  mimeType: 'model/3mf' | 'model/gltf-binary';
  bytes: Uint8Array;
}

let manifoldModule: Promise<ManifoldToplevel> | undefined;
let exportQueue = Promise.resolve();

export function serializeModel(
  payload: ViewerModel,
  format: ModelExportFormat,
  options: ModelExportOptions = {},
): Promise<SerializedModelExport> {
  const operation = exportQueue.then(() => serializeModelNow(payload, format, options));
  exportQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function serializeModelNow(
  payload: ViewerModel,
  format: ModelExportFormat,
  options: ModelExportOptions,
): Promise<SerializedModelExport> {
  const [wasm, sceneBuilder] = await Promise.all([getManifoldModule(options.wasmBinary), importSceneBuilder()]);
  const positions = packPositions(payload).slice();
  const mesh = new wasm.Mesh({
    numProp: 3,
    vertProperties: positions,
    triVerts: payload.triVerts.slice(),
    ...(payload.mergeFromVert.length > 0
      ? {
          mergeFromVert: payload.mergeFromVert.slice(),
          mergeToVert: payload.mergeToVert.slice(),
        }
      : {}),
  });
  let manifold: InstanceType<ManifoldToplevel['Manifold']> | undefined;
  try {
    manifold = new wasm.Manifold(mesh);
    if (manifold.status() !== 'NoError') {
      throw new Error(`Could not reconstruct export geometry: ${manifold.status()}.`);
    }
    const document = await sceneBuilder.manifoldToGLTFDoc(manifold);
    const buffer = format === '3mf' ? await serialize3mf(document, payload) : await serializeGlb(document);
    return {
      format,
      filename: modelExportFilename(payload, format, options.revision),
      mimeType: format === '3mf' ? 'model/3mf' : 'model/gltf-binary',
      bytes: new Uint8Array(buffer).slice(),
    };
  } finally {
    sceneBuilder.cleanup();
    manifold?.delete();
  }
}

async function getManifoldModule(wasmBinary?: Uint8Array): Promise<ManifoldToplevel> {
  if (!manifoldModule) {
    manifoldModule = import('manifold-3d')
      .then(async ({ default: Module }) => {
        const load = Module as unknown as (config?: { wasmBinary?: Uint8Array }) => Promise<ManifoldToplevel>;
        const wasm = await load(wasmBinary ? { wasmBinary } : undefined);
        wasm.setup();
        return wasm;
      })
      .catch(error => {
        manifoldModule = undefined;
        throw error;
      });
  }
  return manifoldModule;
}

function importSceneBuilder() {
  return import('manifold-3d/lib/scene-builder.js');
}

async function serialize3mf(
  document: Awaited<ReturnType<Awaited<ReturnType<typeof importSceneBuilder>>['manifoldToGLTFDoc']>>,
  payload: ViewerModel,
): Promise<ArrayBuffer> {
  const { toArrayBuffer } = await import('manifold-3d/lib/export-3mf.js');
  const title = escapeXmlText(payload.description || 'Manifold 3D model');
  return toArrayBuffer(document, {
    header: {
      unit: 'millimeter',
      title,
      description: title,
      application: 'Manifold 3D',
    },
  });
}

function escapeXmlText(value: string): string {
  const validXmlText = [...value]
    .filter(character => {
      const codePoint = character.codePointAt(0)!;
      return (
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff)
      );
    })
    .join('');
  return validXmlText
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function serializeGlb(
  document: Awaited<ReturnType<Awaited<ReturnType<typeof importSceneBuilder>>['manifoldToGLTFDoc']>>,
): Promise<ArrayBuffer> {
  const { toArrayBuffer } = await import('manifold-3d/lib/gltf-io.js');
  return toArrayBuffer(document);
}
