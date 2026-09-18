# Iterating with `manifold_validate_script` first

The single most useful habit when driving the Canvas Extension is:

> **`manifold_validate_script` early, `manifold_execute_script` once you are
> confident.**

Why: `manifold_execute_script` repaints the Canvas preview every time.
Validating in a loop without re-rendering keeps the user's screen calm and
gives you tighter feedback.

## Canonical loop

1. Use the [shared design workflow](../references/design-workflow.md).
   Proceed directly for a clear simple request; clarify consequential unknowns
   for functional parts. Record confirmed dimensions, assumptions and constraints
   to preserve. Read the selected process reference only when relevant.
2. Write a TypeScript snippet. Use
   [`../references/examples.md`](../references/examples.md)
   as a starting template. Do not import or export anything; use the ambient
   sandbox globals.
3. Call `manifold_validate_script`.
4. Look at the YAML report:
   - `errors:` non-empty → fix and validate again.
   - `warnings:` `BBOX_TOO_SMALL` / `BBOX_TOO_LARGE` → check units, intended scale
     and actual printer envelope, without automatically resizing confirmed dimensions.
   - `stats:` sanity-check volume and outer dimensions, then check the important
     openings, fit dimensions and hidden features separately.
5. Follow [verification and handoff](../references/verification-and-handoff.md).
   For candidates or diagnostics, repeat steps 2–4 as needed; a numerical comparison
   can end there. When a version is intended for user review, resolve errors and
   review relevant warnings/dimensions, then open the `manifold3d-viewer` Canvas
   with the host tools and call `manifold_execute_script` with a meaningful
   `description`.
6. Call `manifold_capture_view` and inspect the PNG before telling the user the
   model is visually checked. State actual checks, remaining slicing/trial work
   and source availability.
7. For changes, use the supplied annotation/location snapshot, preserve unaffected
   constraints and recheck affected fit/process conditions. Restart validation;
   do not fetch MCP annotations.

## Revalidation

Validate every new or changed geometry, including a one-number edit. A change
in wall thickness or clearance can invalidate a previously good design. Validation
does not require publication: keep temporary exploration validation-only, then
execute and capture the version to be shown. Pure camera or description changes
do not require a geometry rebuild.

## Reading stats during iteration

`manifold_validate_script` populates `stats.bbox.size`, `stats.volume`, and
`stats.triangles` even before any preview push. Use these to debug geometry
without wasting a `manifold_execute_script` round-trip.

## Telling the user what is going on

Keep the handoff useful for the requested part:

- Key dimensions and actual visual/functional checks, not just triangle count.
- How to recover the source and export 3MF for printing or GLB for viewing and exchange.
- Unresolved warnings, process assumptions and the next useful slicer or trial check.
- Do not treat the mesh-dependent feature-size hint as a wall-thickness measurement.
