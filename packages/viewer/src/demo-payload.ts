import Module, { type Manifold, type Vec3 } from 'manifold-3d';
import type { ViewerFeature, ViewerModel } from '@manifold3d/protocol/wire/model.js';

/** The offline fixture is a real boolean union, so intersections are measurement boundaries. */
export async function buildDemoPayload(locateFile?: () => string): Promise<ViewerModel> {
  const wasm = await Module(locateFile ? { locateFile } : undefined);
  wasm.setup();
  const owned: Manifold[] = [];
  const features: ViewerFeature[] = [];
  const originalFeatures = new Map<number, number>();
  const part = (solid: Manifold, translation: Vec3, label: string, kind: ViewerFeature['kind']): Manifold => {
    owned.push(solid);
    originalFeatures.set(solid.originalID(), features.length);
    features.push({
      label,
      kind,
      params: {},
      transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, ...translation],
    });
    const placed = solid.translate(translation);
    owned.push(placed);
    return placed;
  };

  try {
    const parts = [
      part(wasm.Manifold.cube([80, 50, 8], true), [0, 0, 4], 'plate#1', 'cube'),
      part(wasm.Manifold.cube([80, 8, 42], true), [0, 21, 25], 'wall#1', 'cube'),
      part(wasm.Manifold.cylinder(18, 12, 12, 48, true), [-18, -8, 15], 'boss#1', 'cylinder'),
      part(wasm.Manifold.cylinder(26, 4, 4, 32, true), [22, -10, 19], 'pin#1', 'cylinder'),
    ];
    const solid = wasm.Manifold.union(parts);
    owned.push(solid);
    if (solid.status() !== 'NoError') {
      throw new Error(`Demo bracket union failed: ${solid.status()}.`);
    }
    const mesh = solid.getMesh();
    const triFeatureIds = new Uint32Array(mesh.triVerts.length / 3);
    for (let run = 0; run < mesh.runOriginalID.length; run++) {
      const source = mesh.runOriginalID[run];
      const start = mesh.runIndex[run];
      const end = mesh.runIndex[run + 1];
      const feature = source === undefined ? undefined : originalFeatures.get(source);
      if (feature === undefined || start === undefined || end === undefined) {
        throw new Error('Demo union lost its source feature mapping.');
      }
      triFeatureIds.fill(feature, start / 3, end / 3);
    }
    const bounds = solid.boundingBox();
    return {
      description: 'Demo bracket (union)',
      numProp: mesh.numProp,
      triangles: mesh.triVerts.length / 3,
      vertices: mesh.vertProperties.length / mesh.numProp,
      vertProperties: mesh.vertProperties.slice(),
      triVerts: mesh.triVerts.slice(),
      mergeFromVert: mesh.mergeFromVert.slice(),
      mergeToVert: mesh.mergeToVert.slice(),
      features,
      triFeatureIds,
      volume: solid.volume(),
      surfaceArea: solid.surfaceArea(),
      genus: solid.genus(),
      bboxMin: [...bounds.min],
      bboxMax: [...bounds.max],
    };
  } finally {
    for (const solid of owned.reverse()) {
      solid.delete();
    }
  }
}
