/**
 * DSA Keycap Set — Full ANSI 108-key Layout
 * ==========================================
 *
 * A complete printable set of DSA-profile keycaps for a standard
 * ANSI 108-key keyboard (104 ANSI + 4 media keys above the numpad),
 * arranged at real keyboard spacing so you can preview the whole
 * board at once. Built with manifold-3d for the manifold3d-mcp sandbox
 * (see skills/use-manifold/).
 *
 * All dimensions are in **millimetres**.
 *
 * ----------------------------------------------------------------------
 * 1. Profile (DSA)
 * ----------------------------------------------------------------------
 *  - Uniform height across all rows: 7.4 mm.
 *  - Tapered shell from a rounded rectangular base (R1) to a smaller
 *    rounded rectangular top (R1.5). The taper is implemented as a
 *    `Manifold.hull()` between two thin extruded slabs.
 *  - 1 u footprint: 18.0 × 18.0 mm; key spacing 19.05 mm; gap 1.05 mm.
 *  - Top inset: base − 5.3 mm in each axis (so 1u top is 12.7 × 12.7).
 *
 * ----------------------------------------------------------------------
 * 2. Dish (concave top)
 * ----------------------------------------------------------------------
 *  Each key picks one of two dish shapes based on its top aspect ratio:
 *
 *    a) Near-square keys (long/short < SPHERE_RATIO_LIMIT, default 1.6)
 *       use a SPHERICAL dish whose radius is solved so the sphere just
 *       grazes all four corners of the top:
 *           R = (a² + h²) / (2 h)
 *       where a = top diagonal half-length, h = DISH_DEPTH (0.85 mm).
 *
 *    b) Elongated keys (Tab, Shift, Backspace, Enter, Space, Numpad +,
 *       Numpad Enter, Numpad 0, …) use a CYLINDRICAL dish along their
 *       long axis. The same formula picks the cylinder radius from the
 *       short-axis half-width, so the dish is uniform along the long
 *       direction (the way real DSA / XDA wide keys are made).
 *
 * ----------------------------------------------------------------------
 * 3. Cavity & MX stem
 * ----------------------------------------------------------------------
 *  - 1.5 mm wall thickness everywhere.
 *  - Cavity is a second hull (offset inward) subtracted from the shell;
 *    its bottom is pushed below z = 0 so the underside is a real opening
 *    (so resin/air can escape and a switch can plug in).
 *  - MX stem: 5.5 mm OD cylinder reaching from floor to underside of
 *    top, with a 1.17 × 4.10 mm cross slot 4 mm deep cut from the
 *    bottom (top of stem keeps ~1.4 mm of plastic for switch travel).
 *
 * ----------------------------------------------------------------------
 * 4. Layout (KLE-style)
 * ----------------------------------------------------------------------
 *  Standard ANSI 104 + 4 extra 1u media keys to the right of Pause:
 *
 *    F-row (20)  : Esc | F1-F4 | F5-F8 | F9-F12 | PrtSc ScrLk Pause | M M M M
 *    Number  (21): ` 1 … 0 - = | Backspace(2) | Ins Home PgUp | NumLk / * -
 *    QWERTY  (21): Tab(1.5) Q…] | \(1.5) | Del End PgDn | 7 8 9 | +(1×2)
 *    ASDF    (16): Caps(1.75) A…' | Enter(2.25) | 4 5 6
 *    ZXCV    (17): LShift(2.25) Z…/ | RShift(2.75) | ↑ | 1 2 3 | Enter(1×2)
 *    Bottom  (13): Ctrl Win Alt | Space(6.25) | Alt Win Menu Ctrl | ← ↓ → | 0(2u) .
 *
 *  Total: 20 + 21 + 21 + 16 + 17 + 13 = 108 keys.
 *
 * ----------------------------------------------------------------------
 * 5. Print notes
 * ----------------------------------------------------------------------
 *  - Bounding box ≈ 428 × 118 × 7.4 mm. That overflows most FDM build
 *    plates; in practice you will export the 3MF and split the keys
 *    across multiple plates in your slicer (or just pick the few keys
 *    you actually need each session).
 *  - Print orientation: open side DOWN on the build plate. The dished
 *    top prints upward and needs no supports.
 *  - PETG / ABS recommended; PLA works but warps under fingertip heat
 *    over time.
 */
// APIs: Manifold.cube, Manifold.cylinder, Manifold.sphere, Manifold.extrude, Manifold.hull, Manifold.union, subtract, translate, rotate, CrossSection.square, CrossSection.offset

const U = 19.05; // 1u key spacing
const GAP = 1.05; // physical gap so a 1u cap is ~18 mm wide
const TOP_INSET = 5.3; // base footprint − top footprint, both axes
const HEIGHT = 7.4; // overall keycap height
const BASE_R = 1.0; // bottom corner radius
const TOP_R = 1.5; // top corner radius
const WALL = 1.5; // outer wall thickness
const TOP_THICK = 2.0; // top slab thickness above the cavity
const DISH_DEPTH = 0.85; // central dish depth
const SHELL_SLAB = 0.4; // thickness of slabs that hull together
const CAVITY_OVERSHOOT = 0.5;
const STEM_OD = 5.5; // MX stem outer diameter
const STEM_DEPTH = 4.0; // depth of cross slot from the bottom of the stem
const CROSS_W = 1.17; // MX cross arm thickness
const CROSS_L = 4.1; // MX cross arm length
const SPHERE_RATIO_LIMIT = 1.6;

const roundedRect = (w: number, h: number, r: number, segs = 24): CrossSection => {
  const inner = Math.min(w, h) / 2 - 0.001;
  const rr = Math.max(0.05, Math.min(r, inner));
  return CrossSection.square([w - 2 * rr, h - 2 * rr], true).offset(rr, 'Round', 2, segs);
};

const makeKeycap = (uX: number, uY: number = 1): Manifold => {
  const baseX = uX * U - GAP;
  const baseY = uY * U - GAP;
  const topX = baseX - TOP_INSET;
  const topY = baseY - TOP_INSET;

  // Outer hull: bottom rounded slab → top rounded slab forms the tapered shell
  const baseSlab = Manifold.extrude(roundedRect(baseX, baseY, BASE_R), SHELL_SLAB);
  const topSlab = Manifold.extrude(roundedRect(topX, topY, TOP_R), SHELL_SLAB).translate([0, 0, HEIGHT - SHELL_SLAB]);
  let shell = Manifold.hull([baseSlab, topSlab]);

  // Dish: spherical for near-square tops, cylindrical along the long axis otherwise
  const h = DISH_DEPTH;
  const longRatio = Math.max(topX, topY) / Math.min(topX, topY);
  if (longRatio < SPHERE_RATIO_LIMIT) {
    const a = Math.hypot(topX / 2, topY / 2);
    const dishR = (a * a + h * h) / (2 * h);
    const segs = Math.min(96, Math.max(48, Math.round(dishR * 1.5)));
    shell = shell.subtract(Manifold.sphere(dishR, segs).translate([0, 0, HEIGHT + dishR - h]));
  } else if (topX >= topY) {
    // Cylinder axis along X → curvature along Y
    const a = topY / 2;
    const cylR = (a * a + h * h) / (2 * h);
    const segs = Math.min(96, Math.max(48, Math.round(cylR)));
    shell = shell.subtract(
      Manifold.cylinder(baseX + 4, cylR, cylR, segs, true)
        .rotate([0, 90, 0])
        .translate([0, 0, HEIGHT + cylR - h]),
    );
  } else {
    // Cylinder axis along Y → curvature along X
    const a = topX / 2;
    const cylR = (a * a + h * h) / (2 * h);
    const segs = Math.min(96, Math.max(48, Math.round(cylR)));
    shell = shell.subtract(
      Manifold.cylinder(baseY + 4, cylR, cylR, segs, true)
        .rotate([90, 0, 0])
        .translate([0, 0, HEIGHT + cylR - h]),
    );
  }

  // Hollow interior; the inner bottom slab is pushed below z=0 so the underside is open
  const innerHeight = HEIGHT - TOP_THICK;
  const innerBaseSlab = Manifold.extrude(roundedRect(baseX - 2 * WALL, baseY - 2 * WALL, BASE_R), SHELL_SLAB).translate(
    [0, 0, -CAVITY_OVERSHOOT],
  );
  const innerTopSlab = Manifold.extrude(roundedRect(topX - 2 * WALL, topY - 2 * WALL, TOP_R), SHELL_SLAB).translate([
    0,
    0,
    innerHeight - SHELL_SLAB,
  ]);
  const cavity = Manifold.hull([innerBaseSlab, innerTopSlab]);
  shell = shell.subtract(cavity);

  // MX cross stem
  const stemHeight = innerHeight + 0.2;
  const stemOuter = Manifold.cylinder(stemHeight, STEM_OD / 2, STEM_OD / 2, 32, false);
  const crossA = Manifold.cube([CROSS_L, CROSS_W, STEM_DEPTH + 0.5], true).translate([0, 0, STEM_DEPTH / 2 - 0.25]);
  const crossB = Manifold.cube([CROSS_W, CROSS_L, STEM_DEPTH + 0.5], true).translate([0, 0, STEM_DEPTH / 2 - 0.25]);
  const stem = stemOuter.subtract(Manifold.union(crossA, crossB));

  return Manifold.union(shell, stem);
};

// KLE-style layout: [col, row, w, d] in unit grid (col=x, row=y from top)
type KeySpec = readonly [number, number, number, number];
const layout: KeySpec[] = [
  // Row 0 — F-row + 4 media extras
  [0, 0, 1, 1],
  [2, 0, 1, 1],
  [3, 0, 1, 1],
  [4, 0, 1, 1],
  [5, 0, 1, 1],
  [6.5, 0, 1, 1],
  [7.5, 0, 1, 1],
  [8.5, 0, 1, 1],
  [9.5, 0, 1, 1],
  [11, 0, 1, 1],
  [12, 0, 1, 1],
  [13, 0, 1, 1],
  [14, 0, 1, 1],
  [15.25, 0, 1, 1],
  [16.25, 0, 1, 1],
  [17.25, 0, 1, 1],
  [18.5, 0, 1, 1],
  [19.5, 0, 1, 1],
  [20.5, 0, 1, 1],
  [21.5, 0, 1, 1],
  // Row 1 — number row + nav + numpad top
  [0, 1.25, 1, 1],
  [1, 1.25, 1, 1],
  [2, 1.25, 1, 1],
  [3, 1.25, 1, 1],
  [4, 1.25, 1, 1],
  [5, 1.25, 1, 1],
  [6, 1.25, 1, 1],
  [7, 1.25, 1, 1],
  [8, 1.25, 1, 1],
  [9, 1.25, 1, 1],
  [10, 1.25, 1, 1],
  [11, 1.25, 1, 1],
  [12, 1.25, 1, 1],
  [13, 1.25, 2, 1], // Backspace
  [15.25, 1.25, 1, 1],
  [16.25, 1.25, 1, 1],
  [17.25, 1.25, 1, 1],
  [18.5, 1.25, 1, 1],
  [19.5, 1.25, 1, 1],
  [20.5, 1.25, 1, 1],
  [21.5, 1.25, 1, 1],
  // Row 2 — QWERTY
  [0, 2.25, 1.5, 1], // Tab
  [1.5, 2.25, 1, 1],
  [2.5, 2.25, 1, 1],
  [3.5, 2.25, 1, 1],
  [4.5, 2.25, 1, 1],
  [5.5, 2.25, 1, 1],
  [6.5, 2.25, 1, 1],
  [7.5, 2.25, 1, 1],
  [8.5, 2.25, 1, 1],
  [9.5, 2.25, 1, 1],
  [10.5, 2.25, 1, 1],
  [11.5, 2.25, 1, 1],
  [12.5, 2.25, 1, 1],
  [13.5, 2.25, 1.5, 1], // backslash
  [15.25, 2.25, 1, 1],
  [16.25, 2.25, 1, 1],
  [17.25, 2.25, 1, 1],
  [18.5, 2.25, 1, 1],
  [19.5, 2.25, 1, 1],
  [20.5, 2.25, 1, 1],
  [21.5, 2.25, 1, 2], // Numpad +
  // Row 3 — ASDF
  [0, 3.25, 1.75, 1], // Caps
  [1.75, 3.25, 1, 1],
  [2.75, 3.25, 1, 1],
  [3.75, 3.25, 1, 1],
  [4.75, 3.25, 1, 1],
  [5.75, 3.25, 1, 1],
  [6.75, 3.25, 1, 1],
  [7.75, 3.25, 1, 1],
  [8.75, 3.25, 1, 1],
  [9.75, 3.25, 1, 1],
  [10.75, 3.25, 1, 1],
  [11.75, 3.25, 1, 1],
  [12.75, 3.25, 2.25, 1], // Enter
  [18.5, 3.25, 1, 1],
  [19.5, 3.25, 1, 1],
  [20.5, 3.25, 1, 1],
  // Row 4 — ZXCV
  [0, 4.25, 2.25, 1], // LShift
  [2.25, 4.25, 1, 1],
  [3.25, 4.25, 1, 1],
  [4.25, 4.25, 1, 1],
  [5.25, 4.25, 1, 1],
  [6.25, 4.25, 1, 1],
  [7.25, 4.25, 1, 1],
  [8.25, 4.25, 1, 1],
  [9.25, 4.25, 1, 1],
  [10.25, 4.25, 1, 1],
  [11.25, 4.25, 1, 1],
  [12.25, 4.25, 2.75, 1], // RShift
  [16.25, 4.25, 1, 1], // Up arrow
  [18.5, 4.25, 1, 1],
  [19.5, 4.25, 1, 1],
  [20.5, 4.25, 1, 1],
  [21.5, 4.25, 1, 2], // Numpad Enter
  // Row 5 — bottom row
  [0, 5.25, 1.25, 1],
  [1.25, 5.25, 1.25, 1],
  [2.5, 5.25, 1.25, 1],
  [3.75, 5.25, 6.25, 1], // Space
  [10, 5.25, 1.25, 1],
  [11.25, 5.25, 1.25, 1],
  [12.5, 5.25, 1.25, 1],
  [13.75, 5.25, 1.25, 1],
  [15.25, 5.25, 1, 1],
  [16.25, 5.25, 1, 1],
  [17.25, 5.25, 1, 1],
  [18.5, 5.25, 2, 1], // Numpad 0
  [20.5, 5.25, 1, 1], // Numpad .
];

const caps: Manifold[] = [];
for (const [col, row, w, d] of layout) {
  const cap = makeKeycap(w, d);
  const cx = (col + w / 2) * U;
  const cy = -(row + d / 2) * U;
  caps.push(cap.translate([cx, cy, 0]));
}

result = Manifold.union(...caps);
