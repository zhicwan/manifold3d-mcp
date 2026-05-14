/**
 * 01-hello-cube — Smallest valid sandbox script
 *
 * Builds a 20 × 20 × 20 mm cube centred at the origin, scales it
 * uniformly by 1.5× to 30 × 30 × 30 mm, and assigns it to `result`.
 * This is the minimal example of a valid manifold-mcp sandbox snippet — good
 * starting point for understanding the sandbox conventions.
 *
 * APIs: Manifold.cube, scale
 */

const cube = Manifold.cube([20, 20, 20], /* center= */ true);
result = cube.scale(1.5);
