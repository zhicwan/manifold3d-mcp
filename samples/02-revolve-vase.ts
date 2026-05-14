/**
 * 02-revolve-vase — 2D profile → 3D solid via revolve
 *
 * Defines a curved vase silhouette as a 2D polygon in the XY plane
 * (X = radius from the rotation axis, Y = height), wraps it in a
 * CrossSection, then revolves it 360° around the Y axis using
 * Manifold.revolve. The profile traces the outer wall plus the
 * on-axis top and bottom to form a closed, solid cross-section.
 *
 * APIs: CrossSection.ofPolygons, Manifold.revolve
 */

// Vase profile: each entry is [radius_mm, height_mm].
// Goes counterclockwise: bottom-centre → outer base → belly → neck → rim → top-centre.
const profile: Vec2[] = [
  [0,  0],   // bottom centre (on the rotation axis)
  [12, 0],   // base outer edge
  [10, 12],  // taper above the base
  [16, 32],  // widest belly
  [9,  52],  // narrow neck
  [11, 60],  // flared rim
  [0,  60],  // top centre (closes the cross-section on the axis)
];

const cs = CrossSection.ofPolygons([profile]);
result = Manifold.revolve(cs, /* circularSegments= */ 72);
