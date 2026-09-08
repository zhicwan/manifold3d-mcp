/**
 * 97-gecko-rock-terraces — Rounded three-level gecko hide
 *
 * A hollow hide, two stone-like stair flights, and an arched upper platform.
 * Units: mm. The assembled model faces -Y and consists of four separate parts.
 * Hide: 170 x 120 x 65. Upper platform: 100 x 100, with its top at Z = 100.
 * Assembly: 170 x 291.7 x 100. Roof joints allow a 0.15 mm adhesive gap.
 *
 * Print the hide roof-down, stairs tread-up, and platform top-down separately.
 * These are geometric design checks, not load, animal-safety, or airflow tests.
 */
// APIs: Manifold.hull, cylinder, cube, difference, union, compose, decompose,
// boundingBox, intersect, volume, genus; CrossSection.ofPolygons, offset, extrude.

{
  type V3 = [number, number, number];

  const fn = 48;
  const maxLen = 170,
    maxWid = 120,
    outerH = 65;
  const wall = 2.4,
    roof = 2.64,
    edgeR = 1.2,
    cornerR = 8;
  const expand = maxWid / 26;
  const outerLen = maxLen - 2 * expand,
    outerWid = maxWid - 2 * expand;
  const slope = expand / (outerH - 2 * edgeR);
  const normalScale = Math.sqrt(1 + slope * slope);

  function ring(w: number, d: number, r: number, z: number, ox: number, oy: number): V3[] {
    const points: V3[] = [];
    const corners: V3[] = [
      [w - r, d - r, 0],
      [r, d - r, 90],
      [r, r, 180],
      [w - r, r, 270],
    ];
    for (const [cx, cy, start] of corners) {
      for (let i = 0; i <= 12; i++) {
        const a = ((start + i * 7.5) * Math.PI) / 180;
        points.push([ox + cx + r * Math.cos(a), oy + cy + r * Math.sin(a), z]);
      }
    }
    return points;
  }

  function softBox(size: V3, origin: V3, xyR: number, zR: number): Manifold {
    const points: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = (i * Math.PI) / 12;
      const inset = zR * (1 - Math.sin(a)),
        dz = zR * (1 - Math.cos(a));
      for (const z of [origin[2] + dz, origin[2] + size[2] - dz]) {
        points.push(
          ...ring(size[0] - 2 * inset, size[1] - 2 * inset, xyR - inset, z, origin[0] + inset, origin[1] + inset),
        );
      }
    }
    return Manifold.hull(points);
  }

  const outsidePoints: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i * Math.PI) / 12;
    const inset = edgeR * (1 - Math.sin(a)),
      dz = edgeR * (1 - Math.cos(a));
    outsidePoints.push(
      ...ring(maxLen - 2 * inset, maxWid - 2 * inset, cornerR - inset, dz, -expand + inset, -expand + inset),
    );
    outsidePoints.push(...ring(outerLen - 2 * inset, outerWid - 2 * inset, cornerR - inset, outerH - dz, inset, inset));
  }
  const outer = Manifold.hull(outsidePoints);

  // Match the outer slope without adding a thickened rim inside the opening.
  function innerFace(z: number): number {
    return -expand + slope * (z - edgeR) + wall * normalScale;
  }

  const ceiling = outerH - roof,
    innerEdge = 0.96,
    shoulder = ceiling - innerEdge;
  const lowFace = innerFace(-1.5),
    highFace = innerFace(shoulder);
  const insidePoints = ring(outerLen - 2 * lowFace, outerWid - 2 * lowFace, cornerR - wall, -1.5, lowFace, lowFace);
  for (let i = 0; i <= 6; i++) {
    const a = (i * Math.PI) / 12;
    const inset = innerEdge * (1 - Math.cos(a)),
      z = shoulder + innerEdge * Math.sin(a);
    insidePoints.push(
      ...ring(
        outerLen - 2 * (highFace + inset),
        outerWid - 2 * (highFace + inset),
        cornerR - wall - inset,
        z,
        highFace + inset,
        highFace + inset,
      ),
    );
  }
  const cavity = Manifold.hull(insidePoints);

  const doorW = 55,
    doorH = (35 * 55) / 45,
    doorR = doorW / 2;
  const doorPoints: [number, number][] = [
    [-doorR, -1],
    [doorR, -1],
  ];
  for (let i = 0; i <= 48; i++) {
    const a = (Math.PI * i) / 48;
    doorPoints.push([doorR * Math.cos(a), doorH - doorR + doorR * Math.sin(a)]);
  }
  const door = Manifold.extrude(CrossSection.ofPolygons([doorPoints]), 20, 0, 0, [1, 1], true)
    .rotate([90, 0, 0])
    .translate([outerLen / 2 - 30, 0, 0]);
  const shell = Manifold.difference(outer, cavity, door);

  const ventW = 1.8,
    topLen = outerH * 0.12,
    sideLen = outerH * 0.22;

  function slotY(len: number): Manifold {
    const c = Manifold.cylinder(14, ventW / 2, ventW / 2, fn, true);
    return Manifold.hull([c.translate([0, ventW / 2, 0]), c.translate([0, len - ventW / 2, 0])]);
  }

  function slotZ(len: number): Manifold {
    const c = Manifold.cylinder(14, ventW / 2, ventW / 2, fn, true).rotate([90, 0, 0]);
    return Manifold.hull([c.translate([0, 0, ventW / 2]), c.translate([0, 0, len - ventW / 2])]);
  }

  const vents: Manifold[] = [];
  for (let i = 0; i < 3; i++) {
    const x = 138.4 + i * 5.4;
    const top = slotY(topLen + 8).translate([x, outerWid - topLen, outerH - wall / 2]);
    const side = slotZ(sideLen + 8).translate([x, outerWid - wall / 2, outerH - sideLen]);
    vents.push(
      top,
      side,
      top.mirror([1, 0, 0]).translate([outerLen, 0, 0]),
      side.mirror([1, 0, 0]).translate([outerLen, 0, 0]),
    );
  }
  const house = shell.subtract(Manifold.union(...vents));

  function stairs(
    centerX: number,
    startY: number,
    baseZ: number,
    count: number,
    rise: number,
    tread: number,
  ): Manifold {
    const blocks: Manifold[] = [];
    for (let i = 0; i < count; i++) {
      blocks.push(
        softBox([50, (count - i) * tread, (i + 1) * rise], [centerX - 25, startY + i * tread, baseZ], 4.5, 0.8),
      );
    }
    return Manifold.union(...blocks);
  }

  const glueGap = 0.15,
    upperBase = 65 + glueGap,
    upperX = 50.391637323293615;
  const groundStair = stairs(126.85485842871336, -119.4, 0, 10, 6.5, 12).subtract(outer.translate([0, -glueGap, 0]));
  const upperStair = stairs(upperX, 2, upperBase, 7, (100 - upperBase) / 7, 10);

  const deckX = upperX - 50,
    deckY = 72.3;
  const deck = softBox([100, 100, 4], [deckX, deckY, 96], 12, 1.2);
  const archCenter = deckY + 50,
    archR = 32,
    archSpring = 50;
  const archPoints: [number, number][] = [
    [archCenter - archR, -2],
    [archCenter + archR, -2],
  ];
  for (let i = 0; i <= 48; i++) {
    const a = (Math.PI * i) / 48;
    archPoints.push([archCenter + archR * Math.cos(a), archSpring + archR * Math.sin(a)]);
  }
  const archProfile = CrossSection.ofPolygons([archPoints]);

  function extrudeYZ(profile: CrossSection, x: number, depth: number): Manifold {
    return profile.extrude(depth).rotate([90, 0, 0]).rotate([0, 0, 90]).translate([x, 0, 0]);
  }

  // Front supports bond to the roof; rear supports reach the ground.
  const rearClear = outerWid + expand + 0.3;
  const roofClearance = Manifold.cube([190, 250, upperBase + 1]).translate([-10, rearClear - 250, -1]);
  const supportParts: Manifold[] = [deck];
  for (const cx of [deckX + 10, deckX + 90]) {
    const x0 = cx - 4,
      width = 8;
    const blank = softBox([width, 88, 96.8], [x0, deckY + 6, 0], 3.2, 1.2);
    const core = extrudeYZ(archProfile, x0 - 1, width + 2);
    const expanded = archProfile.offset(0.8, 'Round', 2, fn);
    const bevelA = Manifold.hull([extrudeYZ(expanded, x0 - 0.4, 0.4), extrudeYZ(archProfile, x0 + 0.8, 0.02)]);
    const bevelB = Manifold.hull([
      extrudeYZ(archProfile, x0 + width - 0.82, 0.02),
      extrudeYZ(expanded, x0 + width, 0.4),
    ]);
    supportParts.push(Manifold.difference(blank, Manifold.union(core, bevelA, bevelB), roofClearance));
  }
  const platform = Manifold.union(...supportParts);
  const parts = [house, groundStair, upperStair, platform];

  for (const part of parts) {
    if (part.decompose().length !== 1) throw new Error('Detached geometry inside a print part');
    const b = part.boundingBox();
    if (b.max[0] - b.min[0] > 256 || b.max[1] - b.min[1] > 256 || b.max[2] - b.min[2] > 256) {
      throw new Error('Part exceeds A1 build volume');
    }
  }
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i],
        b = parts[j];
      if (!a || !b) throw new Error('Missing part');
      if (a.intersect(b).volume() > 0.01) throw new Error('Assembly collision: ' + i + ', ' + j);
    }
  }
  if (house.genus() !== 6) throw new Error('The six ventilation holes must remain open');
  const hb = house.boundingBox(),
    db = deck.boundingBox();
  if (
    Math.abs(hb.max[0] - hb.min[0] - 170) > 0.001 ||
    Math.abs(hb.max[1] - hb.min[1] - 120) > 0.001 ||
    Math.abs(hb.max[2] - 65) > 0.001
  ) {
    throw new Error('Hide envelope changed');
  }
  if (
    Math.abs(db.max[0] - db.min[0] - 100) > 0.001 ||
    Math.abs(db.max[1] - db.min[1] - 100) > 0.001 ||
    Math.abs(db.max[2] - 100) > 0.001
  ) {
    throw new Error('Platform envelope changed');
  }
  result = Manifold.compose(parts);
  if (result.decompose().length !== 4) throw new Error('Expected four glue-bonded print parts');
}
