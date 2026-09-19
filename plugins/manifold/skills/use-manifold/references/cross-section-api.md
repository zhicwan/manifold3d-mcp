# CrossSection API (2D building blocks)

> Source: [manifold/bindings/wasm/manifold-encapsulated-types.d.ts](https://github.com/elalish/manifold/blob/master/bindings/wasm/manifold-encapsulated-types.d.ts)
> (Apache-2.0).

`CrossSection` represents a set of non-self-intersecting 2D polygons. You build
or import a CrossSection, optionally combine and offset it, then turn it into
a `Manifold` via `Manifold.extrude(...)` or `Manifold.revolve(...)`.

## Static constructors

```ts
CrossSection.square(size: Vec2 | number = [1,1], center?: boolean): CrossSection
CrossSection.circle(radius: number, circularSegments?: number): CrossSection
CrossSection.ofPolygons(contours: Polygons, fillRule?: FillRule): CrossSection

// Booleans
CrossSection.union(a: CrossSection | Polygons, b: CrossSection | Polygons): CrossSection
CrossSection.union(c: readonly (CrossSection | Polygons)[]): CrossSection
CrossSection.difference(a: CrossSection | Polygons, b: CrossSection | Polygons): CrossSection
CrossSection.difference(c: readonly (CrossSection | Polygons)[]): CrossSection
CrossSection.intersection(a: CrossSection | Polygons, b: CrossSection | Polygons): CrossSection
CrossSection.intersection(c: readonly (CrossSection | Polygons)[]): CrossSection
CrossSection.compose(parts: readonly (CrossSection | Polygons)[]): CrossSection
CrossSection.hull(parts: readonly (CrossSection | Polygons)[]): CrossSection
```

`SimplePolygon` = `Vec2[]`; `Polygons` accepts either one contour or an array
of contours. For a complex polygon, the first ring is the outer boundary and
additional rings are holes (CCW outer, CW holes is the safest convention).

When using the default `'Positive'` fill rule, keep outer contours
counter-clockwise and holes clockwise. If a simple `ofPolygons` profile reports
`INVALID_CONSTRUCTION`, validate that profile by itself and try reversing the
outer point order before debugging unrelated booleans.

## Constructor

```ts
new CrossSection(contours: Polygons, fillRule?: FillRule)
```

`FillRule` is `'EvenOdd' | 'NonZero' | 'Positive' | 'Negative'` (default
`'Positive'`).

## Booleans (instance form)

```ts
c.add(other: CrossSection | Polygons): CrossSection
c.subtract(other: CrossSection | Polygons): CrossSection
c.intersect(other: CrossSection | Polygons): CrossSection
```

## Transforms

```ts
c.translate(v: Vec2): CrossSection
c.translate(x: number, y?: number): CrossSection
c.rotate(degrees: number): CrossSection
c.scale(v: Vec2 | number): CrossSection
c.mirror(normal: Vec2): CrossSection
c.transform(m3: Mat3): CrossSection
c.warp(fn: (vert: Vec2) => void): CrossSection
```

## Offset / hull / simplify

```ts
c.offset(delta: number,
         joinType?: JoinType,           // 'Square' | 'Round' | 'Miter'
         miterLimit?: number,
         circularSegments?: number): CrossSection
c.hull(): CrossSection
c.simplify(epsilon?: number): CrossSection
```

## Measurements and polygon output

```ts
c.area(): number
c.bounds(): Rect
c.toPolygons(): SimplePolygon[]
c.isEmpty(): boolean
c.numContour(): number
c.numVert(): number
```

## Going from 2D to 3D

```ts
Manifold.extrude(c, height,
                 nDivisions?, twistDegrees?, scaleTop?, center?): Manifold
Manifold.revolve(c, circularSegments?, revolveDegrees?): Manifold
```

`extrude` is the workhorse for prismatic shapes; `revolve` produces lathes.
Both forms below are valid:

```ts
const profile = CrossSection.circle(10, 64);
const a = Manifold.extrude(profile, 4);
const b = profile.extrude(4);
```

## Idioms

There is no `CrossSection.roundedRectangle(...)` helper. Build rounded
rectangles by offsetting a smaller square. This preserves the specified outer
width and height rather than expanding each by twice the radius:

```ts
const w = 60;
const h = 30;
const r = 4;
const rounded = CrossSection.square([w - 2 * r, h - 2 * r], true).offset(r, 'Round', 2, 32);
result = Manifold.extrude(rounded, 4);
```

```ts
// Pipe = annulus extruded.
const ring = CrossSection.circle(10, 64).subtract(CrossSection.circle(8, 64));
result = Manifold.extrude(ring, 50);
```

For a hollow revolved container, the section must include the inner wall and
floor, not just the outer silhouette closed to the axis. See the
[open-vase example](examples.md#5-open-vase-revolve-a-wall-profile).
