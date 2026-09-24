# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People inspecting AI-generated 3D-printable models, checking dimensions and
communicating intended changes back to an AI assistant.

## Product Purpose

Make model inspection and geometric feedback possible without learning a full
CAD authoring environment. Measurements describe the current model, not a
manufacturing guarantee.

## Operating Context

The same Viewer runs in a standalone MCP browser and a Copilot Canvas.
The Canvas host can append explicit static attachments to a conversation;
the MCP host exposes annotations through its own tool workflow.

## Capabilities and Constraints

The measurement scope is points, straight mesh edges and planar patches.
Two straight edges with one shared endpoint show the angle between rays leaving
that endpoint (0-180 degrees), independent of edge ordering. Thus a 120-degree
bracket corner reads 120 degrees, not its 60-degree supplement. Disjoint edges,
edge-plane and plane-plane relations retain smaller unoriented angles (0-90).
This does not infer reflex angles or material-side interior angles from arbitrary
mesh normals. The evidence explicitly distinguishes corner and direction angles.
Hovering a planar face exposes its area center for point-to-point measurement.
Surface centers and ordinary points share the same small sphere. Centers in
holes or beyond concave boundaries are not offered. Continuous curved-surface
facets do not each advertise a center; small real flat faces remain eligible.
Measurement lines, highlights and spheres uniformly use the existing blue
spatial accent, adapting to light/dark themes. Marker opacity stays subdued;
green is not used to distinguish measurement endpoints.
Hover previews do not send messages. Selecting an edge immediately retains its
length; selecting another object updates that same result into a relationship.
Measure creates and manages labels without opening comment editors. Annotate
opens a label's comment editor, and Select attaches its structured measurement
directly when the host supports it. Orbit labels provide hover/focus feedback;
clicking toggles geometry-only inspection so angle operands remain legible without
giving the label an editing/selection state. Clicking the model clears inspection.
The ruler sits directly above zoom in the view-tools group, separated from
annotation controls.
Results remain on the current model. Values sit inline within projected
dimension lines, including during hover. A short hint replaces the measurement
Detached measurement evidence includes the same rounded primary reading the
user saw, a deterministic summary and semantic feature labels when the model
provides them. Planar origins use patch area centroids rather than arbitrary
triangle corners. Operand order records selection order only; if an edit request
does not identify which side may move, the assistant must ask rather than infer. A short hint replaces the measurement
panel; its only action is Exit. Candidate ranking drives direct picking, without
a separate candidate-choice menu. Clicking a dimension in Annotate opens the
shared note editor. No technical information panel or per-result restart tool is
shown. Measurement notes join the ordinary bottom Attach/Fix batch; there is no
per-measurement Send changes action. Select-to-attach remains a separate direct
evidence action. Measurement alone never requests a change. Comment edits remain
local drafts until explicitly delivered to chat.
An attached label remains editable; past attachments are immutable snapshots.
Only measurements with a nonempty comment or a successful attachment show the
shared annotation number; plain measurements show the value alone and do not
reserve a number. Numbers follow the order measurements first enter the shared
annotation stream, not the order their geometry was measured.
Labels preview their note on
hover or keyboard focus, without opening an editor. A paperclip indicates an
attachment; no redundant comment icon is shown. A dashed border
indicates newer comment edits than the attached snapshot. Sending a modification
has its own receipt and is not shown as an attachment.
Hosts without a message channel save feedback for the assistant to read,
without claiming to have sent it.
Hovering an object without a reading uses spatial highlighting only, not an
internal geometry-type label. Measurement UI inherits the existing annotation
editor implementation, not a separately styled copy: draft/cancel behavior,
keyboard handling, textarea growth, placement and localization share the same
comment controller and view. Empty measurement notes never delete the dimension.
Typing is not saved until Enter/check or an outside dismissal; Escape/cross
reverts to the saved note.
Saving a nonempty measurement note joins the ordinary notes batch alongside
point and region comments; pure dimensions are excluded. Clearing a note leaves
the dimension but removes it from the batch. Done saves locally without a host
message. Batch Cancel restores measurement notes to their pre-batch state and
keeps their geometry; it still discards ordinary new comments. Attach creates
only a static pill; Send/Fix requires a nonempty instruction and only enqueues
the request. Receipts change only after successful delivery.
Bottom-islands owns the measurement hint or notes actions at a 24 px bottom
inset across viewport widths, with status/errors above when needed. The same
operation does not produce duplicate feedback. On-model editors remain anchored
to their marks.
Readings have the existing marker border. Editors start as a single line with
compact capability-aware action icons beside the input. A small model-space
offset uses the largest common free radial sector at both endpoints and the
midpoint, all using the same perpendicular-plane basis. The entire displaced
dimension segment is also checked for intervening obstacles. If a sector's
middle is blocked, another verified opening is chosen; if none exists the
dimension is not forcibly offset. It is fixed to the geometry, not recalculated from
camera direction or empty areas of the screen.
Model highlights and endpoints obey depth occlusion. Dimension strokes use solid
visible portions and subdued dashed occluded portions; numeric labels remain readable.
Model replacement clears measurements and prompts remeasurement. Circular
fitting, reflex-angle selection and cross-version feature tracking are not
part of the first release.

## Product Principles

- Show what is selected before committing it.
- Keep the model primary and reveal detail only when requested.
- Distinguish mesh measurements, supporting planes and construction intent.
- Preserve established camera and annotation interactions.
- Treat attaching evidence and requesting a model change as different actions.

## Evidence on Hand

Existing Viewer source and model payloads define current behavior. The local
demo is inspection material, not a manufacturing-accuracy benchmark.
