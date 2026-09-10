// Phone stand: a rounded base, tilted backrest and open charging-cable slot.
// APIs: CrossSection.square, offset, ofPolygons, extrude; Manifold.union, subtract.
// Millimetres. Change cableSlotWidth from 14 to 22 to reproduce the wider slot.
const width = 80;
const depth = 85;
const baseThickness = 6;
const cableSlotWidth = 14;
const tilt = 20;

const roundedRectangle = (w: number, h: number, r: number): CrossSection =>
  CrossSection.square([w - 2 * r, h - 2 * r], true).offset(r, 'Round', 2, 48);

const base = roundedRectangle(width, depth, 5).extrude(baseThickness);
const backrest = roundedRectangle(70, 90, 4)
  .translate([0, 45])
  .extrude(4.5)
  .rotate([90 - tilt, 0, 0])
  .translate([0, -8, baseThickness - 0.5]);
const shelf = roundedRectangle(70, 22, 3).extrude(6).translate([0, -19, 5]);
const lip = roundedRectangle(70, 5, 2).extrude(14).translate([0, -27.5, 5]);
const rib = CrossSection.ofPolygons([
  [
    [-10, 5],
    [32, 5],
    [19, 85],
  ],
])
  .extrude(5)
  .rotate([90, 0, 90]);

// Extend the cut beyond the base and lip; leave the backrest joined at the rear.
const cableSlot = roundedRectangle(cableSlotWidth, 42, 3).extrude(24).translate([0, -33, -1]);

result = Manifold.union(base, backrest, shelf, lip, rib.translate([-27.5, 0, 0]), rib.translate([22.5, 0, 0])).subtract(
  cableSlot,
);
