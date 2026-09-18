# Tips and Tricks

> Source: [manifold/bindings/wasm/documents/tips.md](https://github.com/elalish/manifold/blob/master/bindings/wasm/documents/tips.md)
> (Apache-2.0). Adapted for the managed sandbox and its immutable transform API.

## Handling Precision Issues

Near-coincident boundaries deserve care, but a tiny floating-point difference
or a shared face alone does not prove that a boolean will fail. Inspect the actual
result and operands. Use consistent derived dimensions, and when needed extend
unions or cutters as described in
[clean booleans](script-conventions.md#clean-booleans-avoiding-marginal-geometry).
Preserve the intended finished boundaries.

Do not round every intermediate coordinate: this can move interfaces, erase small
features or change a rotation. Larger integer-friendly coordinates are not a
universal repair either. If using an internal scale for a particular calculation,
scale **all relevant lengths** consistently and restore millimetres before output.
This example illustrates reversible scaling, not a print-ready feature size:

```ts
const scale = 1000;

const size = 0.1 * scale;
const offset = 0.2 * scale;

const { cube } = Manifold;
result = cube([size, size, size])
  .translate([offset, offset, offset])
  .scale(1 / scale);
```

See [discussion #1135](https://github.com/elalish/manifold/discussions/1135)
for context on precision issues. Numeric construction precision, mesh faceting,
and as-printed dimensional accuracy are different concerns. Increasing triangle
count or changing internal units does not establish a printer's tolerance.

## Degrees vs. Radians

Manifold's rotation API takes **degrees**, not radians. This is a deliberate
design choice: Manifold can eliminate floating point error entirely for
multiples of 90° and uses more efficient code paths when it detects such
rotations.

Transforms return new instances; keep the return value rather than expecting
the original object to change. Assign the final solid to the predeclared `result`.

```ts
// Pass degrees directly
const box = Manifold.cube([10, 20, 30], true);
result = box.rotate([90, 0, 0]).rotate([0, 45, 0]);
```

If your own code works in radians (e.g. when using `Math.atan2`), convert to
degrees before passing to Manifold:

```ts
const x = 1;
const y = 1;
const box = Manifold.cube([10, 20, 30], true);
const toDeg = (rad: number): number => rad * (180 / Math.PI);
const angle = Math.atan2(y, x); // radians
result = box.rotate([0, 0, toDeg(angle)]);
```

For common angles, always prefer the exact degree value (`90`, `45`, `30`,
etc.) over a computed approximation to get the precision guarantee. See
[issue #1262](https://github.com/elalish/manifold/issues/1262) for a
real-world example where a rotation of `-89.999999999999` instead of `-90`
caused mesh cracks.
