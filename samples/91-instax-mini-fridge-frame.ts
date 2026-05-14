/**
 * Instax Mini Polaroid Fridge-Magnet Frame
 * =========================================
 *
 * A two-piece, snap-together photo frame designed to hold an Instax Mini
 * print and stick to a steel fridge door. Built with manifold-3d and
 * intended to be run inside the manifold-mcp sandbox (see
 * skills/use-manifold/).
 *
 * All dimensions are in **millimetres**.
 *
 * ----------------------------------------------------------------------
 * 1. Photo geometry (Instax Mini)
 * ----------------------------------------------------------------------
 *  - Paper outer:       54 × 86  (portrait)
 *  - Visible image:     46 × 62
 *  - Image is *not* centered on the paper: it sits ~7.5 mm above the
 *    paper's geometric center because the developer pod adds ~15 mm of
 *    extra white border at the bottom edge.
 *  - We bite 0.5 mm into each edge of the image so the front lip cleanly
 *    covers the printed boundary → window = 45 × 61.
 *
 * ----------------------------------------------------------------------
 * 2. Frame architecture
 * ----------------------------------------------------------------------
 *  Two parts that bond together with a thin film of CA / UHU glue.
 *
 *  Front lid (printed window-face DOWN, cavity opening UP):
 *    - 56.9 × 88.9 outer, 2.8 mm thick.
 *    - Outer R2 corner fillet.
 *    - 1.2 mm perimeter wall on three sides; +Y short edge is open as
 *      the photo insertion slot.
 *    - Internal cavity 54.5 × 86.5 × 1.8 mm.
 *    - 1 mm front face with a 45 × 61 R2 window, shifted 4 mm toward
 *      the bottom of the photo (= toward -Y).
 *
 *  Back plate (printed flat, mating face UP, magnet pockets open UP):
 *    - 56.9 × 88.9 outer, 2.4 mm thick + 0.8 mm rim on top.
 *    - Outer R2 corner fillet.
 *    - 0.4 mm bottom seal (the suction face that touches the fridge).
 *    - 4 × Ø6.3 × 2.0 mm cylindrical pockets, open at the top of the
 *      plate. Magnets drop in after printing — no print pause needed.
 *    - U-shaped retention rim (1.2 mm wide × 0.8 mm tall) on three sides
 *      that nests into the front cavity (0.3 mm slip fit per side) and
 *      acts as the ledge the photo rests on.
 *    - 4 mm long entry chamfer on the +Y end of the rim's two side
 *      walls so the photo glides in without snagging.
 *
 *  Assembled total thickness: 5.2 mm.
 *
 * ----------------------------------------------------------------------
 * 3. Why this design
 * ----------------------------------------------------------------------
 *  Magnet retention strategy
 *    Earlier prototype had pockets opening on the *fridge* side. The
 *    fridge attracted the magnet harder than the (near-zero) friction
 *    fit, so peeling the frame off the door pulled the magnets out.
 *    Flipping the pocket so it opens on the *cavity* side fixes this:
 *      - The magnet is permanently trapped behind the 0.4 mm bottom
 *        seal — it cannot escape toward the fridge.
 *      - When you remove the frame, the bottom seal lifts the magnet
 *        with the rest of the part. There is no force pulling the
 *        magnet upward (the cavity above is empty) so it stays put.
 *
 *  Why no glue, no print-pause
 *    Pockets sized Ø6.3 nominal for a Ø6 magnet — about 0.3 mm of
 *    designed clearance. With a 0.4 mm nozzle the printed hole tends
 *    to be undersize by ~0.1–0.2 mm, leaving a slip fit instead of a
 *    press fit. The bottom seal blocks the magnet, so no glue is
 *    required. Printing is a single uninterrupted job.
 *
 *  Why the U-rim instead of pegs / pins
 *    1 mm pegs on a 1.2 mm wall break with FDM tolerances. A continuous
 *    rim is fully self-locating, has no small features, prints flat,
 *    and is forgiving to the 0.3 mm slip fit.
 *
 *  Why the +Y end of the rim is chamfered
 *    The photo enters from the +Y short edge. Without the chamfer the
 *    leading edge of the photo would catch on the 0.8 mm vertical rim
 *    wall. The 4 mm ramp turns that into a smooth lead-in.
 *
 * ----------------------------------------------------------------------
 * 4. Print recommendations (PLA, 0.4 mm nozzle)
 * ----------------------------------------------------------------------
 *  - Layer height:    0.2 mm
 *  - Perimeters:      3 (= 1.2 mm wall is exactly 3 lines)
 *  - Top/bottom:      4 / 4
 *  - Infill:          15 % gyroid is plenty; the part is mostly walls.
 *  - Supports:        none for either part.
 *  - Orientation:
 *      Front lid : window face DOWN on the bed (cavity opens upward).
 *      Back plate: bottom (suction) face DOWN on the bed. Pockets and
 *                  rim point upward.
 *  - Brim only if first-layer adhesion is suspect.
 *
 *  Magnet assembly (no print pause needed):
 *      1. Stack all 4 magnets into a column on the bench. Mark the face
 *         that ends up "down" on every magnet — keep that face down for
 *         all 4 when dropping into the pockets so polarity is uniform.
 *      2. Lay the printed back plate flat (rim up).
 *      3. Drop one magnet into each of the 4 pockets.
 *      4. Apply a thin film of glue along the top of the rim and on the
 *         four corner pads where the front lid will land.
 *      5. Place the front lid; clamp lightly until the glue sets.
 *      6. Slide the photo in through the +Y slot.
 *
 * ----------------------------------------------------------------------
 * 5. Tunable parameters
 * ----------------------------------------------------------------------
 *  Edit the constants at the top of the model section to retarget the
 *  design for a different photo format, magnet size, or fit:
 *    - photoW / photoH / photoClearance — change for non-Instax film.
 *    - imageW / imageH / imageOffsetY   — change the visible window.
 *    - magnetD / magnetT / magnetClearance / magnetBottomSeal —
 *      retarget for different magnets or stronger / weaker bottom seal.
 *    - rimSlip — increase to 0.4 if your printer runs hot or oversized.
 *
 * ----------------------------------------------------------------------
 * 6. How to render
 * ----------------------------------------------------------------------
 *  This file is the body of an `execute_script` call. To
 *  preview it interactively:
 *    1. Have the manifold-mcp server running locally.
 *    2. Open Copilot CLI and ask it to run this file with that tool, or
 *       paste the contents into the sandbox playground.
 *  The script assigns the final composite (back + front, laid out side
 *  by side for inspection) to `result`.
 *
 *  For printing, render each part on its own by replacing the final
 *  `result = backShown.add(frontShown);` with `result = back;` or
 *  `result = front;` and exporting STL / 3MF.
 */
// APIs: Manifold.cube, Manifold.cylinder, Manifold.extrude, subtract, translate, rotate, add, CrossSection.square, CrossSection.ofPolygons, CrossSection.offset

// ============================================================
// Photo (Instax Mini, portrait)
// ============================================================
const photoW = 54; // paper short side
const photoH = 86; // paper long side
const photoClearance = 0.5; // total slip in cavity (per axis)
const imageW = 45; // visible window width  (image - 0.5/edge)
const imageH = 61; // visible window height
const imageOffsetY = 4.0; // window center offset from paper center (toward bottom)
const windowFillet = 2; // window corner radius

// ============================================================
// Frame walls / lid
// ============================================================
const wall = 1.2; // perimeter wall thickness (3 perimeters @ 0.4)
const lipFront = 1; // front face thickness
const photoT = 1.0; // photo cavity height for the photo itself
const fillet = 2; // outer corner radius

// ============================================================
// Retention rim (sits on back plate, nests into front cavity)
// ============================================================
const rimH = 0.8; // rim height (4 layers @ 0.2)
const rimW = 1.2; // rim wall thickness
const rimSlip = 0.3; // clearance per side between rim and front cavity wall
const rimChamferLen = 4; // length of lead-in ramp on +Y end

// ============================================================
// Magnets
// ============================================================
const magnetD = 6; // magnet diameter
const magnetT = 2; // magnet thickness
const magnetClearance = 0.3; // pocket diameter clearance (Ø6.3 design)
const magnetInset = 7.5; // pocket center offset from outer corner
const magnetBottomSeal = 0.4; // plastic between magnet and fridge

// ============================================================
// Derived geometry
// ============================================================
const cavityT = photoT + rimH; // 1.8
const backT = magnetBottomSeal + magnetT; // 2.4
const cavityW = photoW + photoClearance; // 54.5
const cavityH = photoH + photoClearance; // 86.5
const outerW = cavityW + 2 * wall; // 56.9
const outerH = cavityH + 2 * wall; // 88.9

const eps = 0.01;

// ============================================================
// Helpers
// ============================================================
function roundRect(w: number, h: number, r: number, segs = 64): CrossSection {
  if (r <= 0) {
    return CrossSection.square([w, h], true);
  }
  const inner = CrossSection.square([w - 2 * r, h - 2 * r], true);
  return inner.offset(r, 'Round', 2.0, segs);
}

const outerProfile = roundRect(outerW, outerH, fillet);

// ============================================================
// FRONT LID
//   - Outer shell with 1.2 mm wall on three sides
//   - +Y short edge is OPEN as the photo insertion slot
//   - Cavity 54.5 × 86.5 × 1.8 carved from below
//   - Rounded rectangular window in the front face
// ============================================================
const frontHeight = lipFront + cavityT;
let front = outerProfile.extrude(frontHeight);

// Cavity cut, deliberately running past the +Y wall so the slot is open
const cavityCut = Manifold.cube([cavityW, cavityH + wall + eps, cavityT + eps]).translate([
  -cavityW / 2,
  -cavityH / 2,
  -eps / 2,
]);
front = front.subtract(cavityCut);

const windowProfile = roundRect(imageW, imageH, windowFillet);
const frontWindow = windowProfile.extrude(lipFront + 2 * eps).translate([0, imageOffsetY, cavityT - eps]);
front = front.subtract(frontWindow);

// ============================================================
// BACK PLATE
//   - 0.4 mm bottom seal + 2.0 mm magnet pocket = 2.4 mm body
//   - Pockets open at the *top* (cavity-facing) face
//   - U-shaped retention rim 0.8 mm tall on three sides
//   - +Y end of rim has a 4 mm lead-in chamfer
// ============================================================
let back = outerProfile.extrude(backT);

// 4 magnet pockets — open upward (toward the rim / cavity side)
const magnetR = (magnetD + magnetClearance) / 2;
const magnetCenters: Vec2[] = [
  [-outerW / 2 + magnetInset, -outerH / 2 + magnetInset],
  [outerW / 2 - magnetInset, -outerH / 2 + magnetInset],
  [-outerW / 2 + magnetInset, outerH / 2 - magnetInset],
  [outerW / 2 - magnetInset, outerH / 2 - magnetInset],
];
for (const [x, y] of magnetCenters) {
  const pocket = Manifold.cylinder(magnetT + 2 * eps, magnetR, magnetR, 64).translate([x, y, magnetBottomSeal - eps]);
  back = back.subtract(pocket);
}

// Retention rim — open on +Y so it doesn't block the photo slot
const rimOuterW = cavityW - 2 * rimSlip;
const rimOuterH = cavityH - rimSlip;
const rimBlockOuter = Manifold.cube([rimOuterW, rimOuterH, rimH]).translate([
  -rimOuterW / 2,
  -cavityH / 2 + rimSlip,
  backT - eps,
]);
const rimInnerW = rimOuterW - 2 * rimW;
const rimInnerH = rimOuterH - rimW + eps;
const rimBlockInner = Manifold.cube([rimInnerW, rimInnerH + rimW + eps, rimH + 2 * eps]).translate([
  -rimInnerW / 2,
  -cavityH / 2 + rimSlip + rimW,
  backT - 2 * eps,
]);
let rim = rimBlockOuter.subtract(rimBlockInner);

// Lead-in chamfer at the +Y entry
// Builds a triangular wedge in the (Y, Z) plane and rotates it into
// place; (u, v, w) → (w, u, v) via Z90 then Y90.
{
  const yEnd = cavityH / 2;
  const zTop = backT + rimH;
  const zBot = backT;
  const yIn = yEnd - rimChamferLen;
  const triYZ = CrossSection.ofPolygons([
    [
      [yIn, zTop + eps],
      [yEnd + eps, zBot - eps],
      [yEnd + eps, zTop + eps],
    ],
  ] satisfies Polygons);
  const wedge = triYZ
    .extrude(rimOuterW + 2 * eps)
    .rotate([0, 0, 90])
    .rotate([0, 90, 0])
    .translate([-rimOuterW / 2 - eps, 0, 0]);
  rim = rim.subtract(wedge);
}

back = back.add(rim);

// ============================================================
// Preview layout — both parts laid out side by side, flat on Z=0
//
// To export individual STL/3MF for printing, replace the final
// assignment with `result = back;` or `result = front;`.
// ============================================================
const gap = 8;
const backShown = back.translate([-(outerW / 2 + gap / 2), 0, 0]);
const frontShown = front.translate([outerW / 2 + gap / 2, 0, 0]);

result = backShown.add(frontShown);
