import { Box3, Triangle, Vector3 } from 'three';
import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';
import type {
  MeasurementDistance,
  MeasurementEvidence,
  MeasurementOperand,
  MeasurementPlane,
  MeasurementVec3,
} from '@manifold3d/protocol/wire/measurements.js';
import { measureEdgeCorner, MEASUREMENT_PARALLEL_TOLERANCE } from '@manifold3d/protocol/wire/measurements.js';

export interface MeasurementCandidate {
  key: string;
  operand: MeasurementOperand;
  anchor: MeasurementVec3;
  triIds: readonly number[];
}

interface Face {
  id: number;
  vertices: [number, number, number];
  triangle: Triangle;
  normal: Vector3;
  patch: number;
}

interface Segment {
  a: number;
  b: number;
  faces: number[];
  support: string;
}

// Recognition and supporting-direction semantics share the Float32 payload tolerance.
const PLANAR_SINE = MEASUREMENT_PARALLEL_TOLERANCE;
const STRAIGHT_SINE = 1e-6;
const CURVED_NEIGHBOR_COSINE = Math.cos(Math.PI / 6);
const vector = (p: MeasurementVec3): Vector3 => new Vector3(...p);
const tuple = (p: Vector3): MeasurementVec3 => [p.x, p.y, p.z];
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const edgeKey = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`;

function unit(v: Vector3): Vector3 {
  const length = v.length();
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError('Measurement direction is degenerate.');
  }
  return v.divideScalar(length);
}

function validateOperand(operand: MeasurementOperand): void {
  const points =
    operand.kind === 'point'
      ? [operand.position]
      : operand.kind === 'edge'
        ? [operand.start, operand.end]
        : [operand.origin, operand.normal];
  if (points.some(p => p.length !== 3 || p.some(n => !Number.isFinite(n)))) {
    throw new RangeError('Measurement coordinates must be finite triples.');
  }
  if (operand.kind === 'edge') {
    unit(vector(operand.end).sub(vector(operand.start)));
  }
  if (operand.kind === 'plane') {
    unit(vector(operand.normal));
  }
}

function segmentFoot(point: Vector3, start: Vector3, end: Vector3): Vector3 {
  const delta = end.clone().sub(start);
  return start.clone().addScaledVector(delta, clamp(point.clone().sub(start).dot(delta) / delta.lengthSq()));
}

function segmentWitnesses(a: Vector3, b: Vector3, c: Vector3, d: Vector3): [Vector3, Vector3] {
  const pairs: [Vector3, Vector3][] = [
    [a, segmentFoot(a, c, d)],
    [b, segmentFoot(b, c, d)],
    [segmentFoot(c, a, b), c],
    [segmentFoot(d, a, b), d],
  ];
  const u = b.clone().sub(a);
  const v = d.clone().sub(c);
  const w = c.clone().sub(a);
  const cross = u.clone().cross(v);
  const denominator = cross.lengthSq();
  // Cross products avoid cancellation in |u|²|v|² - (u.v)² for near-parallel lines.
  if (denominator > 0) {
    const s = w.clone().cross(v).dot(cross) / denominator;
    const t = w.clone().cross(u).dot(cross) / denominator;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
      pairs.push([a.clone().addScaledVector(u, s), c.clone().addScaledVector(v, t)]);
    }
  }
  pairs.sort((p, q) => p[0].distanceToSquared(p[1]) - q[0].distanceToSquared(q[1]));
  return pairs[0]!;
}

function distance(
  method: MeasurementDistance['method'],
  a: Vector3,
  b: Vector3,
  extended = false,
): MeasurementDistance {
  return {
    method,
    unit: 'mm',
    value: a.distanceTo(b),
    start: tuple(a),
    end: tuple(b),
    ...(extended ? { extended: true } : {}),
  };
}

/** Canonical topology is cached per payload; only declared merge pairs weld property seams. */
export class MeasurementGeometry {
  readonly candidates: readonly MeasurementCandidate[];
  readonly vertices: readonly MeasurementCandidate[];
  readonly edges: readonly MeasurementCandidate[];
  readonly planes: readonly MeasurementCandidate[];
  readonly centers: readonly MeasurementCandidate[];
  readonly diagnostics: readonly string[];
  readonly tolerance: number;
  private readonly faces = new Map<number, Face>();
  private readonly triangleCandidates = new Map<number, MeasurementCandidate[]>();
  private readonly patchCandidates = new Map<number, MeasurementCandidate>();
  private readonly patchFaces = new Map<number, Face[]>();
  private readonly patchAreas = new Map<number, number>();
  private readonly patchCenters = new Map<number, MeasurementCandidate>();

  constructor(payload: ViewerModel) {
    if (
      !Number.isInteger(payload.numProp) ||
      payload.numProp < 3 ||
      payload.vertProperties.length !== payload.vertices * payload.numProp ||
      payload.triVerts.length !== payload.triangles * 3 ||
      payload.mergeFromVert.length !== payload.mergeToVert.length
    ) {
      throw new RangeError('Measurement mesh buffers do not match their declared dimensions.');
    }
    const positions: Vector3[] = [];
    const bounds = new Box3();
    let magnitude = 0;
    for (let i = 0; i < payload.vertices; i++) {
      const p = new Vector3().fromArray(payload.vertProperties, i * payload.numProp);
      if (![p.x, p.y, p.z].every(Number.isFinite)) {
        throw new RangeError(`Nonfinite measurement vertex ${i}.`);
      }
      positions.push(p);
      bounds.expandByPoint(p);
      magnitude = Math.max(magnitude, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
    }
    const scale = bounds.isEmpty() ? 0 : bounds.getSize(new Vector3()).length();
    // Two Float32 ULPs at the coordinate magnitude, with a scale-relative floor.
    this.tolerance = Math.max(scale * 1e-6, magnitude * 2 ** -22, 1e-12);
    const roots = positions.map((_, i) => i);
    const root = (i: number): number => {
      if (!Number.isInteger(i) || i < 0 || i >= roots.length) {
        throw new RangeError(`Invalid measurement vertex index ${i}.`);
      }
      let r = i;
      while (roots[r] !== r) {
        r = roots[r]!;
      }
      while (i !== r) {
        const next = roots[i]!;
        roots[i] = r;
        i = next;
      }
      return r;
    };
    for (let i = 0; i < payload.mergeFromVert.length; i++) {
      const a = root(payload.mergeFromVert[i]!);
      const b = root(payload.mergeToVert[i]!);
      if (positions[a]!.distanceTo(positions[b]!) > this.tolerance) {
        throw new RangeError('A measurement merge pair joins different positions.');
      }
      roots[Math.max(a, b)] = Math.min(a, b);
    }
    const diagnostics: string[] = [];
    const topology = new Map<string, Segment>();
    const vertexFaces = new Map<number, number[]>();
    for (let id = 0; id < payload.triangles; id++) {
      const vertices: [number, number, number] = [
        root(payload.triVerts[id * 3]!),
        root(payload.triVerts[id * 3 + 1]!),
        root(payload.triVerts[id * 3 + 2]!),
      ];
      const [a, b, c] = vertices.map(i => positions[i]!) as [Vector3, Vector3, Vector3];
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      const maxLengthSq = Math.max(a.distanceToSquared(b), b.distanceToSquared(c), c.distanceToSquared(a));
      if (normal.length() <= maxLengthSq * Number.EPSILON * 16) {
        diagnostics.push(`Omitted degenerate triangle ${id}.`);
        continue;
      }
      this.faces.set(id, { id, vertices, triangle: new Triangle(a, b, c), normal: normal.normalize(), patch: -1 });
      for (const vertex of vertices) {
        const ids = vertexFaces.get(vertex) ?? [];
        ids.push(id);
        vertexFaces.set(vertex, ids);
      }
      for (let j = 0; j < 3; j++) {
        const startId = vertices[j]!;
        const endId = vertices[(j + 1) % 3]!;
        const key = edgeKey(startId, endId);
        const segment = topology.get(key) ?? {
          a: Math.min(startId, endId),
          b: Math.max(startId, endId),
          faces: [],
          support: '',
        };
        segment.faces.push(id);
        topology.set(key, segment);
      }
    }
    const neighbors = new Map<number, number[]>();
    for (const segment of topology.values()) {
      if (segment.faces.length > 2) {
        diagnostics.push(`Nonmanifold edge ${edgeKey(segment.a, segment.b)} is not measurable.`);
      }
      if (segment.faces.length !== 2) {
        continue;
      }
      const [a, b] = segment.faces as [number, number];
      for (const [from, to] of [
        [a, b],
        [b, a],
      ] as const) {
        const adjacent = neighbors.get(from) ?? [];
        adjacent.push(to);
        neighbors.set(from, adjacent);
      }
    }
    const planes: MeasurementCandidate[] = [];
    for (const seed of this.faces.values()) {
      if (seed.patch !== -1) {
        continue;
      }
      const patchId = seed.id;
      const queue = [seed];
      seed.patch = patchId;
      for (let index = 0; index < queue.length; index++) {
        for (const id of neighbors.get(queue[index]!.id) ?? []) {
          const face = this.faces.get(id)!;
          if (
            face.patch !== -1 ||
            seed.normal.clone().cross(face.normal).length() > PLANAR_SINE ||
            [face.triangle.a, face.triangle.b, face.triangle.c].some(
              p => Math.abs(p.clone().sub(seed.triangle.a).dot(seed.normal)) > this.tolerance,
            )
          ) {
            continue;
          }
          face.patch = patchId;
          queue.push(face);
        }
      }
      queue.sort((a, b) => a.id - b.id);
      this.patchFaces.set(patchId, queue);
      let area = 0;
      const centroid = new Vector3();
      for (const face of queue) {
        const weight = face.triangle.getArea();
        area += weight;
        centroid.addScaledVector(face.triangle.getMidpoint(new Vector3()).sub(seed.triangle.a), weight);
      }
      if (!(area > 0)) {
        throw new Error('A planar measurement region has no positive area.');
      }
      centroid.divideScalar(area).add(seed.triangle.a);
      this.patchAreas.set(patchId, area);
      const origin = tuple(seed.triangle.a);
      const operand: MeasurementPlane = {
        kind: 'plane',
        patchId,
        triangleId: seed.id,
        origin,
        normal: tuple(seed.normal),
      };
      const candidate: MeasurementCandidate = {
        key: `plane:${patchId}`,
        operand,
        anchor: tuple(seed.triangle.getMidpoint(new Vector3())),
        triIds: queue.map(f => f.id),
      };
      this.patchCandidates.set(patchId, candidate);
      const position = tuple(centroid);
      if (!this.outside(operand, centroid)) {
        this.patchCenters.set(patchId, {
          key: `face-center:${patchId}`,
          operand: { kind: 'point', position, faceCenter: { patchId } },
          anchor: position,
          triIds: candidate.triIds,
        });
      }
      planes.push(candidate);
    }
    // Curved tessellation produces planar facets too. Suppress their centers
    // only when two substantial, similarly sized neighbors continue the normal
    // in opposing tangent directions. Absolute area would hide small real faces.
    const boundaries = new Map<number, Map<number, number>>();
    for (const segment of topology.values()) {
      const patches = [...new Set(segment.faces.map(id => this.faces.get(id)!.patch))];
      if (patches.length === 1 && segment.faces.length !== 1) {
        continue;
      }
      const length = positions[segment.a]!.distanceTo(positions[segment.b]!);
      for (const patch of patches) {
        if (patches.length === 2 && segment.faces.length === 2) {
          const other = patches.find(id => id !== patch)!;
          const adjacent = boundaries.get(patch) ?? new Map<number, number>();
          adjacent.set(other, (adjacent.get(other) ?? 0) + length);
          boundaries.set(patch, adjacent);
        }
      }
    }
    for (const patch of this.patchCenters.keys()) {
      const normal = this.faces.get(patch)!.normal;
      const area = this.patchAreas.get(patch)!;
      const tangentDirections: Vector3[] = [];
      for (const [other, boundary] of boundaries.get(patch) ?? []) {
        const adjacentNormal = this.faces.get(other)!.normal;
        const dot = normal.dot(adjacentNormal);
        const areaRatio = this.patchAreas.get(other)! / area;
        if (
          dot < CURVED_NEIGHBOR_COSINE ||
          dot >= 1 ||
          areaRatio < 0.25 ||
          areaRatio > 4 ||
          boundary <= this.tolerance * 4
        ) {
          continue;
        }
        const tangent = adjacentNormal.clone().addScaledVector(normal, -dot);
        if (tangent.length() > PLANAR_SINE) {
          tangentDirections.push(tangent.normalize());
        }
      }
      if (tangentDirections.some((a, index) => tangentDirections.slice(index + 1).some(b => a.dot(b) < -0.5))) {
        this.patchCenters.delete(patch);
      }
    }
    // Share the highlight union for repeated patch combinations (e.g. a finely tessellated face).
    const highlightCache = new Map<string, readonly number[]>();
    const highlight = (ids: readonly number[]): readonly number[] => {
      const patches = [...new Set(ids.map(id => this.faces.get(id)!.patch))].sort((a, b) => a - b);
      const key = patches.join(':');
      let result = highlightCache.get(key);
      if (!result) {
        result = patches.flatMap(id => this.patchCandidates.get(id)!.triIds).sort((a, b) => a - b);
        highlightCache.set(key, result);
      }
      return result;
    };
    const indexCandidate = (candidate: MeasurementCandidate, ids: readonly number[]): void => {
      for (const id of new Set(ids)) {
        const candidates = this.triangleCandidates.get(id) ?? [];
        candidates.push(candidate);
        this.triangleCandidates.set(id, candidates);
      }
    };
    const centers = [...this.patchCenters.values()];
    for (const center of centers) {
      indexCandidate(center, center.triIds);
    }
    const vertices: MeasurementCandidate[] = [];
    for (const [vertexId, ids] of [...vertexFaces].sort(([a], [b]) => a - b)) {
      const position = tuple(positions[vertexId]!);
      const candidate: MeasurementCandidate = {
        key: `vertex:${vertexId}`,
        operand: { kind: 'point', position, vertexId },
        anchor: position,
        triIds: highlight(ids),
      };
      vertices.push(candidate);
      indexCandidate(candidate, ids);
    }
    const segments = [...topology.values()].filter(segment => {
      const patches = [...new Set(segment.faces.map(id => this.faces.get(id)!.patch))].sort((a, b) => a - b);
      segment.support = patches.join(':');
      return segment.faces.length === 1 || (segment.faces.length === 2 && patches.length === 2);
    });
    const incident = new Map<number, Segment[]>();
    for (const segment of segments) {
      for (const id of [segment.a, segment.b]) {
        const list = incident.get(id) ?? [];
        list.push(segment);
        incident.set(id, list);
      }
    }
    const visited = new Set<Segment>();
    const edges: MeasurementCandidate[] = [];
    for (const seed of segments) {
      if (visited.has(seed)) {
        continue;
      }
      visited.add(seed);
      const members = [seed];
      const start = positions[seed.a]!;
      const direction = unit(positions[seed.b]!.clone().sub(start));
      const walk = (initial: number, sign: number): number => {
        let end = initial;
        for (;;) {
          const nextEdges = incident.get(end)!;
          // Even branches with different supports must stop the maximal chain.
          if (nextEdges.length !== 2) {
            return end;
          }
          const next = nextEdges.find(edge => !visited.has(edge));
          if (!next || next.support !== seed.support) {
            return end;
          }
          const other = next.a === end ? next.b : next.a;
          const delta = unit(positions[other]!.clone().sub(positions[end]!));
          if (
            delta.dot(direction) * sign <= 0 ||
            delta.clone().cross(direction).length() > STRAIGHT_SINE ||
            positions[other]!.clone().sub(start).cross(direction).length() > this.tolerance
          ) {
            return end;
          }
          visited.add(next);
          members.push(next);
          end = other;
        }
      };
      let a = walk(seed.a, -1);
      let b = walk(seed.b, 1);
      if (a > b) {
        [a, b] = [b, a];
      }
      const ids = members.flatMap(segment => segment.faces);
      const edgeId = `${a}:${b}:${seed.support}`;
      const candidate: MeasurementCandidate = {
        key: `edge:${edgeId}`,
        operand: { kind: 'edge', edgeId, start: tuple(positions[a]!), end: tuple(positions[b]!) },
        anchor: tuple(positions[a]!.clone().add(positions[b]!).multiplyScalar(0.5)),
        triIds: highlight(ids),
      };
      edges.push(candidate);
      indexCandidate(candidate, ids);
    }
    this.vertices = vertices;
    this.edges = edges;
    this.planes = planes;
    this.centers = centers;
    this.candidates = [...vertices, ...edges, ...planes, ...centers];
    this.diagnostics = diagnostics;
  }

  planeForTriangle(triangleId: number): MeasurementCandidate | null {
    const face = this.faces.get(triangleId);
    return face ? this.patchCandidates.get(face.patch)! : null;
  }

  centerForPatch(patchId: number): MeasurementCandidate | null {
    return this.patchCenters.get(patchId) ?? null;
  }

  /** Actual incidence, not the larger highlight regions, for BVH-local snapping. */
  candidatesForTriangle(triangleId: number): readonly MeasurementCandidate[] {
    return this.triangleCandidates.get(triangleId) ?? [];
  }

  private outside(plane: Extract<MeasurementOperand, { kind: 'plane' }>, point: Vector3): boolean {
    return !(this.patchFaces.get(plane.patchId) ?? []).some(
      face => face.triangle.closestPointToPoint(point, new Vector3()).distanceTo(point) <= this.tolerance,
    );
  }

  measure(a: MeasurementCandidate, b?: MeasurementCandidate): MeasurementEvidence | null {
    validateOperand(a.operand);
    if (!b) {
      if (a.operand.kind !== 'edge') {
        return null;
      }
      return {
        kind: 'edge-length',
        operands: [a.operand],
        distance: distance('segment-length', vector(a.operand.start), vector(a.operand.end)),
      };
    }
    validateOperand(b.operand);
    if (a.key === b.key) {
      return null;
    }
    const rank = { point: 0, edge: 1, plane: 2 };
    const reversed = rank[a.operand.kind] > rank[b.operand.kind];
    const first = reversed ? b.operand : a.operand;
    const second = reversed ? a.operand : b.operand;
    const result: Extract<MeasurementEvidence, { kind: 'relation' }> = {
      kind: 'relation',
      operands: [a.operand, b.operand],
    };
    if (first.kind === 'point') {
      const p = vector(first.position);
      if (second.kind === 'point') {
        result.distance = distance('point-point', p, vector(second.position));
      } else if (second.kind === 'edge') {
        result.distance = distance('point-segment', p, segmentFoot(p, vector(second.start), vector(second.end)));
      } else {
        const normal = unit(vector(second.normal));
        const foot = p.clone().addScaledVector(normal, -p.clone().sub(vector(second.origin)).dot(normal));
        result.distance = distance('point-plane', p, foot, this.outside(second, foot));
      }
    } else if (first.kind === 'edge' && second.kind === 'edge') {
      const [p, q] = segmentWitnesses(vector(first.start), vector(first.end), vector(second.start), vector(second.end));
      result.distance = distance('segment-segment', p, q);
      const u = unit(vector(first.end).sub(vector(first.start)));
      const v = unit(vector(second.end).sub(vector(second.start)));
      const corner = measureEdgeCorner(first, second);
      if (corner) {
        result.distance = distance('segment-segment', vector(corner.vertex), vector(corner.vertex));
      }
      result.angle = {
        method: corner === undefined ? 'line-line' : 'edge-corner',
        unit: 'deg',
        value: corner?.value ?? (Math.atan2(u.clone().cross(v).length(), Math.abs(u.dot(v))) * 180) / Math.PI,
      };
    } else if (first.kind === 'edge' && second.kind === 'plane') {
      const u = unit(vector(first.end).sub(vector(first.start)));
      const n = unit(vector(second.normal));
      const sine = clamp(Math.abs(u.dot(n)));
      result.angle = {
        method: 'line-plane',
        unit: 'deg',
        value: sine <= MEASUREMENT_PARALLEL_TOLERANCE ? 0 : (Math.asin(sine) * 180) / Math.PI,
      };
      if (sine <= MEASUREMENT_PARALLEL_TOLERANCE) {
        const p = vector(first.start).add(vector(first.end)).multiplyScalar(0.5);
        const foot = p.clone().addScaledVector(n, -p.clone().sub(vector(second.origin)).dot(n));
        result.distance = distance('parallel-gap', p, foot, this.outside(second, foot));
      }
    } else if (first.kind === 'plane' && second.kind === 'plane') {
      const n = unit(vector(first.normal));
      const m = unit(vector(second.normal));
      const sine = n.clone().cross(m).length();
      result.angle = {
        method: 'plane-plane',
        unit: 'deg',
        value: sine <= MEASUREMENT_PARALLEL_TOLERANCE ? 0 : (Math.atan2(sine, Math.abs(n.dot(m))) * 180) / Math.PI,
      };
      if (sine <= MEASUREMENT_PARALLEL_TOLERANCE) {
        // Keep a height marker beside the smaller feature, not a remote corner
        // of a large reference face such as the base plate.
        const useSecond =
          (this.patchAreas.get(second.patchId) ?? Infinity) < (this.patchAreas.get(first.patchId) ?? Infinity);
        const p = useSecond
          ? vector(second.origin).addScaledVector(n, -vector(second.origin).sub(vector(first.origin)).dot(n))
          : vector(first.origin);
        const foot = useSecond
          ? vector(second.origin)
          : p.clone().addScaledVector(m, -p.clone().sub(vector(second.origin)).dot(m));
        result.distance = distance('parallel-gap', p, foot, this.outside(first, p) || this.outside(second, foot));
      }
    }
    if (reversed && result.distance) {
      [result.distance.start, result.distance.end] = [result.distance.end, result.distance.start];
    }
    return result;
  }
}
