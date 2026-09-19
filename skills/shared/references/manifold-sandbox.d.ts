// =============================================================================
// AUTO-GENERATED — DO NOT EDIT
//
// Generated from: packages/modeling/src/sandbox/ambient-types.ts
// Regenerate via: npm run build:sandbox-types  (or npm run build)
//
// This file is the canonical ambient declaration for the sandbox. The
// runtime TypeScript compiler injects the same content into the in-memory
// program when validating snippets, so editors and CLI checks see the exact
// API surface that the runtime accepts.
// =============================================================================

type Vec2 = [number, number];
type Vec3 = [number, number, number];
/** 3x3 matrix stored in column-major order. */
type Mat3 = [number, number, number, number, number, number, number, number, number];
/** 4x4 matrix stored in column-major order. */
type Mat4 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
type Rect = { min: Vec2; max: Vec2 };
type Box = { min: Vec3; max: Vec3 };
type SimplePolygon = Vec2[];
type Polygons = SimplePolygon | SimplePolygon[];
type FillRule = 'EvenOdd' | 'NonZero' | 'Positive' | 'Negative';
type JoinType = 'Square' | 'Round' | 'Miter';
type Smoothness = { halfedge: number; smoothness: number };
type RayHit = { faceID: number; distance: number; position: Vec3; normal: Vec3 };
interface SealedUint32Array<N extends number> extends Uint32Array {
  readonly length: N;
}
interface SealedFloat32Array<N extends number> extends Float32Array {
  readonly length: N;
}
type ErrorStatus =
  | 'NoError'
  | 'NonFiniteVertex'
  | 'NotManifold'
  | 'VertexOutOfBounds'
  | 'PropertiesWrongLength'
  | 'MissingPositionProperties'
  | 'MergeVectorsDifferentLengths'
  | 'MergeIndexOutOfBounds'
  | 'TransformWrongLength'
  | 'RunIndexWrongLength'
  | 'FaceIDWrongLength'
  | 'InvalidConstruction'
  | 'ResultTooLarge'
  | 'InvalidTangents'
  | 'Cancelled';

interface Console {
  log(...data: unknown[]): void;
  info(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
}

// eslint-disable-next-line no-var
declare var console: Console;

interface MeshOptions {
  numProp: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  mergeFromVert?: Uint32Array;
  mergeToVert?: Uint32Array;
  runIndex?: Uint32Array;
  runOriginalID?: Uint32Array;
  runTransform?: Float32Array;
  faceID?: Uint32Array;
  halfedgeTangent?: Float32Array;
  tolerance?: number;
}

declare class Mesh {
  constructor(options: MeshOptions);
  readonly numProp: number;
  readonly vertProperties: Float32Array;
  readonly triVerts: Uint32Array;
  readonly mergeFromVert: Uint32Array;
  readonly mergeToVert: Uint32Array;
  readonly runIndex: Uint32Array;
  readonly runOriginalID: Uint32Array;
  readonly runTransform: Float32Array;
  readonly runFlags: Uint8Array;
  readonly faceID: Uint32Array;
  readonly halfedgeTangent: Float32Array;
  readonly tolerance: number;
  readonly numTri: number;
  readonly numVert: number;
  readonly numRun: number;

  merge(): boolean;
  verts(tri: number): SealedUint32Array<3>;
  position(vert: number): SealedFloat32Array<3>;
  extras(vert: number): Float32Array;
  tangent(halfedge: number): SealedFloat32Array<4>;
  transform(run: number): Mat4;
  backside(run: number): boolean;
  hasNormals(run: number): boolean;
}

declare class CrossSection {
  constructor(contours: Polygons, fillRule?: FillRule);

  static square(size?: Readonly<Vec2> | number, center?: boolean): CrossSection;
  static circle(radius: number, circularSegments?: number): CrossSection;
  static ofPolygons(contours: Polygons, fillRule?: FillRule): CrossSection;
  static union(a: CrossSection | Polygons, b: CrossSection | Polygons): CrossSection;
  static union(crossSections: readonly (CrossSection | Polygons)[]): CrossSection;
  static difference(a: CrossSection | Polygons, b: CrossSection | Polygons): CrossSection;
  static difference(crossSections: readonly (CrossSection | Polygons)[]): CrossSection;
  static intersection(a: CrossSection | Polygons, b: CrossSection | Polygons): CrossSection;
  static intersection(crossSections: readonly (CrossSection | Polygons)[]): CrossSection;
  static compose(parts: readonly (CrossSection | Polygons)[]): CrossSection;
  static hull(parts: readonly (CrossSection | Polygons)[]): CrossSection;

  add(other: CrossSection | Polygons): CrossSection;
  subtract(other: CrossSection | Polygons): CrossSection;
  intersect(other: CrossSection | Polygons): CrossSection;
  decompose(): CrossSection[];

  translate(v: Readonly<Vec2>): CrossSection;
  translate(x: number, y?: number): CrossSection;
  rotate(degrees: number): CrossSection;
  scale(v: Readonly<Vec2> | number): CrossSection;
  mirror(normal: Readonly<Vec2>): CrossSection;
  transform(m3: Mat3): CrossSection;
  warp(fn: (vert: Vec2) => void): CrossSection;

  offset(delta: number, joinType?: JoinType, miterLimit?: number, circularSegments?: number): CrossSection;
  hull(): CrossSection;
  simplify(epsilon?: number): CrossSection;

  area(): number;
  bounds(): Rect;
  toPolygons(): SimplePolygon[];
  isEmpty(): boolean;
  numContour(): number;
  numVert(): number;

  extrude(
    height: number,
    nDivisions?: number,
    twistDegrees?: number,
    scaleTop?: Readonly<Vec2> | number,
    center?: boolean,
  ): Manifold;
  revolve(circularSegments?: number, revolveDegrees?: number): Manifold;
}

declare class Manifold {
  constructor(mesh: Mesh);

  static cube(size?: Readonly<Vec3> | number, center?: boolean): Manifold;
  static sphere(radius: number, circularSegments?: number): Manifold;
  static cylinder(
    height: number,
    radiusLow: number,
    radiusHigh?: number,
    circularSegments?: number,
    center?: boolean,
  ): Manifold;
  static tetrahedron(): Manifold;
  static extrude(
    crossSection: CrossSection | Polygons,
    height: number,
    nDivisions?: number,
    twistDegrees?: number,
    scaleTop?: Readonly<Vec2> | number,
    center?: boolean,
  ): Manifold;
  static revolve(crossSection: CrossSection | Polygons, circularSegments?: number, revolveDegrees?: number): Manifold;
  static levelSet(
    sdf: (p: Vec3) => number,
    bounds: Box,
    edgeLength: number,
    level?: number,
    tolerance?: number,
  ): Manifold;
  static union(a: Manifold, b: Manifold): Manifold;
  static union(manifolds: readonly Manifold[]): Manifold;
  static difference(a: Manifold, b: Manifold): Manifold;
  static difference(manifolds: readonly Manifold[]): Manifold;
  static intersection(a: Manifold, b: Manifold): Manifold;
  static intersection(manifolds: readonly Manifold[]): Manifold;
  static compose(parts: readonly Manifold[]): Manifold;
  static hull(parts: readonly (Manifold | Vec3)[]): Manifold;
  static ofMesh(mesh: Mesh): Manifold;

  add(other: Manifold): Manifold;
  subtract(other: Manifold): Manifold;
  intersect(other: Manifold): Manifold;
  decompose(): Manifold[];

  translate(v: Readonly<Vec3>): Manifold;
  translate(x: number, y?: number, z?: number): Manifold;
  rotate(v: Readonly<Vec3>): Manifold;
  rotate(x: number, y?: number, z?: number): Manifold;
  scale(v: Readonly<Vec3> | number): Manifold;
  mirror(normal: Readonly<Vec3>): Manifold;
  transform(m4: Mat4): Manifold;
  warp(fn: (vert: Vec3) => void): Manifold;
  warpBatch(fn: (verts: Float64Array, count: number) => void): Manifold;

  trimByPlane(normal: Vec3, originOffset: number): Manifold;
  split(cutter: Manifold): [Manifold, Manifold];
  splitByPlane(normal: Vec3, originOffset: number): [Manifold, Manifold];
  slice(height: number): CrossSection;
  project(): CrossSection;

  refine(n: number): Manifold;
  refineToLength(maxEdgeLength: number): Manifold;
  refineToTolerance(tolerance: number): Manifold;
  static smooth(mesh: Mesh, sharpenedEdges?: readonly Smoothness[]): Manifold;
  smoothByNormals(normalIdx?: number): Manifold;
  smoothOut(minSharpAngle?: number, minSmoothness?: number): Manifold;
  simplify(tolerance?: number): Manifold;
  hull(): Manifold;
  minkowskiSum(other: Manifold): Manifold;
  minkowskiDifference(other: Manifold): Manifold;

  setProperties(numProp: number, propFunc: (newProps: number[], position: Vec3, oldProps: number[]) => void): Manifold;
  calculateCurvature(gaussianIdx: number, meanIdx: number): Manifold;
  calculateNormals(normalIdx?: number, minSharpAngle?: number): Manifold;

  numTri(): number;
  numVert(): number;
  numEdge(): number;
  numProp(): number;
  numPropVert(): number;
  volume(): number;
  surfaceArea(): number;
  genus(): number;
  boundingBox(): Box;
  isEmpty(): boolean;
  status(): ErrorStatus;
  tolerance(): number;
  setTolerance(tolerance: number): Manifold;
  minGap(other: Manifold, searchLength: number): number;
  rayCast(origin: Vec3, endpoint: Vec3): RayHit[];
  getMesh(normalIdx?: number): Mesh;

  asOriginal(): Manifold;
  originalID(): number;
}

declare let result: Manifold;
