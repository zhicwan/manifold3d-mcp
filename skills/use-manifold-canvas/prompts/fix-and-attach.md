# Using Fix and Attach explicitly

The Canvas workflow has two separate actions and it is important not to blur
them together:

- **Fix** sends the saved annotation batch directly as the model-edit request.
- **Attach** adds a pill to the composer and does not send the edit request.

For location-only context, **Select to chat** is the primary Canvas tool:
press **S**, then click a point or drag a region. A valid selection attaches
once and returns to browsing; it does not send a message. Use **M** for notes,
**V** to browse, or hold **Space** to temporarily navigate while marking.

Numbered anchors open one compact note card at a time. The check button or
Enter saves that note; the cross or Escape cancels the edit. Committed ordinary
comments can be inspected but not changed; measurement notes remain editable,
without changing any previously delivered snapshot. Marker display numbers are
not annotation ids.

Measure creates/manages ruler labels without opening comments. Choose **Annotate**
and click a ruler label to write a comment in the same note card as other
annotations. Saving a nonempty measurement comment adds it to the ordinary
note batch and count, alongside point and region comments. **Done**, **Attach**
and **Fix** act on that same batch, including mixed batches. Measurement selections
carry structured evidence and the marker's world-coordinate anchor, not just prose.
Cancelling a batch restores each measurement's pre-batch note without deleting
its dimension. Ruler results without comments remain independent of note batches.
Clearing a measurement comment removes it from the notes batch, not from the
model. Done only saves locally; it does not attach context or send a message.

Use **Select to chat** and click a ruler to attach the complete measurement
directly. This dedicated measurement attachment adds one static pill without
sending; its instruction may be empty. It is not a point/region location-selection
attachment. Measurement comments join the ordinary note batch; use batch
**Attach** or **Fix** according to the user's explicit intent. Batch notes must
always be nonempty. Saving or editing a field alone does not send. SDK enqueue
acceptance is not confirmation that the model edit is finished.
Previously attached measurements remain editable in Annotate. New edits do not
change old composer pills; Select to chat explicitly creates another snapshot.
Numbered measurement labels preview their note on hover; a paperclip marks an
attached snapshot. A dashed label border
after editing means the current comment is newer than its attached snapshot.
Use its structured operands, methods, mm distances/witnesses and angles, not just
its label or note. Prefer its bounded `summary`, operand `feature` labels and
`display.primary` when interpreting what the user saw. Operand order records
selection order, but never guess which operand should move when an edit is
ambiguous; ask the user to clarify. `edge-corner` is the angle between rays leaving the shared
endpoint (0-180 degrees); reversing endpoint or selection order does not change it.
Other direction methods remain smaller unoriented angles (0-90 degrees), not
solid interior angles. Supporting-plane distances do not
claim finite-face clearance, and `extended` witnesses may lie outside a patch.
Point operands with `faceCenter` refer to a connected planar face's area centroid.
The Viewer offers only actual surface centers.
Replacing the model clears live results; attached snapshots remain historical
evidence and must not be reassociated with a new model. A measurement alone is
not an edit request. MCP instead exposes results through `get_annotations`;
it cannot actively send modifications or add composer pills. That tool is not
available in this Canvas host.

## Rules of thumb

1. Use **Fix** when the user wants you to apply their notes to the current
   model.
2. Use **Attach** when the user wants to add supporting context, point at a
   region, or keep extra guidance with the next request.
3. Fix includes the complete saved snapshot in its message, not just a request
   that refers to an attachment.
4. Use the supplied snapshot instead of emulating MCP `get_annotations`.
5. Choose Fix or Attach for a batch. Fix does not consume other composer pills;
   to combine attached context with extra instructions, send the composer
   message manually.

## When applying a delivered request

Use the [design workflow](../references/design-workflow.md) to identify the
requested change and the dimensions/function to preserve. Clarify a conflict
with a confirmed interface or manufacturing constraint instead of silently
overriding it. A location attachment alone is not an instruction to edit.

Validate geometry edits with `manifold_validate_script`; temporary candidates
and diagnostics can remain validation-only. Before showing a revised version,
recheck affected fit, wall thickness and process assumptions, then call
`manifold_execute_script` and `manifold_capture_view`. Follow
[verification and handoff](../references/verification-and-handoff.md);
successful delivery of Fix is not evidence that the new geometry or print has
been verified.
