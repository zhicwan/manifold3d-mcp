/**
 * 04-warp-and-refine — Smooth deformation of a refined mesh
 *
 * Subdivides a 20 mm sphere with refine(3) to increase vertex density
 * ~9×, then applies warp() to displace each vertex radially by a
 * spherical-harmonic-like wave.  Refining before warping ensures that
 * the deformation follows the wave smoothly; warping a coarse sphere
 * would produce visible faceting instead.
 *
 * APIs: Manifold.sphere, refine, warp
 */

// Start with a sphere: radius = 20 mm, 32 circular segments.
const sphere = Manifold.sphere(20, 32);

// Refine subdivides each triangle into n² sub-triangles (3→9×).
const refined = sphere.refine(3);

// Warp displaces each vertex in-place.  The callback receives a Vec3
// reference and must mutate it directly (return type is void).
result = refined.warp((v: Vec3) => {
  const r = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (r < 1e-9) return; // skip degenerate origin vertices

  // Spherical coordinates → wave displacement → scale vertex.
  const theta = Math.acos(v[2] / r); // polar angle [0, π]
  const phi = Math.atan2(v[1], v[0]); // azimuthal angle [−π, π]
  const disp = 3.0 * Math.sin(4 * theta) * Math.cos(4 * phi); // ±3 mm
  const scale = (r + disp) / r;
  v[0] *= scale;
  v[1] *= scale;
  v[2] *= scale;
});
