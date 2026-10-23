# Fix and Attach in DeepSeek Harness

The 3D Viewer tab has two separate delivery actions. Keep them distinct:

- **Fix** queues the saved annotation batch as a new input for you. It arrives
  as a trigger message that starts with a revision request followed by the
  complete static JSON snapshot. Queueing is not confirmation that the edit is
  finished.
- **Attach** sends nothing. The Viewer writes the same kind of static snapshot
  to a numbered file in the session workspace's `.manifold3d/` directory
  (`notes-<n>.json` for annotation batches, `loc-<n>.json` for location
  selections, `measure-<n>.json` for measurements) and adds an
  `@.manifold3d/<file>.json` reference to the user's message draft.
  The user can remove it or add instructions before sending. When a message
  you receive contains such a reference, read that file; it is the context the
  user attached.

Location selections (**Select to chat**, point or region) and ruler
measurements use the Attach path with modes `location-selection` and
`measurement`. Annotation batches use mode `annotation-batch` for both Attach
and Fix.

## Interpreting snapshots

Snapshots carry the model version, annotation revision, display marker numbers
and selected geometry. Marker display numbers are not annotation ids.
Measurement items carry structured evidence: operands, methods, mm distances and
witness endpoints, and classified angles. Prefer the bounded `summary`, operand
`feature` labels and `display.primary` when interpreting what the user saw.
Operand order records selection order, but never guess which operand should move
when an edit is ambiguous; ask the user to clarify. `edge-corner` is the angle
between rays leaving the shared endpoint (0-180 degrees); other direction methods
remain smaller unoriented angles (0-90 degrees). Supporting-plane distances do
not claim finite-face clearance, and `extended` witnesses may lie outside a
patch. Point operands with `faceCenter` refer to a connected planar face's area
centroid.

Replacing the model clears live results; delivered snapshots remain historical
evidence and must not be reassociated with a new model. A location or
measurement attachment alone is not an instruction to edit.

## When applying a delivered request

Use the [design workflow](../references/design-workflow.md) to identify the
requested change and the dimensions/function to preserve. Clarify a conflict
with a confirmed interface or manufacturing constraint instead of silently
overriding it.

Validate geometry edits with `manifold_validate_script`; temporary candidates
and diagnostics can remain validation-only. Before showing a revised version,
recheck affected fit, wall thickness and process assumptions, then call
`manifold_execute_script` and `manifold_capture_view`. Follow
[verification and handoff](../references/verification-and-handoff.md);
a queued Fix is not evidence that the new geometry or print has been verified.
