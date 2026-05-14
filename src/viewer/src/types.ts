/**
 * Mesh payload received from the preview WebSocket. Mirrors the wire
 * protocol described in src/server/preview/preview-server.ts:
 *   1. JSON header (text frame)
 *   2. vertProperties as Float32Array buffer (binary frame)
 *   3. triVerts as Uint32Array buffer (binary frame)
 *
 * The buffers are deserialized into typed arrays before being handed off
 * to consumers, so vertex/triangle access is straightforward.
 */
export interface PreviewPayload {
  description?: string;
  /**
   * Number of float properties per vertex emitted by Manifold. The first
   * three are always position; any extras are currently ignored by the
   * viewer but preserved here in case future versions of the viewer want
   * to consume them.
   */
  numProp: number;
  triangles: number;
  vertices: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  /**
   * Recognised primitive instances in the model. Each feature has a
   * display label like "sphere#1" or "cube#2" and the world-space
   * transform of that instance. Empty for raw / unrecognised geometry.
   */
  features: PreviewFeature[];
  /**
   * One Uint32 per triangle: index into `features`. May be a zero-length
   * array if the server had no provenance information.
   */
  triFeatureIds: Uint32Array;
  /**
   * Geometry stats forwarded by the worker. Shown in the control panel's
   * info section; absent from very old server bundles, in which case the
   * viewer should fall back to recomputing locally (or hide the affected
   * fields).
   */
  volume: number;
  surfaceArea: number;
  /** Genus = number of through-holes. 0 ⇒ watertight. */
  genus: number;
  bboxMin: [number, number, number];
  bboxMax: [number, number, number];
}

export interface PreviewFeature {
  label: string;
  kind: 'cube' | 'sphere' | 'cylinder' | 'tetrahedron' | 'extrude' | 'revolve' | 'unknown';
  params: Readonly<Record<string, number | boolean | number[] | undefined>>;
  /** 3x4 column-major local-to-world transform. Length 12. */
  transform: number[];
}
