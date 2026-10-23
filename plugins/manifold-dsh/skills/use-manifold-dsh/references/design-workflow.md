# From idea to printable part

Use this workflow before writing or changing geometry. Speak the user's language.
Scale the discussion to the decision: a specified simple shape needs no interview;
a functional assembly needs more than a plausible silhouette.

## Resolve only what changes the design

| Request                                               | Next action                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Simple shape with clear dimensions                    | State any material assumption briefly and model it. Do not invent a confirmation gate.                                        |
| Vague idea or open-ended appearance                   | Clarify the purpose or success condition that most changes the structure.                                                     |
| Part that fits, holds or moves against another object | Establish the relevant measured interface, fit behavior and assembly direction before fixing that interface.                  |
| Functional or process-sensitive part                  | Resolve the material, use conditions or manufacturing constraint that could invalidate the proposal.                          |
| Critical information unavailable                      | Offer measurement guidance or an explicitly provisional concept. Do not describe guessed interfaces as ready for fabrication. |

Use the host's structured question tool when available, one consequential decision
at a time. Explain its effect and offer understandable choices rather than asking
the user to supply engineering jargon. Do not repeat settled facts or dump a
checklist. If there is no question tool, ask in chat and wait when an answer is
needed. A user's request to explore quickly permits labeled assumptions, not
claims of proven fit or printability.

For replacement parts, establish units and measurement references. Request a
dimensioned drawing or specific measurements when necessary; do not infer exact
dimensions from an unscaled photograph. Obtain standard hardware dimensions from
the identified part's specification rather than inventing them.

## Keep a small working brief

Keep these facts in the conversation, extending them only as needed:

- **Job and success:** what the part does, what it touches, and how success will
  be observed. Distinguish visual exploration, a fit sample and functional use.
- **Confirmed constraints:** controlling dimensions and their sources, interfaces,
  fixed envelope, assembly/motion direction, and what must remain unchanged.
- **Process and environment:** known printer/process, material, use conditions,
  load direction where relevant, and acceptable post-processing.
- **Direction:** structure, visible/touch surfaces and the user's visual preferences.
- **Assumptions and open decisions:** distinguish measured facts, derived dimensions,
  provisional values and missing evidence.

For a simple request this may be one sentence. For an ambiguous functional part,
confirm the decisions that lock the design before detailed modeling. Do not
require a separate document, design system or file for every model.

High-consequence uses need qualified engineering review and suitable physical
verification. Do not infer load capacity, fatigue life, pressure integrity,
food-contact or other use safety from the material name or a successful mesh.

## Choose structure and process before detailing

Resolve the main interfaces, one-piece versus assembled construction, access for
assembly and cleaning, and intended manufacturing orientation. Consider how the
user will insert, remove, fasten or operate the part, including clearance for
fingers, fasteners and tools. Check relevant tolerance stacks rather than treating
every interface independently.

Load only the applicable process reference:

| Known process              | Reference                            |
| -------------------------- | ------------------------------------ |
| Filament printing, FDM/FFF | [Filament printing](printing-fdm.md) |
| Resin printing, SLA/MSLA   | [Resin printing](printing-resin.md)  |
| Polymer SLS                | [SLS printing](printing-sls.md)      |

FDM is the main teaching path, not an assumption that an unspecified machine is
FDM. When process is unknown, ask if it changes the design, or keep the output
explicitly at concept level. CNC and other manufacturing processes are outside
this workflow; do not repurpose these checks as a machining assessment.

When several structures are genuinely viable, offer a small number of materially
different options and explain the tradeoff in fit, supports, strength direction,
finish, assembly or cost. Do not run a concept competition for a specified shape.

## Make appearance intentional

Honor the user's references and pinned appearance. For open-ended designs, translate
words such as "clean" into concrete choices: silhouette and proportions, a coherent
edge-radius family, seam placement, visible fasteners, grip and surface treatment.
Use a small visual comparison when helpful, keeping scale and view comparable.

Explain practical consequences: hiding a fastener may make service harder; a
bed-facing fillet may need support; a split can improve print orientation but leave
a visible seam. Functional constraints outrank unrequested decoration. Do not
silently change dimensions or replace the user's direction to make a render prettier.

## Model the intent, not just the outline

Keep named parameters together. Separate inputs from derived geometry, and name
dimensions for the feature they control rather than their current numeric value.

| Quantity                   | Meaning                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Nominal size and tolerance | Intended final dimension and its allowed variation, measured from an identified reference.                   |
| Fit clearance/interference | Relationship between mating surfaces; specify per-side, total or diametral values and intended fit behavior. |
| Process compensation       | A documented adjustment for measured machine/material behavior; record whether CAD or the slicer applies it. |
| Tessellation error         | Approximation of a curve by facets; choose resolution for relevant dimensions, not only smooth shading.      |
| Boolean overlap/overshoot  | A construction aid, not fit clearance, material shrinkage compensation or a finished dimension.              |

Check fit openings, installation interfaces and outer envelope independently.
An object's width does not impose a universal percentage limit on a support's
base width; equally, a plausible outer bbox does not establish a correct slot.
Avoid universal fit allowances and global scaling to fix one tight interface.

Build functional geometry before decorative detail. A container needs an opening,
interior and bottom; a hole needs the specified path and depth. Name the intended
components and cavities so topology can be interpreted rather than guessed.

## Change deliberately, then gather evidence

Before editing, identify the requested change and the constraints to preserve.
Keep the brief current when an assumption changes. Validate changed geometry,
including one-number edits, but use validation-only runs for temporary candidates,
subassembly diagnostics and numerical comparisons. These need not replace the
user's current preview.

Reserve execute and capture for a version intended for user review or delivery,
including a visual comparison the user wants to see. Before publishing it, recheck
the affected dimensions and process conditions; after publication, capture and
inspect that version. Camera or description-only changes do not require rebuilding
geometry.

Use [verification and handoff](verification-and-handoff.md) to distinguish what
was checked from what still needs slicing or a physical trial.
