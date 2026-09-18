# Script Conventions

Hard rules for TypeScript snippets in either host's validation/execution tools.
Both accept inline `code`; only MCP also accepts an authorized absolute `filePath`. The
static lint (`stage: static`) enforces sandbox rules, the TypeScript
typecheck/compile stage (`stage: typecheck`) catches API shape mistakes, and the
runner enforces runtime limits.

## Required

- **Assign to the ambient `result` variable. Do not redeclare it.**
  `result` is already declared by the sandbox — `let result`, `const result`,
  and `var result` are all rejected at typecheck with
  `TS2451: Cannot redeclare block-scoped variable 'result'`. Just assign:

  ```ts
  // Correct — assign the ambient global.
  result = Manifold.cube([10, 10, 10]);

  // Wrong — typecheck error TS2451, runtime never executes.
  // const result = Manifold.cube([10, 10, 10]);
  // let result = Manifold.cube([10, 10, 10]);
  ```

  Failure to assign at all → `RESULT_NOT_ASSIGNED`.

  `result` is typed as `Manifold`, so the compiler also rejects common
  near-misses:

  ```ts
  const profile = CrossSection.circle(10, 64);
  // Wrong: result must be a 3D Manifold, not a 2D CrossSection.
  // result = profile;

  // Correct:
  result = profile.extrude(4);
  ```

  For reusable helpers, type intermediate values and then assign the final
  `Manifold`:

  ```ts
  const makePost = (height: number, radius: number): Manifold => Manifold.cylinder(height, radius, radius, 32, true);

  const post: Manifold = makePost(20, 3);
  result = post;
  ```

- **Stay under 64 KB of source.** Failure → `CODE_TOO_LARGE`.

## Globals available

| Name           | What it is                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Manifold`     | The manifold-3d `Manifold` class with all static methods (`cube`, `sphere`, `cylinder`, `extrude`, `revolve`, `union`, `difference`, `intersection`, `compose`, `levelSet`, `smooth`, `ofMesh`, `hull`, `tetrahedron`, …) |
| `CrossSection` | The 2D class for sketches that you `extrude` / `revolve`                                                                                                                                                                  |
| `Mesh`         | The low-level mesh container (used by `Manifold.ofMesh`)                                                                                                                                                                  |
| `console`      | `log` / `warn` / `error` / `info`; output is forwarded to the server's stderr (the user does not see it)                                                                                                                  |
| `result`       | The required output slot. Assign a `Manifold` here before the snippet finishes.                                                                                                                                           |

Standard JavaScript built-ins (`Math`, `Array`, `Map`, `Set`, `JSON`, …) are
available. Promises and `setTimeout` are technically reachable but are useless
here — the sandbox runs synchronously and ignores microtasks scheduled by your
script after `result` is assigned.

## TypeScript typecheck

Snippets are compiled as TypeScript before runtime. The compiler catches wrong
method names, impossible argument shapes, and many tuple/array mistakes before
the worker runs. For example, `Manifold.cylinder({ height: 12, radiusLow: 4 })`
is rejected because constructors use positional arguments.

If a variable is reused as a vector, give it a tuple type so it matches the
Manifold declarations:

```ts
const size: [number, number, number] = [40, 30, 20];
result = Manifold.cube(size, true);
```

Under strict TypeScript, array indexing can be `T | undefined`. Check the value
before assigning it to `result` or passing it to geometry APIs:

```ts
const parts: Manifold[] = [Manifold.cube(10)];
const first = parts[0];
if (!first) {
  throw new Error('expected at least one part');
}
result = first;
```

## Forbidden

The static lint rejects any reference to:

`require`, `import`, `export`, `process`, `globalThis`, `eval`, `Function`,
`fs`, `child_process`, `worker_threads`, `http`, `https`, `net`, `dgram`,
`tls`, `os`, `cluster`, `__dirname`, `__filename`, `Buffer`.

Note: `import` / `export` are blocked as syntax forms (AST) rather than as
identifier references.

If you reach for any of these you are doing something this sandbox does not
support — describe what you actually want and let the user decide.

## Units

The sandbox interprets all coordinates as **millimetres**. `Export 3MF`
records that unit explicitly, while `Export GLB` converts the same physical
dimensions to glTF metres. Manifold itself has no unit system, so the modeling
unit is a convention surfaced as a report hint. Confirm the intended physical
size when importing into a slicer or another viewer.

## Limits

- **Wall-clock timeout: 5 seconds.** Any longer and the worker is killed
  (`TIMEOUT`). High-segment spheres or deep recursive `compose` calls are the
  usual cause.
- **512 MB heap limit** (V8 `maxOldGenerationSizeMb`). Crossing it kills the
  worker with `OUT_OF_MEMORY`.
- **Triangle budget warning: 500 000.** Above this the report adds a
  `TRIANGLE_BUDGET` warning; the model still renders and exports, but the
  slicer experience will suffer.
- **Bounding box sanity:** any dimension < 0.1 mm or > 500 mm earns a
  `BBOX_TOO_SMALL` / `BBOX_TOO_LARGE` warning. Check intended dimensions, units
  and the selected machine's envelope; these are not that machine's limits and
  are not a reason to resize a confirmed part automatically.

## Clean booleans (avoiding marginal geometry)

Near-coincident boundaries can make a construction sensitive to rounding or
placement errors. If an intended connection or cut is wrong, inspect operands
and dimensions first. Shared faces do not by themselves prove a failed union.
Where appropriate, use a small **volumetric** overlap or extend a cutter beyond
the finished part, without changing its intended boundaries:

- **Extend an attached primitive into existing material.** Here the extra
  0.5 mm is a construction choice for this example, not a universal tolerance.
  Increasing the wall's height by the amount sunk preserves its intended top:

  ```ts
  const overlap = 0.5;
  const wall = Manifold.cube([60, 4, 20 + overlap], false).translate([0, 0, baseThickness - overlap]); // sinks 0.5 mm into base
  result = base.add(wall);
  ```

- **Extend through-cutters outside the part.** This example overshoots by 1 mm
  at each end while preserving the hole radius. Do not use this technique to
  increase the specified depth of a blind hole:

  ```ts
  const overshoot = 1;
  const drill = Manifold.cylinder(plateThickness + 2 * overshoot, 3, 3, 48, true).translate([0, 0, plateThickness / 2]);
  result = plate.subtract(drill);
  ```

Interpret topology against the intended components and cavities; `genus: -1`
alone does not diagnose a bad joint or exactly two separate manufactured parts.
Check placement, connectivity and local sections rather than adding overlap
blindly. Never fill an intentional assembly gap to make a statistic look better.

Keep construction overlap separate from design clearance and process compensation.
Choose it for the local geometry and recheck finished dimensions afterward.

## Tilted / leaning solids — `Manifold.hull` over rotated vertices

For a non-orthogonal solid (a leaning panel, a wedge, a buttress), the
cleanest construction is to compute the 8 (or N) tilted corner vertices
yourself and `Manifold.hull` them:

```ts
const tilt = 25; // degrees from vertical
const c = Math.cos((tilt * Math.PI) / 180);
const s = Math.sin((tilt * Math.PI) / 180);
const t = 6,
  h = 95; // panel thickness, height
const hingeY = 16,
  hingeZ = 5.5; // attachment point on the base
const xL = -47.5,
  xR = 47.5;

const corners: Array<[number, number, number]> = [
  [xL, hingeY, hingeZ],
  [xR, hingeY, hingeZ],
  [xL, hingeY + t * c, hingeZ + t * s],
  [xR, hingeY + t * c, hingeZ + t * s],
  [xL, hingeY + t * c + h * s, hingeZ + t * s + h * c],
  [xR, hingeY + t * c + h * s, hingeZ + t * s + h * c],
  [xL, hingeY + h * s, hingeZ + h * c],
  [xR, hingeY + h * s, hingeZ + h * c],
];
const panel = Manifold.hull(corners);
```

This is more reliable than `Manifold.cube(...).rotate(...).trimByPlane(...)`
because you don't have to remember the half-space sign convention of
`trimByPlane` (the half-space _kept_ is the one whose dot product with the
normal is ≥ `originOffset`; getting this wrong silently truncates the model
and `ok: true` does not warn). When in doubt, hull a vertex set you can
verify by hand.

## Common wrong assumptions

- There is no `Manifold.box`; use `Manifold.cube(size, center)`.
- Factory methods use positional arguments. Do not call
  `Manifold.cylinder({ height, radiusLow })`; call
  `Manifold.cylinder(height, radiusLow, radiusHigh, segments, center)`.
- `cylinder` takes radii, not diameters.
- `rotate(...)` takes degrees, not radians. Avoid `Math.PI` in rotate calls.
- There is no `CrossSection.roundedRectangle`; use
  `CrossSection.square([w - 2*r, h - 2*r], true).offset(r, 'Round', 2, segments)`.
- The polygon helper is `CrossSection.ofPolygons`, not `ofPolygon`.
- For default `CrossSection.ofPolygons(..., 'Positive')`, use
  counter-clockwise outer rings and clockwise holes.

## Common TypeScript diagnostics

| TS code         | Common cause                                                           | Typical fix                                                                                         |
| --------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `2339`          | Unknown API such as `Manifold.box` or `CrossSection.roundedRectangle`. | Use the supported method or documented recipe. Static warnings often include the exact replacement. |
| `2554`          | Wrong argument count, often from options-object constructor calls.     | Use positional signatures from `manifold-api.md`.                                                   |
| `2740`          | A `CrossSection` was assigned where a `Manifold` is required.          | Extrude or revolve the 2D profile before assigning `result`.                                        |
| `2322` / `2769` | Tuple/vector mismatch or `Manifold \| undefined`.                      | Add tuple annotations and guard array/map lookups before use.                                       |
