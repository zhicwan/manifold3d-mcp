# Manifold Copilot CLI Extension

This private workspace builds the production Copilot CLI Extension as exactly
one discovery artifact:

```text
apps/copilot-extension/dist/extension.mjs
```

The artifact embeds the production, flat Viewer asset tree, manifold JavaScript
and WASM, and the TypeScript standard-library declarations used by the modeling
worker. `@github/copilot-sdk/extension` is the only host-provided package import;
Node built-ins remain native. The same `.mjs` is both the extension entry point
and its `worker_threads` model worker.

## Build and verify

```bash
npm run build:extension
npm run test:extension
npm run verify:extension
```

`verify:extension` copies the artifact into an otherwise empty directory and
runs `node extension.mjs --self-test` under Node's filesystem permission model.
The self-test initializes embedded WASM, executes a cube and a failing snippet
with source-line mapping, serves and hashes
every embedded Viewer asset, checks two isolated rooms and action idempotency,
and closes the worker, rooms, and host. The verifier also asserts that `dist/`
contains only `extension.mjs`, inspects imports/chunks, and reports raw/gzip and
embedded resource sizes. Production `session.shutdown`, join-race, pending-send,
and signal behavior is covered by the mock-SDK integration tests rather than
claimed by this low-level self-test.

## Installation

The normal distribution is the self-contained `manifold-extension` plugin:

```sh
copilot plugin marketplace add zhicwan/manifold3d-mcp
copilot plugin install manifold-extension@manifold3d-mcp
```

It contains the single runtime and its Canvas skill. No MCP server or npm
installation is added by this plugin. For local development, build with
`npm run build:plugins` and load `plugins/manifold-extension` using the host's
`--plugin-dir` support.

SDK hosts must explicitly opt into the surfaces they support on session
creation: `requestExtensions` and `requestCanvasRenderer`. Loading installed
plugin configuration also requires `enableConfigDiscovery`; an SDK host can
instead supply trusted `pluginDirectories` explicitly. These options default off.

### Standalone discovery file for development

```bash
npm run extension:install
copilot
```

The install script copies the built file to
`$COPILOT_HOME/extensions/manifold3d/extension.mjs` (default:
`~/.copilot/extensions/manifold3d/extension.mjs`). Restart Copilot CLI after
rebuilding, then ask it to open the **Manifold 3D Viewer** Canvas. Canvas panel
rendering remains a manual host proof unless the host is actually exercised;
the Node self-test does not claim to render the host iframe.
Do not enable this user-scoped copy and the plugin copy together: they register
the same tools.

## Tools and captures

The Extension registers `manifold_validate_script`,
`manifold_execute_script`, and `manifold_capture_view`. Script tools require
inline `code`; local `filePath` loading is intentionally deferred. Captures are
written beneath the active Copilot session workspace at
`files/manifold3d-captures/` and returned as a path.

Each Viewer room exposes these host actions:

- `attach-annotation-batch` in `annotation-batch`
- `fix-annotation-batch` in `annotation-batch`
- `attach-location-selection` in `selection-gesture`
- `attach-measurement` in `measurement-result`
- `open-in-manifoldcad` in the toolbar
- `export-model-file` as the export handler

`open-in-manifoldcad` builds a share URL from the exact successful script and
description associated with the model displayed in that room, then opens it in
the system default browser. Source is retained per room, including rooms opened
after a model commit. URL-size and browser-launch failures are reported through
the Viewer action status rather than treated as successful launches.

Batch actions require explicit `annotationIds` and input
`{ "batchId": "<safe-id>", "markerNumbers": [1, 2] }` (one display number per id).
Both capture a bounded version 5 static snapshot
with mode `annotation-batch`, the model version, annotation revision, batch id,
selected geometry, and notes. `attach-annotation-batch` adds exactly one
`extension_context` composer pill and does not send a message.
Saved nonempty measurement comments join the same batch/count/Done/Attach/Fix
workflow as point and region comments; mixed batches are supported. Their
selection is `{ kind: "measurement", measurement: <structured evidence>,
worldCoord: [x, y, z] }`, preserving both evidence and the marker anchor.
Batch ids and marker display numbers retain their ordinary meanings. Measurement
items without a non-whitespace note cannot enter a batch attachment. Pure ruler
results remain independent of comment batches, and cancelling a batch restores
the measurement's pre-batch note without deleting the dimension.
`fix-annotation-batch` never adds a pill: it sends a clear revision request and
the complete serialized snapshot in the actual message `prompt`, with a readable
`displayPrompt` and `mode: "enqueue"`. It reports accepted, running, and terminal
status through the Viewer Host request. Success means the SDK accepted the
enqueue, not that the agent completed the model changes.

Retransmitting the same request id does not attach or enqueue twice. A failed
send reports a failed action so the Viewer can restore the batch for a manual
retry, without leaving a composer pill behind. There is no automatic retry or
exactly-once guarantee if a network acknowledgement is lost.

`attach-location-selection` requires exactly one point or region annotation
whose note is empty, with input `{ "markerNumbers": [1] }`.
Its single version 5 pill uses mode `location-selection`,
omits `batchId` and comment text, and records only the selected location.
Snapshots are validated against the room's committed model version and
annotation revision before dispatch. Saving or editing annotations alone never
adds pills, and the Extension does not rewrite transformed prompts or maintain
live attachment tokens. Browser-local `commentBase`, `attachedNote`, `sentNote`
and `pendingDelivery` never enter the snapshot or message prompt. Only a
successful completion owned by the current Viewer operation updates its local
delivery receipt.

`attach-measurement` requires exactly one explicit measurement `annotationIds`
entry and input `{ "markerNumbers": [1] }`. Its version 5, mode `measurement`
pill stores structured `measurement` evidence under `annotations[0]`, with an
optional/empty note, model version and annotation revision. Canonical operands,
distance witnesses in mm, supporting-plane methods/extensions, and angle methods
are preserved separately from prose. `edge-corner` is the angle between rays
leaving the unique shared endpoint of two edges (0-180 degrees); other methods
remain smaller unoriented angles (0-90 degrees). The
snapshot is validated, detached and bounded to 128 KiB. Attach adds a composer
pill without sending a message. Measurement comments join ordinary annotation
batches, whose Attach and Fix actions preserve the same structured evidence.
Saving or editing a comment alone never sends anything.
Location-selection attachments still reject measurements: clicking a ruler with
Select to chat invokes the dedicated measurement attachment action instead.
Replacing the model clears live
measurements but cannot rewrite already attached historical snapshots.
The MCP browser exposes completed measurements through `get_annotations` YAML;
it does not offer composer pills or active Fix delivery. These actions are
available only when the host advertises them. Software capture supports witness lines and
method/value labels; angle labels do not imply a physical intersection arc.

The Canvas prioritizes this location-selection path over commented batches.
A valid selection is one-shot: the tool returns to browsing while delivery is
pending, and cannot be rearmed until that selection finishes. Delivery feedback
describes attachment, not message sending or completion of a model edit. Late
results cannot change a replacement model's annotations or the user's next tool.
Commented batches remain available through Annotate; Attach and Fix retain their
distinct side effects. Numbered on-model anchors are presentation, not wire ids.

Shutdown drains pending programmatic fix sends for a bounded interval. Explicit
disconnect has its own timeout, while parent `SIGTERM` performs local cleanup
without requesting disconnect from the dying SDK parent. Session shutdown is
observed through `JoinSessionConfig.onEvent`, registered before join can emit
early events. SDK timeline logging is best effort and cannot poison action
delivery.

## Experimental Canvas embedding exception

`Canvas` in the pinned `@github/copilot-sdk` version is experimental, and the SDK does not
expose the parent frame origin. This Extension therefore opts into
`ViewerHostOptions.allowAnyFrameAncestor`, which emits `frame-ancestors *`.
This reviewed exception is limited to the Extension composition. Access still
requires an unguessable room URL, the server binds only to loopback, HTTP Host
and WebSocket Host/Origin/credential checks remain strict, responses use
`Referrer-Policy: no-referrer`, and no wildcard (or other) CORS header is sent.
Normal `frameAncestors` entries must be exact HTTP(S) origins; wildcard
hostnames are rejected. The MCP/default ViewerHost policy remains
`frame-ancestors 'none'`.

Both application workspaces are private. The generated MCP and Extension
plugins are distributed separately from this repository, with bundled dependency
license notices retained in each runtime.
