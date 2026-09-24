export type MeasurementVec3 = [number, number, number];

export interface MeasurementPoint {
  kind: 'point';
  position: MeasurementVec3;
  vertexId?: number;
  triangleId?: number;
  /** Area centroid of a connected planar patch that lies on the finite surface. */
  faceCenter?: { patchId: number };
}

export interface MeasurementEdge {
  kind: 'edge';
  edgeId: string;
  start: MeasurementVec3;
  end: MeasurementVec3;
}

export interface MeasurementPlane {
  kind: 'plane';
  patchId: number;
  triangleId: number;
  origin: MeasurementVec3;
  normal: MeasurementVec3;
}

export type MeasurementOperand = MeasurementPoint | MeasurementEdge | MeasurementPlane;

export interface MeasurementDistance {
  method: 'segment-length' | 'point-point' | 'point-segment' | 'segment-segment' | 'point-plane' | 'parallel-gap';
  unit: 'mm';
  value: number;
  start: MeasurementVec3;
  end: MeasurementVec3;
  /** At least one witness lies outside the selected finite planar patch. */
  extended?: boolean;
}

export interface MeasurementAngle {
  method: 'edge-corner' | 'line-line' | 'line-plane' | 'plane-plane';
  unit: 'deg';
  /** Shared-endpoint ray angle (0-180) for edge-corner; smaller unoriented angle (0-90) otherwise. */
  value: number;
}

export type MeasurementEvidence =
  | {
      kind: 'edge-length';
      operands: [MeasurementEdge];
      distance: MeasurementDistance;
    }
  | {
      kind: 'relation';
      operands: [MeasurementOperand, MeasurementOperand];
      distance?: MeasurementDistance;
      angle?: MeasurementAngle;
    };

/** Dimensionless sine tolerance used to classify supporting directions as parallel. */
export const MEASUREMENT_PARALLEL_TOLERANCE = 1e-5;
const NORMAL_TOLERANCE = 1e-6;
const MAX_MEASUREMENT_INDEX = 0xffff_ffff;

/** A corner requires one exact shared canonical endpoint, not merely nearby segments. */
export function measureEdgeCorner(
  first: MeasurementEdge,
  second: MeasurementEdge,
): { vertex: MeasurementVec3; value: number } | undefined {
  let corner: { vertex: MeasurementVec3; value: number } | undefined;
  for (const [origin, end] of [
    [first.start, first.end],
    [first.end, first.start],
  ] as const) {
    for (const [otherOrigin, otherEnd] of [
      [second.start, second.end],
      [second.end, second.start],
    ] as const) {
      if (!origin.every((component, index) => component === otherOrigin[index])) {
        continue;
      }
      if (corner !== undefined) {
        return undefined;
      }
      const u = unitVector(subtract(end, origin));
      const v = unitVector(subtract(otherEnd, otherOrigin));
      corner = {
        vertex: [...origin],
        value: (Math.atan2(crossMagnitude(u, v), Math.max(-1, Math.min(1, dotProduct(u, v)))) * 180) / Math.PI,
      };
    }
  }
  return corner;
}

/** Parses a bounded, detached snapshot. Geometry provenance still belongs to the producer. */
export function parseMeasurementEvidence(value: unknown): MeasurementEvidence {
  const record = measurementRecord(value, ['kind', 'operands', 'distance', 'angle']);
  if (!Array.isArray(record.operands)) {
    throw new Error('Measurement operands must be an array.');
  }
  if (record.kind === 'edge-length') {
    if (record.operands.length !== 1 || Object.hasOwn(record, 'angle')) {
      throw new Error('Edge length requires exactly one edge and no angle.');
    }
    const edge = parseMeasurementOperand(record.operands[0]);
    if (edge.kind !== 'edge') {
      throw new Error('Edge length requires an edge operand.');
    }
    const distance = parseDistance(record.distance);
    if (distance.method !== 'segment-length' || distance.extended !== undefined) {
      throw new Error('Edge length requires segment-length distance without plane extension.');
    }
    if (
      !(samePoint(distance.start, edge.start) && samePoint(distance.end, edge.end)) &&
      !(samePoint(distance.start, edge.end) && samePoint(distance.end, edge.start))
    ) {
      throw new Error('Edge length witnesses must match its endpoints.');
    }
    return { kind: 'edge-length', operands: [edge], distance };
  }
  if (record.kind !== 'relation' || record.operands.length !== 2) {
    throw new Error('Measurement relation requires exactly two operands.');
  }
  const operands: [MeasurementOperand, MeasurementOperand] = [
    parseMeasurementOperand(record.operands[0]),
    parseMeasurementOperand(record.operands[1]),
  ];
  const distance = record.distance === undefined ? undefined : parseDistance(record.distance);
  const angle = record.angle === undefined ? undefined : parseAngle(record.angle);
  const points = operands.filter(operand => operand.kind === 'point');
  const edges = operands.filter(operand => operand.kind === 'edge');
  const planes = operands.filter(operand => operand.kind === 'plane');
  if (points.length > 0) {
    const method = points.length === 2 ? 'point-point' : edges.length === 1 ? 'point-segment' : 'point-plane';
    if (!distance || distance.method !== method || angle) {
      throw new Error('Point relations require the matching distance method and no angle.');
    }
  } else {
    const method = edges.length === 2 ? 'line-line' : edges.length === 1 ? 'line-plane' : 'plane-plane';
    if (!angle || (angle.method !== method && !(method === 'line-line' && angle.method === 'edge-corner'))) {
      throw new Error('Direction relations require the matching angle method.');
    }
    const corner = edges.length === 2 ? measureEdgeCorner(edges[0]!, edges[1]!) : undefined;
    if (method === 'line-line' && corner !== undefined && angle.method !== 'edge-corner') {
      throw new Error('Edges with one shared endpoint require an edge-corner angle.');
    }
    const directions = operands.map(operand =>
      operand.kind === 'edge' ? edgeDirection(operand) : unitVector((operand as MeasurementPlane).normal),
    );
    const dot = Math.min(1, Math.abs(dotProduct(directions[0]!, directions[1]!)));
    const parallel = method === 'line-plane' ? dot : crossMagnitude(directions[0]!, directions[1]!);
    const expectedAngle =
      angle.method === 'edge-corner'
        ? corner?.value
        : method !== 'line-line' && parallel <= MEASUREMENT_PARALLEL_TOLERANCE
          ? 0
          : (method === 'line-plane' ? Math.asin(dot) : Math.acos(dot)) * (180 / Math.PI);
    if (expectedAngle === undefined) {
      throw new Error('An edge-corner angle requires exactly one shared endpoint.');
    }
    if (Math.abs(angle.value - expectedAngle) > 1e-5) {
      throw new Error('Measurement angle is inconsistent with operand directions.');
    }
    if (edges.length === 2) {
      if (!distance || distance.method !== 'segment-segment') {
        throw new Error('Edge relations require finite segment-segment distance.');
      }
    } else if (distance) {
      if (distance.method !== 'parallel-gap' || parallel > MEASUREMENT_PARALLEL_TOLERANCE) {
        throw new Error('Supporting-plane gaps require parallel operands.');
      }
    }
  }
  if (distance) {
    if (planes.length === 0 && distance.extended !== undefined) {
      throw new Error('Plane extension requires a plane operand.');
    }
    if (
      !closestWitnessesMatch(distance.start, distance.end, operands[0], operands[1], planes.length === 0) &&
      !closestWitnessesMatch(distance.end, distance.start, operands[0], operands[1], planes.length === 0)
    ) {
      throw new Error('Measurement witnesses must be closest points on their operands.');
    }
    if (planes.length > 0) {
      const delta = subtract(distance.end, distance.start);
      const normal = unitVector(planes[0]!.normal);
      const along = dotProduct(delta, normal);
      const residual = subtract(delta, normal.map(component => component * along) as MeasurementVec3);
      if (Math.hypot(...residual) > numericTolerance(distance.value)) {
        throw new Error('Supporting-plane distance witnesses must be perpendicular.');
      }
    }
  }
  return {
    kind: 'relation',
    operands,
    ...(distance ? { distance } : {}),
    ...(angle ? { angle } : {}),
  };
}

function parseMeasurementOperand(value: unknown): MeasurementOperand {
  const record = measurementRecord(value);
  if (record.kind === 'point') {
    measurementKeys(record, ['kind', 'position', 'vertexId', 'triangleId', 'faceCenter']);
    let faceCenter: MeasurementPoint['faceCenter'];
    if (record.faceCenter !== undefined) {
      const center = measurementRecord(record.faceCenter, ['patchId']);
      if (record.vertexId !== undefined || record.triangleId !== undefined) {
        throw new Error('A face center cannot also identify a mesh vertex or triangle hit.');
      }
      faceCenter = { patchId: measurementIndex(center.patchId) };
    }
    return {
      kind: 'point',
      position: measurementVector(record.position),
      ...(record.vertexId !== undefined ? { vertexId: measurementIndex(record.vertexId) } : {}),
      ...(record.triangleId !== undefined ? { triangleId: measurementIndex(record.triangleId) } : {}),
      ...(faceCenter ? { faceCenter } : {}),
    };
  }
  if (record.kind === 'edge') {
    measurementKeys(record, ['kind', 'edgeId', 'start', 'end']);
    if (
      typeof record.edgeId !== 'string' ||
      record.edgeId.length > 128 ||
      !/^[A-Za-z0-9][-A-Za-z0-9._:]*$/.test(record.edgeId)
    ) {
      throw new Error('Measurement edgeId must be a bounded safe identifier.');
    }
    const start = measurementVector(record.start);
    const end = measurementVector(record.end);
    const length = Math.hypot(...subtract(end, start));
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error('Measurement edge must be nondegenerate with finite length.');
    }
    return { kind: 'edge', edgeId: record.edgeId, start, end };
  }
  if (record.kind === 'plane') {
    measurementKeys(record, ['kind', 'patchId', 'triangleId', 'origin', 'normal']);
    const normal = measurementVector(record.normal);
    if (Math.abs(Math.hypot(...normal) - 1) > NORMAL_TOLERANCE) {
      throw new Error('Measurement plane normal must be normalized.');
    }
    return {
      kind: 'plane',
      patchId: measurementIndex(record.patchId),
      triangleId: measurementIndex(record.triangleId),
      origin: measurementVector(record.origin),
      normal,
    };
  }
  throw new Error('Measurement operand kind is unsupported.');
}

function parseDistance(value: unknown): MeasurementDistance {
  const record = measurementRecord(value, ['method', 'unit', 'value', 'start', 'end', 'extended']);
  const methods = ['segment-length', 'point-point', 'point-segment', 'segment-segment', 'point-plane', 'parallel-gap'];
  if (typeof record.method !== 'string' || !methods.includes(record.method) || record.unit !== 'mm') {
    throw new Error('Measurement distance method or unit is unsupported.');
  }
  const amount = measurementQuantity(record.value);
  const start = measurementVector(record.start);
  const end = measurementVector(record.end);
  const length = Math.hypot(...subtract(end, start));
  if (!Number.isFinite(length) || Math.abs(length - amount) > numericTolerance(amount)) {
    throw new Error('Measurement distance is inconsistent with its witnesses.');
  }
  if (record.extended !== undefined && typeof record.extended !== 'boolean') {
    throw new Error('Measurement extended must be a boolean.');
  }
  return {
    method: record.method as MeasurementDistance['method'],
    unit: 'mm',
    value: amount,
    start,
    end,
    ...(record.extended !== undefined ? { extended: record.extended } : {}),
  };
}

function parseAngle(value: unknown): MeasurementAngle {
  const record = measurementRecord(value, ['method', 'unit', 'value']);
  if (
    (record.method !== 'edge-corner' &&
      record.method !== 'line-line' &&
      record.method !== 'line-plane' &&
      record.method !== 'plane-plane') ||
    record.unit !== 'deg'
  ) {
    throw new Error('Measurement angle method or unit is unsupported.');
  }
  const amount = measurementQuantity(record.value);
  const maximum = record.method === 'edge-corner' ? 180 : 90;
  if (amount > maximum) {
    throw new Error(`Measurement ${record.method} angle must be between 0 and ${maximum} degrees.`);
  }
  return { method: record.method, unit: 'deg', value: amount };
}

function measurementRecord(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error('Measurement data must be a plain object.');
  }
  const record = value as Record<string, unknown>;
  if (keys) {
    measurementKeys(record, keys);
  }
  return record;
}

function measurementKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(record).some(key => !keys.includes(key))) {
    throw new Error('Measurement data contains unsupported fields.');
  }
}

function measurementVector(value: unknown): MeasurementVec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(component => typeof component === 'number' && Number.isFinite(component))
  ) {
    throw new Error('Measurement coordinates must contain three finite numbers.');
  }
  return [value[0], value[1], value[2]];
}

function measurementIndex(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_MEASUREMENT_INDEX) {
    throw new Error('Measurement index must be an unsigned 32-bit integer.');
  }
  return value;
}

function measurementQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('Measurement quantity must be finite and nonnegative.');
  }
  return value;
}

function numericTolerance(value: number): number {
  return 1e-6 * Math.max(1, Math.abs(value));
}

function subtract(a: MeasurementVec3, b: MeasurementVec3): MeasurementVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dotProduct(a: MeasurementVec3, b: MeasurementVec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossMagnitude(a: MeasurementVec3, b: MeasurementVec3): number {
  return Math.hypot(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);
}

function samePoint(a: MeasurementVec3, b: MeasurementVec3): boolean {
  if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) {
    return false;
  }
  const roundoff = 16 * Number.EPSILON * Math.max(...a.map(Math.abs), ...b.map(Math.abs));
  return Math.hypot(...subtract(a, b)) <= 1e-6 + roundoff;
}

function edgeDirection(edge: MeasurementEdge): MeasurementVec3 {
  return unitVector(subtract(edge.end, edge.start));
}

function unitVector(delta: MeasurementVec3): MeasurementVec3 {
  const length = Math.hypot(...delta);
  return delta.map(value => value / length) as MeasurementVec3;
}

function closestWitnessesMatch(
  a: MeasurementVec3,
  b: MeasurementVec3,
  first: MeasurementOperand,
  second: MeasurementOperand,
  finiteMinimum: boolean,
): boolean {
  return (
    closestWitnessMatches(a, finiteMinimum ? b : a, first) && closestWitnessMatches(b, finiteMinimum ? a : b, second)
  );
}

function closestWitnessMatches(witness: MeasurementVec3, other: MeasurementVec3, operand: MeasurementOperand): boolean {
  if (operand.kind === 'point') {
    return samePoint(witness, operand.position);
  }
  if (operand.kind === 'plane') {
    const normal = unitVector(operand.normal);
    const along = dotProduct(subtract(other, operand.origin), normal);
    const expected = other.map((value, index) => value - normal[index]! * along) as MeasurementVec3;
    return samePoint(witness, expected);
  }
  const direction = edgeDirection(operand);
  const length = Math.hypot(...subtract(operand.end, operand.start));
  const along = Math.max(0, Math.min(length, dotProduct(subtract(other, operand.start), direction)));
  const expected = operand.start.map((value, index) => value + direction[index]! * along) as MeasurementVec3;
  return samePoint(witness, expected);
}
