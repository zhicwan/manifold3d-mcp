# Annotations (user "marks")

Choose **Annotate** in the viewer, then add spatial comments directly on the
rendered model:

- **Click** drops a point pin and opens its comment editor.
- **Drag** highlights a region and opens its comment editor.
- **Done** commits the current batch locally for `get_annotations`, without
  sending a message; **Cancel** discards new ordinary comments and restores
  measurement notes without deleting their dimensions.

Markers use compact display numbers; open one to read or edit its note.
The check button or Enter saves the current note, the cross or Escape cancels
that edit, and Shift+Enter adds a line. These actions are separate from Done /
Cancel for the whole batch. Committed ordinary comments can be inspected but
not edited; measurement notes remain editable in Annotate.
Use the returned `id`, `partLabel` and coordinates to identify a location, not
the marker's display number.

With the Viewer focused, **M** activates Annotate, **V** returns to browsing,
and holding **Space** temporarily restores camera navigation. Middle/right drag
and wheel zoom remain available; **F** fits the model and **?** opens help.
The MCP browser does not offer the Extension-only location attachment tool.

## Ruler measurements

Measure creates and manages dimension labels without opening an editor. Choose
Annotate and click a measurement label to add or edit a note. Saving the note
does not actively send a message; ask the assistant in chat to apply it.

Pure ruler results appear in `get_annotations` as `kind: "measurement"` even
without a note, but do not enter the notes batch. Saving a nonempty measurement
note joins the ordinary batch and count alongside point and region comments.
Done commits that shared batch; Cancel restores the measurement's pre-batch
note while retaining its geometry. Clearing the note exits the batch without
deleting the dimension. Read the
structured `measurement` field rather than treating `worldCoord` as the measured
quantity. It contains canonical point, finite straight-edge or planar-patch
operands, method names, mm distances with witness endpoints, and/or angles.
`edge-corner` measures rays leaving a unique shared endpoint (0-180 degrees).
Other direction methods retain smaller unoriented angles (0-90 degrees).
Supporting-plane distances are not shortest
distances to finite faces; `extended: true` identifies witnesses outside a patch.
Mesh edges are tessellation evidence, not guaranteed nominal CAD features.
Point operands may include `faceCenter: { patchId }`: the area centroid
of a connected planar face. The Viewer offers only centers on the actual surface.

MCP has no composer attachment or active Send modification action. Retrieve retained measurements here
before replacing the model; replacement clears them and requires remeasurement.
With `includeAnnotations`, captures draw distance witnesses and method/value
labels; angles are labeled, not drawn as fictitious intersection arcs.
A measured value alone is not an instruction to change the model.

Comment annotations have:

- a **partLabel** — automatically derived from which primitive the
  user clicked. Examples: `sphere#1`, `cube#2`, `extrude#1 (8/47 tris)
near +X side`. The number is per-kind (the first sphere is `sphere#1`,
  the second `sphere#2`, etc.). Region selections also include the
  proportion of the part the user covered and a 6-axis spatial hint
  (`near +X side` / `on top` / etc.).
- a **worldCoord** in millimetres (the picked point or the centroid of
  the selected region)
- a free-form **note** the user typed (e.g. "too thick", "round this",
  "should be 5mm")

## Reading annotations from your script

Use the `get_annotations` MCP tool — no arguments needed:

```jsonc
// tools/call request
{ "name": "get_annotations", "arguments": {} }
```

Response content is YAML. Its equivalent data structure is:

```json
{
  "modelVersion": "vlj9k2x1",
  "count": 2,
  "annotations": [
    {
      "id": "ann_lj9k_8a2qz",
      "modelVersion": "vlj9k2x1",
      "kind": "point",
      "partLabel": "point#1",
      "note": "too thick",
      "worldCoord": [12.4, 0, 5.2]
    },
    {
      "id": "ann_lj9k_p4xab",
      "modelVersion": "vlj9k2x1",
      "kind": "region",
      "partLabel": "region#1",
      "note": "round this edge",
      "worldCoord": [42.1, 0, 8.9],
      "triCount": 17
    }
  ]
}
```

If the user has no active annotations the body still has the same
shape (with `count: 0`) and a `note` explaining that no annotations are active.
Reading annotations does not start the preview.

## When to call it

Call `get_annotations` whenever the user references their marks
implicitly or explicitly. Examples that should trigger a call:

- "apply my notes"
- "fix what I marked"
- "改一下我标记的"
- "incorporate my feedback"
- right before regenerating the model after the user has been
  reviewing the previous version

It is also fine to call it speculatively at the start of a complex
edit to see whether the user has left feedback. The call is cheap
(one in-process map lookup).

## Lifecycle

- Annotations are **automatically cleared** every time you push a new
  model with `execute_script`. There is no way for stale annotations
  to leak into a subsequent run.
- Annotations live in the viewer's memory only — they are not
  persisted across browser refresh.
- Draft notes can be edited from their on-model flyouts. Cancelling a new empty
  ordinary comment removes that mark. Measurement edit Cancel restores its saved
  note; batch Cancel restores its pre-batch note. Neither deletes the dimension.

## Recommended workflow when responding to marks

1. Call `get_annotations` to retrieve the user's feedback.
2. Reason about each annotation: which feature does it reference (use
   `worldCoord` and `partLabel` to localise) and what is the user
   asking for?
3. Edit the script to address the feedback. Keep the rest of the model
   stable unless the user said otherwise. Use the
   [design workflow](design-workflow.md) to resolve conflicts with confirmed
   dimensions or process requirements before changing them.
4. Call `validate_script` and recheck the affected dimensions, interfaces and
   printing assumptions, even for a one-number edit. Keep temporary candidates
   and subassembly diagnostics validation-only.
5. When the revised version is ready for user review, call `execute_script`.
   The viewer will display the new mesh and clear the old annotations automatically.
6. Call `capture_view`, inspect useful views and follow
   [verification and handoff](verification-and-handoff.md).
7. Briefly summarise to the user which annotations you addressed and
   how. If you decided not to act on one (e.g. the change would break
   another constraint), say so explicitly.
