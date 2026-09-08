import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';

import { payloadToGeometry } from '../scene/mesh-bridge.js';

/**
 * Serialize canonical model geometry as binary STL, without scene/XR transforms.
 * STL duplicates vertices per face, so consumers should treat the exported
 * triangle soup as a print artifact rather than the canonical indexed mesh.
 */
export function exportStl(payload: ViewerModel): Blob {
  const bytes = serializeStl(payload);
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'model/stl',
  });
}

export function serializeStl(payload: ViewerModel): Uint8Array {
  const geometry = payloadToGeometry(payload);
  const material = new THREE.MeshBasicMaterial();
  try {
    const exporter = new STLExporter();
    const data = exporter.parse(new THREE.Mesh(geometry, material), { binary: true }) as DataView;
    return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength).slice();
  } finally {
    geometry.dispose();
    material.dispose();
  }
}
