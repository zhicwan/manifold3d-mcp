# Iterating with `validate_script` first

The single most useful habit when driving manifold3d-mcp is:

> **`validate_script` early, `execute_script` once you are confident.**

Why: `execute_script` repaints the user's preview every time. Validating in a
loop without re-rendering keeps the user's screen calm and gives you tighter
feedback while keeping design decisions with the user.

## Canonical loop

1. Use the [shared design workflow](../references/design-workflow.md).
   Proceed directly for a clear simple request; clarify consequential unknowns
   for functional parts. Record confirmed dimensions, assumptions and constraints
   to preserve. Read the selected process reference only when relevant.
2. Write a TypeScript snippet. Use
   [`../references/examples.md`](../references/examples.md)
   as a starting template. Do not import or export anything; use the ambient
   sandbox globals. Prefer inline `code`; use `filePath` only when the script
   already lives inside an authorized absolute root.
3. Call `validate_script`.
4. Look at the YAML report:
   - `errors:` non-empty → fix and validate again. Common ones:
     - `RESULT_NOT_ASSIGNED` — add `result = …`.
     - `FORBIDDEN_GLOBAL` — stay inside the sandbox globals.
     - `TS_DIAGNOSTIC` / `TS_EMIT_ERROR` — fix TypeScript API, tuple, or
       argument-shape issues before runtime will run.
     - `EMPTY_RESULT` — inspect the operand dimensions and boolean order.
       Assign subassemblies to `result` in validation-only runs when necessary;
       script console output is not returned as report evidence.
     - `RESULT_TOO_LARGE` / `TIMEOUT` — drop circular segment counts.
   - `warnings:` `BBOX_TOO_SMALL` / `BBOX_TOO_LARGE` — check the intended units,
     scale and actual printer envelope. The thresholds are general reminders,
     not proof of a mistake; do not rescale a confirmed dimension automatically.
   - `stats:` sanity-check volume and outer dimensions, then check the important
     openings, fit dimensions and hidden features separately.
5. Follow [verification and handoff](../references/verification-and-handoff.md).
   For candidates or diagnostics, repeat steps 2–4 as needed; a numerical comparison
   can end there. When a version is intended for user review, resolve errors and
   review relevant warnings/dimensions, then call `execute_script` with a meaningful
   `description`.
6. Call `capture_view` from useful angles, inspect the PNG and compare with the
   brief. State actual checks, remaining slicing/trial work and source availability.
7. For changes, read referenced marks with `get_annotations` before replacing
   the model. Preserve unaffected constraints, recheck affected fit/process
   conditions and restart validation.

## Revalidation

Validate every new or changed geometry, including a one-number edit. A change
in wall thickness or clearance can invalidate a previously good design. Validation
does not require publication: keep temporary exploration validation-only, then
execute and capture the version to be shown. Pure camera or description changes
do not require a geometry rebuild.

## Reading stats during iteration

`validate_script` populates `stats.bbox.size`, `stats.volume`, and
`stats.triangles` even before any preview push. Use these to debug geometry
without wasting an `execute_script` round-trip:

- **`volume == 0` but `triangles > 0`** — your boolean produced a
  coplanar/zero-thickness result; check that solids actually overlap and that
  you used `subtract` (not `intersect`) where intended.
- **`bbox.size[2] == 1.0` when you expected 100** — a missing `*100`
  somewhere in your loop; coordinates are millimetres.
- **`bbox.size` exceeds `BBOX_TOO_LARGE` (~500 mm)** — check unit assumptions and
  manufacturing envelope; a deliberately large object is not necessarily mis-scaled.
- **`triangles` close to 1e6** — refine() / warp() / smooth() can multiply
  triangle counts; cap with explicit subdivision parameters.

Reading these in `validate_script` first means you can adjust units and
booleans before showing the user any preview.

## Reading multiple findings

Errors and warnings are independent — fix the first error before believing
later ones. Typecheck errors block runtime entirely. Many "missing `result`"
reports are caused by a syntax error above the assignment, which the parser
flags first.

## Telling the user what is going on

Keep the handoff useful for the requested part:

- Key dimensions and actual visual/functional checks, not just triangle count.
- How to recover the source and export 3MF for printing or GLB for viewing and exchange.
- Unresolved warnings, process assumptions and the next useful slicer or trial check.
- Do not treat the mesh-dependent feature-size hint as a wall-thickness measurement.
