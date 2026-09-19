# Examples

Each TypeScript snippet is a complete input for the selected host's validation
and execution tools. They illustrate geometry, not certified printing settings
or use safety. Adapt parameters to the [design brief](design-workflow.md) and
follow [verification and handoff](verification-and-handoff.md).
User annotations are optional; these examples do not require any marks.

## 1. Plain centred cube

```ts
result = Manifold.cube([20, 20, 20], true);
```

## 2. Cube minus sphere — the canonical CSG example

> Adapted from [manifold/bindings/wasm/documents/bindings.md](https://github.com/elalish/manifold/blob/master/bindings/wasm/documents/bindings.md)
> (Apache-2.0).

```ts
const { cube, sphere } = Manifold;
const box = cube([100, 100, 100], true);
const ball = sphere(60, 100);
result = box.subtract(ball);
```

## 3. Open box (separate wall and bottom thickness)

The outer envelope is 40 x 30 x 20 mm with its bottom at Z = 0. Side walls
are 1.6 mm thick and the floor is 2 mm thick. The cutter extends above the top
without changing the specified floor. It is an open container, not a sealed shell.

```ts
const wall = 1.6;
const bottom = 2;
const outerSize: [number, number, number] = [40, 30, 20];
const cutOvershoot = 0.5;
if (wall <= 0 || bottom <= 0 || bottom >= outerSize[2] || 2 * wall >= Math.min(outerSize[0], outerSize[1])) {
  throw new Error('wall and bottom must leave an open interior');
}
const innerSize: [number, number, number] = [
  outerSize[0] - 2 * wall,
  outerSize[1] - 2 * wall,
  outerSize[2] - bottom + cutOvershoot,
];

const outer = Manifold.cube(outerSize);
const cavity = Manifold.cube(innerSize).translate([wall, wall, bottom]);
result = outer.subtract(cavity);
```

## 4. Tube (extrude an annulus)

```ts
const ring = CrossSection.circle(10, 96).subtract(CrossSection.circle(8, 96));
result = Manifold.extrude(ring, 50);
```

## 5. Open vase (revolve a wall profile)

The profile includes an inner return path, an open mouth and a 3 mm floor.
`wall` is the radial separation at a given height, not constant thickness normal
to the sloping surface. Actual printing, cleanup and watertightness need separate
review; use a decorative purpose unless further requirements are established.

```ts
const wall = 2;
const bottom = 3;
const height = 90;
const baseRadius = 25;
const shoulderRadius = 22;
const neckRadius = 12;
const rimRadius = 16;
const shoulderHeight = 30;
const neckHeight = 60;
if (
  wall <= 0 ||
  wall >= Math.min(baseRadius, shoulderRadius, neckRadius, rimRadius) ||
  bottom <= 0 ||
  bottom >= shoulderHeight ||
  shoulderHeight >= neckHeight ||
  neckHeight >= height
) {
  throw new Error('profile dimensions must leave an open interior and ordered heights');
}
const innerBottomRadius = baseRadius + ((shoulderRadius - baseRadius) * bottom) / shoulderHeight - wall;
const profile = new CrossSection([
  [
    [0, 0],
    [baseRadius, 0],
    [shoulderRadius, shoulderHeight],
    [neckRadius, neckHeight],
    [rimRadius, height],
    [rimRadius - wall, height],
    [neckRadius - wall, neckHeight],
    [shoulderRadius - wall, shoulderHeight],
    [innerBottomRadius, bottom],
    [0, bottom],
  ],
]);
result = Manifold.revolve(profile, 96);
```

## 6. Rounded plate with cutouts

The finished envelope is 60 x 30 x 4 mm. Offset the smaller rectangle so the
corner radius does not enlarge those specified outer dimensions.

```ts
const width = 60;
const depth = 30;
const radius = 4;
const plate = CrossSection.square([width - 2 * radius, depth - 2 * radius], true).offset(radius, 'Round', 2, 32);

const holes = CrossSection.compose([
  CrossSection.circle(2, 32).translate([-22, 10]),
  CrossSection.circle(2, 32).translate([22, 10]),
  CrossSection.circle(2, 32).translate([-22, -10]),
  CrossSection.circle(2, 32).translate([22, -10]),
]);

result = Manifold.extrude(plate.subtract(holes), 4);
```

## 7. Stack of plates (loop + union)

```ts
const plates: Manifold[] = [];
for (let i = 0; i < 6; i++) {
  plates.push(Manifold.cube([20 - i * 2, 20 - i * 2, 2], true).translate([0, 0, i * 2]));
}
result = Manifold.union(plates);
```

## 8. Simple gyroid lattice (implicit surface)

> Note: `levelSet` cost grows fast; keep the bounds small and `edgeLength`
> generous, otherwise expect a `TIMEOUT`.

```ts
result = Manifold.levelSet(
  p => Math.cos(p[0]) * Math.sin(p[1]) + Math.cos(p[1]) * Math.sin(p[2]) + Math.cos(p[2]) * Math.sin(p[0]),
  { min: [-Math.PI, -Math.PI, -Math.PI], max: [Math.PI, Math.PI, Math.PI] },
  0.5,
);
```
