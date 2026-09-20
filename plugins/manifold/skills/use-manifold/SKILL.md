---
name: use-manifold
description: Guide 3D-printing ideas through design, parametric modeling, inspection and trial feedback with the manifold-3d MCP server. Use to design, modify or export 3MF/GLB geometry. Validate scripts before showing output; geometry validation is not manufacturing certification.
---

# use-manifold — Skill Guide

> **Skill name:** `use-manifold` — **requires MCP server:** `manifold3d-mcp`

You have access to the Model Context Protocol server (`manifold3d-mcp`) that
runs TypeScript snippets against the [manifold-3d](https://github.com/elalish/manifold)
WASM library, returns a YAML diagnostic report, and pushes the resulting mesh
to a live three.js preview page in the user's browser. The user can export 3MF
for 3D printing or GLB for viewing and interchange.

## Tools

- **`validate_script`** — fast pre-flight (~1–2 s). Use this **first** for
  every new or changed model. It runs the same pipeline as `execute_script` but
  does not refresh the user's preview.
- **`execute_script`** — full run; on success the mesh is pushed to the preview
  page and the YAML report includes a `previewUrl`.
- **`get_annotations`** — cheap, zero-arg, no preview side effects; reads the
  user's active marks and completed structured ruler measurements on the current
  model and returns them as a YAML document. MCP has no composer attachment action.
  See [`references/annotations.md`](references/annotations.md).
- **`capture_view`** — renders the last executed model as a PNG from a named
  camera preset (`iso`, `front`, `back`, `left`, `right`, `top`, `bottom`).
  Returns YAML metadata with a `filePath` to the PNG, dimensions, bbox and view.
  Open that file with the host's image-viewing tool to inspect it.
  Optional params: `view` (default `iso`), `width`/`height` (128–2048, default
  1024), `includeAnnotations` (overlay user marks on the capture).

The script tools take exactly one source: `code` (an inline TypeScript snippet)
or `filePath` (an absolute path to a local `.ts`/`.js` snippet file read by the
MCP server). Relative paths are not supported. Prefer inline `code` for
installed plugins; `filePath` is only available for absolute paths inside the
server's already-authorized script roots. `execute_script` also takes an
optional `description` shown as the preview title.

## The recommended loop

1. **Scope** using [the design workflow](references/design-workflow.md).
   Model clear, simple requests directly. For uncertain interfaces or functional
   parts, resolve one consequential decision at a time and keep a small brief.
   Do not turn every request into a questionnaire.
2. **Choose structure and process.** Read only the applicable printing reference
   below. Identify key dimensions, fit behavior, orientation and relevant cleanup
   constraints before detailing. Unknown process or dimensions remain explicit
   assumptions, not fabrication promises.
3. **Write** a parameterized TypeScript snippet using the sandbox references.
   For revisions, retrieve relevant annotations before replacing the model and
   preserve constraints outside the requested change.
4. **`validate_script`** — fix errors and review warnings, actual dimensions and
   functional features using [verification and handoff](references/verification-and-handoff.md).
   `ok: true` is necessary, not sufficient. Candidate comparisons and diagnostics
   can stop here without replacing the current preview.
5. **Show a review version:** call **`execute_script`** with a meaningful
   `description`, then **`capture_view`**. Inspect the PNG from useful angles and
   compare it to the brief. Include a concrete visual observation; captures do
   not prove hidden geometry or fit.
6. **Handoff and iterate.** State what was checked, what still needs slicing or
   a physical trial, and how to recover the source. Use trial measurements to
   revise the relevant parameters. Revalidate changed geometry; reserve
   execute → capture for the next version being shown, not every internal candidate.

## Reference index

- [Design workflow](references/design-workflow.md) — risk-based questions,
  interfaces, structure, appearance and parameter intent. Read before modeling.
- [Verification and handoff](references/verification-and-handoff.md) — evidence,
  delivery state and trial feedback. Read before claiming a result is checked.
- Process-specific, read only when relevant:
  [FDM/FFF](references/printing-fdm.md),
  [SLA/MSLA](references/printing-resin.md),
  [polymer SLS](references/printing-sls.md).
- [`references/getting-started.md`](references/getting-started.md) —
  what `Manifold` / `CrossSection` / `Mesh` are and how they are pre-bound in
  the sandbox.
- [`references/script-conventions.md`](references/script-conventions.md) —
  hard rules for sandbox TypeScript snippets (`result`, units, forbidden
  globals, timeout, code size).
- [`references/manifold-api.md`](references/manifold-api.md) —
  primitives, booleans, transforms, properties.
- [`references/cross-section-api.md`](references/cross-section-api.md) —
  2D shapes that you can `extrude`, `revolve`, or use in `levelSet`.
- [`references/memory-management.md`](references/memory-management.md) —
  managed cleanup, instance lifetime and allocation pressure.
- [`references/tips.md`](references/tips.md) — precision,
  units and immutable rotations, adapted from upstream.
- [`references/validation-report.md`](references/validation-report.md) —
  the YAML schema and every error/warning code, with typical fixes.
- [`references/examples.md`](references/examples.md) —
  runnable TypeScript snippets you can adapt as a starting point.
- [`references/annotations.md`](references/annotations.md) — how to read user
  annotations ("marks") with the `get_annotations` MCP tool.
- [`prompts/iterate-with-validate.md`](prompts/iterate-with-validate.md) —
  the host-specific execution and revision loop.
- Sandbox declarations are generated separately at build time into
  `references/manifold-sandbox.d.ts` and mirrored into the assembled
  plugin from this shared reference tree.

## House rules for the LLM (you)

- **Keep geometry, fit and manufacturing evidence distinct.** Check actual
  interfaces separately from the outer bbox. No universal percentage defines
  fit clearance. `genus` alone does not establish part count or correct openings.
- **Do not invent manufacturing checks.** The print-related hint is not a local
  wall-thickness measurement. These tools do not slice, generate supports or
  certify strength; CNC is outside this workflow.
- **`capture_view` is a verification step, not a bonus.** After `execute_script`,
  call `capture_view` from at least one relevant angle (e.g. `front` for a flat
  face, `iso` for overall shape) and inspect the PNG.
- **`get_annotations` is MCP-only.** Canvas feedback flows through the host UI,
  not this skill.
