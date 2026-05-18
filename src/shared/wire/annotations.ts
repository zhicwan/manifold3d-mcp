/**
 * Shared wire-format definitions for annotations exchanged between the
 * preview server (Node) and the viewer (browser). This module is the
 * SINGLE source of truth — both sides import from here so that adding
 * or renaming a wire field cannot silently desync the two halves.
 *
 * The full client-side annotation (with per-triangle indices for
 * region selections) lives in src/viewer/src/marks/types.ts; THIS is
 * the on-the-wire/server projection that AI clients see via the
 * `get_annotations` MCP tool.
 *
 * Multi-tab note: every annotation may carry a `clientId` identifying
 * the WS connection that produced it. The server uses this to merge
 * annotations across multiple viewer tabs without one tab clobbering
 * the other (VIE-2). AI clients still see a flat list — the clientId
 * is purely an internal routing tag.
 */
export interface WireAnnotation {
  id: string;
  modelVersion: string;
  kind: 'point' | 'region' | 'sketch';
  partLabel: string;
  note: string;
  worldCoord: [number, number, number];
  /** Only set for kind='region'. Number of triangles in the selection. */
  triCount?: number;
  /** Only set for kind='sketch'. View-aligned plane used for 2D sketch strokes. */
  viewPlane?: 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
  /** Only set for kind='sketch'. World-space origin of the sketch plane. */
  planeOrigin?: [number, number, number];
  /** Only set for kind='sketch'. 2D strokes in sketch-plane coordinates. */
  strokes?: Array<Array<[number, number]>>;
  /**
   * Server-assigned identifier of the WebSocket connection that owns
   * this annotation. Set by the server on the inbound message before
   * caching; viewers don't have to populate it. AI consumers see a
   * flat union of all clients' annotations and can ignore this field.
   */
  clientId?: string;
}

export interface AnnotationsMessage {
  kind: 'annotations';
  modelVersion: string;
  items: WireAnnotation[];
}

/**
 * Server -> client greeting frame, sent immediately after the WS
 * handshake succeeds. Tells the viewer which clientId the server has
 * assigned to it so subsequent uplink messages and replayed snapshots
 * can be reasoned about consistently.
 */
export interface HelloMessage {
  kind: 'hello';
  clientId: string;
}

/**
 * Type guard for the WS text frames the preview server accepts from
 * connected viewers. Anything that isn't an `annotations` message is
 * ignored (forward compatible).
 *
 * Validates the shape of every item too — a truncated or malformed
 * payload (e.g. a stale viewer that omits `worldCoord`) is rejected
 * outright rather than silently merged into the cache. This is
 * tighter than the original guard which only checked the top-level
 * `kind` and `items` array (VIE-7).
 */
export function isAnnotationsMessage(x: unknown): x is AnnotationsMessage {
  if (!x || typeof x !== 'object') {
    return false;
  }
  const m = x as { kind?: unknown; modelVersion?: unknown; items?: unknown };
  if (m.kind !== 'annotations') {
    return false;
  }
  if (typeof m.modelVersion !== 'string') {
    return false;
  }
  if (!Array.isArray(m.items)) {
    return false;
  }
  for (const item of m.items) {
    if (!isWireAnnotation(item)) {
      return false;
    }
  }
  return true;
}

function isWireAnnotation(x: unknown): x is WireAnnotation {
  if (!x || typeof x !== 'object') {
    return false;
  }
  const a = x as Record<string, unknown>;
  if (typeof a.id !== 'string') {
    return false;
  }
  if (typeof a.modelVersion !== 'string') {
    return false;
  }
  if (a.kind !== 'point' && a.kind !== 'region' && a.kind !== 'sketch') {
    return false;
  }
  if (typeof a.partLabel !== 'string') {
    return false;
  }
  if (typeof a.note !== 'string') {
    return false;
  }
  if (
    !Array.isArray(a.worldCoord) ||
    a.worldCoord.length !== 3 ||
    typeof a.worldCoord[0] !== 'number' ||
    typeof a.worldCoord[1] !== 'number' ||
    typeof a.worldCoord[2] !== 'number'
  ) {
    return false;
  }
  if (a.triCount !== undefined && typeof a.triCount !== 'number') {
    return false;
  }
  if (a.clientId !== undefined && typeof a.clientId !== 'string') {
    return false;
  }
  if (a.kind === 'sketch') {
    return isWireSketchAnnotation(a);
  }
  return true;
}

const VIEW_PLANES = new Set(['front', 'back', 'left', 'right', 'top', 'bottom']);

function isNumber3(x: unknown): x is [number, number, number] {
  return (
    Array.isArray(x) &&
    x.length === 3 &&
    typeof x[0] === 'number' &&
    typeof x[1] === 'number' &&
    typeof x[2] === 'number'
  );
}

function isNumber2(x: unknown): x is [number, number] {
  return Array.isArray(x) && x.length === 2 && typeof x[0] === 'number' && typeof x[1] === 'number';
}

function isWireSketchAnnotation(a: Record<string, unknown>): boolean {
  if (typeof a.viewPlane !== 'string' || !VIEW_PLANES.has(a.viewPlane)) {
    return false;
  }
  if (!isNumber3(a.planeOrigin)) {
    return false;
  }
  if (!Array.isArray(a.strokes) || a.strokes.length === 0) {
    return false;
  }
  for (const stroke of a.strokes) {
    if (!Array.isArray(stroke) || stroke.length < 2) {
      return false;
    }
    for (const point of stroke) {
      if (!isNumber2(point)) {
        return false;
      }
    }
  }
  return true;
}
