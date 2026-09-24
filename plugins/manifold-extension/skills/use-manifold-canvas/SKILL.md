---
name: use-manifold-canvas
description: Guide 3D-printing ideas through design, parametric modeling, inspection and trial feedback in Copilot's native Canvas. Use to design, revise, validate, execute or capture geometry. Geometry validation is not manufacturing certification.
---

# use-manifold-canvas — Skill Guide

> **Skill name:** `use-manifold-canvas` — **requires Extension:** `manifold-extension`

You have access to the native Copilot Extension tools that validate snippets,
execute the current model, and capture a rendered view. The Extension uses the
same manifold-3d modeling sandbox as the MCP server, but it is a different
host workflow: there is no `get_annotations` tool here and no MCP-style
annotation round-trip.

## Tools

- **`manifold_validate_script`** — fast pre-flight (~1–2 s). Use this **first**
  for every new or changed model. It validates a TypeScript snippet without
  changing the current Canvas model.
- **`manifold_execute_script`** — full run; on success the mesh is published to
  the open Manifold Canvas and the optional `description` is shown by the
  Canvas.
- **`manifold_capture_view`** — renders the last executed model as a PNG from a
  named camera preset (`iso`, `front`, `back`, `left`, `right`, `top`,
  `bottom`). The image is saved in the active Copilot session workspace.

The script tools accept exactly one source field: `code` (an inline TypeScript
snippet). `filePath` loading is not part of the Extension contract.
`manifold_execute_script` also takes an optional `description` shown by the
Canvas.

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
   For revisions, apply the supplied annotation/location/measurement context and preserve
   constraints outside the requested change.
4. **`manifold_validate_script`** — fix errors and review warnings, actual dimensions
   and functional features using [verification and handoff](references/verification-and-handoff.md).
   `ok: true` is necessary, not sufficient. Candidate comparisons and diagnostics
   can stop here without replacing the current preview.
5. **Show a review version:** open the `manifold3d-viewer` Canvas with the host's tools, then call
   **`manifold_execute_script`** with a meaningful `description` and
   **`manifold_capture_view`**. Inspect useful views and compare them to the brief.
   Include a concrete visual observation; captures do not prove hidden geometry or fit.
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
  sandbox globals, `result`, and the basic TypeScript-only workflow.
- [`references/script-conventions.md`](references/script-conventions.md) —
  hard rules for sandbox snippets (`result`, units, forbidden globals, timeout,
  code size).
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
- [`prompts/iterate-with-validate.md`](prompts/iterate-with-validate.md) —
  the main validate → execute → capture loop for the Extension.
- [`prompts/fix-and-attach.md`](prompts/fix-and-attach.md) —
  how to keep the host's Fix and Attach actions explicit.

## House rules for the LLM (you)

- **`ok: true` is necessary, not sufficient.** After every
  `manifold_validate_script`, cross-check the YAML `stats` against your intent
  before claiming success or calling `manifold_execute_script`. Check interfaces
  separately from the outer bbox; no universal percentage defines fit clearance,
  and `genus` alone does not establish part count or correct openings.
- **Do not invent manufacturing checks.** The print-related hint is not a local
  wall-thickness measurement. These tools do not slice, generate supports or
  certify strength; CNC is outside this workflow.
- **No `filePath` guessing.** The Extension tools are inline-code only. If the
  user wants to work from a file, read the file in the workspace and pass its
  content as `code`.
- **`manifold_capture_view` is a verification step, not a bonus.** After
  `manifold_execute_script`, capture at least one relevant angle and inspect the
  PNG before declaring the model visually checked.
- **Canvas feedback uses explicit snapshots.** Apply the supplied batch or
  location context; do not call MCP `get_annotations` in this host.
