# Architecture

Manifold 3D has reusable modeling and viewing capabilities, with separate host
compositions and installable plugin outputs. The goal is clear ownership and
small interfaces, not a universal harness framework.

Use [AGENTS.md](../AGENTS.md) for editing guidance,
[the change guide](change-guide.md) for choosing evidence, and
[CONTRIBUTING.md](../CONTRIBUTING.md) for commands and release procedures.
Source types and implementations remain authoritative for API details.

## Ownership and dependencies

| Location                 | Owns                                                                                                 | Does not own                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `apps/manifold3d-mcp`    | MCP input/results, stdio, file-source policy, browser launch, single-room composition                | Geometry execution or browser UI implementation        |
| `apps/copilot-extension` | Copilot SDK, Canvas rooms, message delivery, Extension entry                                         | MCP transport or a separate modeling implementation    |
| `packages/protocol`      | Versioned wire data, codecs and boundary validation                                                  | Node, React, Three.js or host SDK services             |
| `packages/modeling`      | Compilation, disposable Workers, geometry validation, artifacts, model sessions and software capture | MCP/Copilot APIs, browser state or transport lifecycle |
| `packages/viewer`        | Scene presentation, interaction, annotations, canonical exports and optional XR                      | Node services or direct host SDK calls                 |
| `packages/viewer-host`   | HTTP/WS, asset providers, authenticated rooms and action dispatch                                    | Modeling execution or browser implementation           |
| `skills`                 | Authored modeling references and host-specific skill entry points                                    | Repository-maintenance instructions                    |
| `plugins`                | Generated, self-contained installation directories                                                   | Independently maintained source                        |

Applications compose inward. Modeling, Viewer and Viewer Host share protocol,
not each other's implementations. Cross-package imports use package exports;
production source-path aliases must not create a different dependency graph for TypeScript
than for Node or the bundler.
Focused tests can reference internals without making them public package exports.

The [import rules](../eslint.config.mjs) and
[boundary regressions](../tests/package-boundaries.test.ts) support this direction.
Adding a shared abstraction requires a real responsibility and consumer;
similar-looking adapter code alone is not a reason to create another layer.

## Modeling and publication

```text
Host input
  -> ModelingSession / ModelingEngine
  -> Runner -> disposable Worker
  -> static checks -> TypeScript -> Manifold WASM -> geometry validation
  -> ModelArtifact
  -> app publication through toViewerModelFrame
  -> Viewer Host room -> browser Viewer
```

This is a data-flow map, not a distributed transaction guarantee.
[ModelingSession](../packages/modeling/src/modeling.ts) owns the current committed
artifact, its revision and operation ordering. Validation does not commit a model.
Successful execution must finish the pre-commit hook before replacing the current
model; failed execution or a rejected pre-commit hook preserves the previous one.
Post-commit subscriber failures do not undo an already committed model.

The adapters currently publish through that pre-commit hook. Keep this ordering
explicit when changing publication. Do not infer that unrelated SDK or UI side
effects can be rolled back with model state. Browser launch is a post-publication
presentation action, not a condition for committing valid geometry.

The artifact retains modeling data. The existing
[projection](../packages/modeling/src/runner/model-artifact.ts) supplies the Viewer
contract without making transports interpret arbitrary engine internals.
Session revisions, room model versions, client annotation revisions and batch
identifiers have different owners; do not treat them as interchangeable tokens.

See [session behavior](../tests/modeling-session.test.ts) and
[preview lifecycle](../tests/preview-lifecycle.test.ts).

## Geometry is not presentation state

Canonical model coordinates and Viewer/XR placement are separate. Moving or
scaling a model for immersive viewing must not change its printable geometry.
Exports use a captured payload, not the live scene mesh. The browser host downloads
the generated file through the browser, while the Extension host serializes the
same canonical payload into `session.workspacePath/exports/` and reports the
completed path. Likewise, CSS dimensions and drawing-buffer pixels are distinct
units.

The flat Viewer must not import XR implementation. The default browser entry
opts into the [XR subpath](../packages/viewer/src/xr/index.tsx) through the existing
composition slots. XR owns immersive behavior, not the entire Viewer.

Each active Viewer generation owns its scene, subscriptions and interaction APIs.
An asynchronous completion must not restore state or clear a request belonging
to a replacement generation. Disposal is not an ordinary user-operation failure.

Software capture renders a model artifact using a requested view; it is not a
screenshot of the host application. Bound rasterization by the viewport and
geometry complexity, with explicit framing, clipping and depth semantics.

Viewer localization is presentation state owned by each Viewer store. The
English/Simplified Chinese catalogs also serve imperative annotation controls
and optional XR UI; changing language must not recreate the scene or alter
canonical model, annotation or action data. Browser language changes are observed
only while the owning provider is mounted. The manual preference is intentionally
runtime-local, with no storage or global document-language mutation.

Relevant evidence includes [model export](../tests/model-export.test.ts),
[component ownership](../tests/viewer-component-ownership.test.ts),
[capture rendering](../tests/renderer.test.ts) and the existing flat-build check.

## Annotation delivery

The Viewer owns editable drafts and on-model markers. The host application owns
delivery outside the Viewer. Saving or editing a draft does not itself create
chat context.

The shared glass-island UI prioritizes actions from the advertised host
capabilities: direct location context in the Extension, commented annotations
in the MCP browser. Screen-projected anchors and compact editors are
presentation; their display numbers never replace annotation identity or model
coordinates. Input modes only take the primary pointer when explicitly armed;
camera navigation and keyboard focus retain their own boundaries.
The displayed mesh owns an indirect BVH for picking and anchor occlusion,
released with its geometry; acceleration does not reorder canonical triangle ids
or patch Three.js prototypes globally.

| Action                                  | External effect                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Extension Fix                           | Send the complete bounded snapshot in an enqueued message; no composer pill  |
| Extension Attach                        | Append a static batch pill; do not send a message                            |
| Extension location selection            | Append a location pill without a comment                                     |
| Extension measurement Attach            | Append one static structured measurement pill; optional note, no message     |
| Extension measurement Send modification | Enqueue one static measurement snapshot with a required instruction; no pill |
| MCP Done / Cancel                       | Commit or discard the local draft batch for the MCP annotation workflow      |

Completed ruler measurements share annotation identity, revision and model-version
ownership. Pure dimensions do not enter notes batches; saving a nonempty measurement
note joins the ordinary point/region notes batch, including its count, Done,
Cancel, Attach and Fix lifecycle. Clearing that note removes it from the batch
without deleting the dimension. Batch Cancel restores the measurement's pre-batch
note and delivery state while preserving geometry; ordinary new comments retain
their existing discard behavior. Wire annotation protocol 3 requires
structured evidence for `kind: "measurement"`: canonical point/finite-edge/supporting-plane
operands, mm distances and witness endpoints, and explicitly classified angles.
`edge-corner` measures rays leaving a unique shared endpoint (0-180 degrees),
independent of operand and endpoint ordering. Nearby disjoint endpoints do not
form a corner. Other angle methods retain smaller unoriented angles (0-90).
Strict parsing checks finite geometry, normalized plane normals,
method/operand combinations and numerical consistency; it does not authenticate
mesh provenance. Parallel classification uses a dimensionless sine tolerance of
`1e-5`, absorbing Float32 payload noise rather than rounded display angles.

Hovering a connected planar patch exposes its triangle-area-weighted centroid
as a snap candidate. It remains a canonical point operand with optional
`faceCenter: { patchId }` provenance, not a triangle hit or nominal
primitive center. Strict parsing preserves this reference in attachments and
MCP snapshots. Only centers lying on the actual finite face are offered;
centroids in holes or outside concave boundaries are omitted, not moved to a
different location. Centers on curved mesh facets are suppressed using a local
normal-continuation heuristic: two comparably sized adjacent patches, each
turning at most 30 degrees in opposing tangent directions. This avoids an
absolute area cutoff that would remove genuine small faces; it is not analytic
CAD feature recognition. The underlying face and edge measurements are unchanged.
The wire format still preserves off-surface reference metadata in previously
captured evidence, but the Viewer does not offer those points for new snapping.
Eligible surface centers and other snap points use small depth-tested spheres with screen-stable size.
Measurement markers and highlights use the same blue spatial accent as the
dimension strokes and adapt to the Viewer theme; endpoints do not introduce a
second green color. Centers and their
geometry resources are discarded with the owning model.

The Viewer projects dimension witnesses into CSS pixels and places the value
inline between dimension strokes; this presentation does not change canonical
evidence. Hover uses the same inline display, with only a compact operation hint.
Projected strokes retain their clip-space depth and are unprojected for two GPU
depth passes: visible portions are solid and occluded portions are subdued
dashes. Highlighted model edges and points obey depth testing; DOM readouts stay
readable independently of their line's occlusion. The owning measurement renderer
releases the dimension geometry with the model/runtime.
Selecting one edge immediately retains its length. A second selected object
replaces that untouched result with their relationship instead of accumulating
a redundant length and requiring a separate save step.
Label clicks follow the existing active tool: Measure manages labels, Annotate
opens the comment-style single-line editor, Select invokes the dedicated
measurement attachment capability, and Orbit inspects without editing or delivery.
Only Measure exposes measurement removal. Comment editing can save or explicitly
send a modification; attachment is handled by Select, without opening an editor
or creating another point annotation.
Measurement comments use the existing `FlyoutLayer`, `FlyoutController` and
`FlyoutView`, not a second editor implementation. Rendered dimension elements
register their screen anchors with that layer; the same placement, textarea
growth, localization, focus, Enter/Shift+Enter and Escape/cancel rules apply.
Typing remains an unsaved flyout draft until save/outside dismissal; cancelling
an empty measurement note preserves its geometry, unlike discarding an empty
new ordinary comment. A supported measurement send action commits the draft
through the same controller before delivering the structured snapshot.
Technical coordinates stay in structured evidence rather than an
Info panel. The reading has the same bordered marker treatment as annotations.
Placement is chosen in model space, not by the camera or blank screen regions.
The model-owned BVH samples radial occupancy at both endpoints and the midpoint,
using one shared perpendicular-plane basis. A direction must clear all three
radial paths and the complete displaced segment; this also checks obstacles
between the sample sections. The largest cyclic admissible interval determines
its offset direction, with deterministic ties and a local radius of 6% of the
segment length. The exact interval midpoint is rechecked; a failed midpoint
splits that angular interval before another opening is considered. Signed
boundary crossings distinguish material from empty space.
The result is cached with the immutable measurement evidence until geometry is
replaced. If no local opening is sampled, it stays on the measured segment
rather than inventing clearance. Camera changes only project the fixed displaced
endpoints and true 3D midpoint; even perspective does not reselect or slide the
anchor around the edge. Text rotation is independently normalized for reading.
Camera gestures temporarily suspend hover picking, then re-pick at the current
pointer while preserving the first locked operand; camera damping and zoom also
refresh the candidate without requiring another pointer movement.

Host-action protocol 3 advertises `measurement-result`. The Extension's
`attach-measurement` requires one explicit annotation id and
`input: { markerNumbers: [displayNumber] }`. Attachment version 5 includes
shared-endpoint corner-angle evidence alongside mode
`measurement` with exactly one evidence item and an optional/empty note, under
the existing 128 KiB snapshot bound. Ordinary comment Attach/Fix accepts saved
measurement notes in mixed batches as
`selection: { kind: "measurement", measurement, worldCoord }`. Each batch item
requires a non-whitespace note; pure dimensions cannot be submitted in a batch.
Location-selection still accepts only points and regions, never measurements.
The dedicated `fix-measurement` action uses
the same single-id/marker-number invocation and bounded snapshot, but requires
a non-whitespace note as the modification instruction. It shares existing Fix
send lifecycle ownership and enqueues a measurement-specific prompt without a
composer pill. Only explicit Send modification sends; instruction edits do not.
These measurement actions are host-advertised capabilities, not portable MCP
features. MCP preserves the same structured evidence in
`get_annotations` YAML, without a composer action. Model replacement clears
current measurements; an already attached snapshot remains historical evidence.
Local measurement receipts retain the last attached and sent note independently.
The Store alone applies successful receipts to the still-owning operation.
`commentBase`, `attachedNote`, `sentNote` and `pendingDelivery` are browser-local metadata, excluded
from WS snapshots, attachments and enqueued prompts. Snapshot builders detach
evidence and validate every item's model version; Viewer Host checks the current
model version and exact annotation revision before dispatch.
Editing a previously delivered measurement creates a new draft without changing
its geometry or any host snapshot. Labels show shared annotation display numbers
only when they have a nonempty comment or a successful attachment; plain
measurements remain unnumbered visually. They reuse the regular comment preview
styling on hover/focus. Notes do not require
a separate comment badge. A paperclip indicates attachment and a spinner indicates
pending delivery; an attached-note mismatch marks newer edits instead of claiming
the old attachment was updated. Failed or stale asynchronous completions cannot
add success badges or restore a replaced runtime.
The Viewer bottom-islands region owns the tool hint or notes actions at a 24 px
bottom inset, with needed status/error feedback above. A delivery failure is
presented once, not both as local feedback and the same host action status.
Direct measurement submission restores editable state and returns `failed` for
a terminal failed client status; that status owns the diagnostic. Preconditions
and interrupted requests without a terminal status throw for local Viewer feedback.
Host-action status history retains request-model ownership locally. Pending
availability and the latest visible status refer to the current model; retired
requests still settle their original promises without blocking new-model actions
or surfacing stale errors.
Software capture draws actual distance witnesses with value/method labels and
explicit extended-plane labels; corner and smaller angles are labeled distinctly
and remain text only, with no fabricated
intersection arcs. Capture remains an overlay, not a screenshot of ruler UI.

Fix success means the SDK accepted enqueueing, not that an agent finished the
requested model edit. A static attachment is not a live synchronized object.
The Viewer localizes known action IDs and status states at render time. Optional,
validated completion `resultDetails` carry annotation counts or saved model paths
from the Extension through Viewer Host; they are canonical data, not translated
messages. Raw host diagnostics and unknown host-defined labels remain intact.
Request retransmission and a user's new operation are also different cases.
Do not turn these into a speculative cross-system transaction or automatic
compensation service.

The [Extension composition](../apps/copilot-extension/src/composition.ts) and
[integration cases](../apps/copilot-extension/test/extension.integration.test.ts)
define the current delivery contract. Detailed SDK behavior belongs in the
[Extension README](../apps/copilot-extension/README.md).

## Resource and failure boundaries

Runner owns worker lifetime, including termination before returning a completed
request. Worker hardening is defense-in-depth, not OS isolation. Viewer Host owns
its connections and rooms; each app owns its transport and external side effects.
Keep cleanup with the resource owner rather than adding timeouts at every caller.

Boundary validation, origin/credential restrictions and execution budgets serve
real contracts. Removing them is not architectural simplification. Conversely,
an internal invariant failure must not become an empty result or a default model.
Use the established error/report/status form and preserve its meaning.

Cleanup may need to continue after one failure and report aggregated errors.
Logging failure must not poison successful delivery. Missing provenance can be
represented explicitly as unknown; it is not permission to accept malformed
geometry or wire data. Judge recovery by its semantics, not the presence of
`catch`, `fallback` or `undefined` in the implementation.

See [Worker behavior](../tests/runner-host.test.ts) and
[room/connection lifecycle](../tests/viewer-host-rooms.test.ts).

## Source and distribution

`build:plugins` builds both applications and then runs the
[assembler](../scripts/build-plugins.mjs). Each plugin contains its runtime,
metadata and complete skill references. Shared source is maintained once;
physical duplication in independently installable outputs is intentional.

The root package version is the product version. Generated output is never an
input to its own metadata generation. The assembler's check mode compares staged
output without replacing committed plugins; the npm command still performs its
build steps. It is not a side-effect-free command.

MCP requires Node and its bundled resources. The Extension additionally relies on
the SDK supplied by its host. Neither artifact should discover missing
dependencies by searching the checkout or downloading them at runtime.
See [build guidance](../scripts/AGENTS.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md) for the source/output and release workflow.

## Current limits, not hidden promises

- Different hosts start MCP in different working directories. Executable location
  is not workspace authorization; follow the existing file-source contract.
- Live models and Viewer draft/marker state do not have provider-restart
  persistence. Already delivered chat snapshots belong to the host instead.
- Independent iframe instances do not imply arbitrary same-document multi-view
  embedding is supported.
- Copilot Canvas and message integrations are host-specific, not portable MCP
  capabilities.

A concrete requirement can change these boundaries. Make that change explicit
in ownership, behavior, documentation and evidence instead of simulating it with
path guesses, compatibility aliases or success-shaped fallbacks.
