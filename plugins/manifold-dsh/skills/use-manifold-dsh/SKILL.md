---
name: use-manifold-dsh
description: Guide 3D-printing ideas through design, parametric modeling, inspection and trial feedback with the Manifold 3D Viewer in DeepSeek Harness. Use to design, revise, validate, execute or capture geometry. Geometry validation is not manufacturing certification.
---

# use-manifold-dsh — Skill Guide

> **Skill name:** `use-manifold-dsh` — **requires bundle:** `@manifold3d/manifold-dsh`

You have native DeepSeek Harness tools that validate snippets, execute the
current model of this session, and capture a rendered view. They use the same
manifold-3d modeling sandbox as the MCP server, but the workflow differs: the
user inspects the model in the right-Sidebar **3D Viewer** tab, and there is no
`get_annotations` tool or MCP-style annotation round-trip.

## Tools

- **`manifold_validate_script`** — fast pre-flight (~1–2 s). Use this **first**
  for every new or changed model. It validates a TypeScript snippet without
  changing the current Viewer model.
- **`manifold_execute_script`** — full run; on success the mesh is published to
  every open 3D Viewer tab of this session and the optional `description` is
  shown by the Viewer. The tool card offers the user an **Open in 3D Viewer**
  button.
- **`manifold_capture_view`** — renders the last executed model of this session
  from a named camera preset (`iso`, `front`, `back`, `left`, `right`, `top`,
  `bottom`). When the current model accepts images the PNG is returned to you
  directly; otherwise it is saved under `.manifold3d/captures/` and the result
  reports its `filePath`.

The script tools accept exactly one source field: `code` (an inline TypeScript
snippet). `filePath` loading is not part of this contract.
`manifold_execute_script` also takes an optional `description`.
Each session has its own model; execution in one session never changes another.

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
5. **Show a review version:** call **`manifold_execute_script`** with a meaningful
   `description`, then **`manifold_capture_view`**. Inspect useful views and
   compare them to the brief. Include a concrete visual observation; captures do
   not prove hidden geometry or fit. Tell the user they can open the 3D Viewer
   from the tool card or the right-Sidebar guide.
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
- [`prompts/fix-and-attach.md`](prompts/fix-and-attach.md) —
  how the Viewer's Fix and Attach actions reach you in this host.

## House rules for the LLM (you)

- **`ok: true` is necessary, not sufficient.** After every
  `manifold_validate_script`, cross-check the YAML `stats` against your intent
  before claiming success or calling `manifold_execute_script`. Check interfaces
  separately from the outer bbox; no universal percentage defines fit clearance,
  and `genus` alone does not establish part count or correct openings.
- **Do not invent manufacturing checks.** The print-related hint is not a local
  wall-thickness measurement. These tools do not slice, generate supports or
  certify strength; CNC is outside this workflow.
- **No `filePath` guessing.** The tools are inline-code only. If the user wants
  to work from a file, read the file and pass its content as `code`.
- **`manifold_capture_view` is a verification step, not a bonus.** After
  `manifold_execute_script`, capture at least one relevant angle and inspect the
  image before declaring the model visually checked.
- **Viewer feedback uses explicit snapshots.** Apply the supplied batch,
  location or measurement snapshot; do not call MCP `get_annotations` here.
