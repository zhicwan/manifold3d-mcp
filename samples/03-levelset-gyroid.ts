/**
 * 03-levelset-gyroid — Implicit surface from a gyroid SDF
 *
 * Traces the zero level-set of the gyroid function
 *   f(x,y,z) = sin(x)·cos(y) + sin(y)·cos(z) + sin(z)·cos(x)
 * inside a 20 × 20 × 20 mm bounding box.  The spatial frequency is
 * chosen so that exactly two full gyroid cells fit in each direction
 * (cell period = 10 mm), giving a compact printable lattice that is
 * impossible to model with boolean operations alone.
 *
 * APIs: Manifold.levelSet
 */

const period = 10; // mm per gyroid cell
const s = (2 * Math.PI) / period; // radians per mm

const bounds: Box = {
  min: [-10, -10, -10] as Vec3,
  max: [10, 10, 10] as Vec3,
};

const gyroidSDF = (p: Vec3): number =>
  Math.sin(p[0] * s) * Math.cos(p[1] * s) +
  Math.sin(p[1] * s) * Math.cos(p[2] * s) +
  Math.sin(p[2] * s) * Math.cos(p[0] * s);

result = Manifold.levelSet(gyroidSDF, bounds, /* edgeLength= */ 0.5, /* level= */ 0);
