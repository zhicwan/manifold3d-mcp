# Manifold DeepSeek Harness Extension

This private workspace builds the DeepSeek Harness (DSH) adapter. The assembler
packages it as the Cordis bundle `plugins/manifold-dsh`:

```text
index.js          Host plugin (apply(ctx)); also the model Worker entry
client.js         Client plugin loaded by the Harness module loader
cordis.patch.yml  inserts the `manifold3d` row
locale/, icon.svg display metadata
skills/use-manifold-dsh/
```

`index.js` is built from `src/entry.ts` by `scripts/bundle-application.mjs`
and embeds the flat Viewer, manifold WASM and the TypeScript declarations used
by the Worker. Node built-ins are the only runtime imports. `client.js` is
authored as plain JavaScript in `client/` because the Harness loads it through
`window.__ModuleLoader__` with React supplied by the page.

## Build, test and install

```bash
npm run build:dsh-extension
npm run test:dsh-extension
npm run build:plugins
```

Install the generated bundle into a Harness profile with the Plugin Manager
(`install_bundle` with the absolute `plugins/manifold-dsh` directory). Replacing
an installed copy requires removing it first; Client changes load after a page
refresh. `scripts/test-installed-plugin.mjs` imports the copied bundle against a
minimal Cordis-shaped context and runs a real execution, error mapping, capture
and Viewer room.

## Host contract

The Host half uses `tools`, `connection`, `agents` and `workingDirectory`, and
optionally `webServer`, `webApp`, `attachments`, `llm` and `skills`.
`src/dsh-boundary.ts` lists the exact fields; there is no DSH type package.

- **Per-session state.** One Host process serves every session, so modeling
  state is keyed by the calling Agent's session id and created lazily. A model
  executed in one session is never published to another session's Viewer.
  `agent/disposed` disposes that session's `ModelingSession`; open rooms keep
  their last frame and later actions report that the session is not active.
- **Tools.** `manifold_validate_script`, `manifold_execute_script` and
  `manifold_capture_view` accept the same arguments as the Copilot Extension.
  Values are lossless JSON; a failed report or invalid argument is thrown as a
  tool failure whose message is the JSON body. Publication uses the existing
  `beforeCommit` hook. Captures are admitted through `attachments.saveImages`
  when the current model declares image input, otherwise saved under
  `<cwd>/.manifold3d/captures/` and reported by path.
- **Viewer rooms.** A single loopback `ViewerHost` starts on first use with
  `frame-ancestors` limited to the Harness Web origin and the Desktop shell
  origin `dsh-app://app`. Rooms are keyed by `(sessionId, tabId)` and created
  through authenticated routes on `connection.fetch`:

  | Route                                 | Purpose                                  |
  | ------------------------------------- | ---------------------------------------- |
  | `POST /api/manifold3d/rooms`          | Open or reuse the room for a tab         |
  | `DELETE /api/manifold3d/rooms`        | Close it when the tab record is removed  |
  | `GET /api/manifold3d/insertions`      | Long-poll pending composer insertions    |
  | `POST /api/manifold3d/insertions/ack` | Report whether the composer accepted one |

  Routes return 403 when the connection admits remote authorities: the Viewer is
  loopback-only. Opening requires a live Agent for the session (409 otherwise);
  a tab deleted while its room is starting is closed instead of leaked.

## Viewer actions

- **Fix** builds the bounded version 6 snapshot and calls
  `agent.followup()` with source kind `manifold3d-fix`. Success means the input
  was queued; it appears in Chat as a turn trigger.
- **Attach**, **location selection** and **measurement** write the snapshot to
  the next free `<cwd>/.manifold3d/{notes,loc,measure}-<n>.json` (exclusive create,
  so existing files are never overwritten)
  and ask the tab's Client body to insert `@<relative path>` into the composer
  draft with `inputActions.captureInsertion/insertText`. The action succeeds
  only after the Client acknowledges the insertion. Each pending insertion is
  claimed by exactly one poll. A refusal, or a closed tab or 10 s timeout before
  any poll claimed it, fails the action and deletes the file. When a poll
  claimed it but no acknowledgement arrived, the reference may already be in
  the draft, so the action fails as unconfirmed and keeps the file. Nothing is
  sent and no model context changes until the user sends the message.
- **Export** writes to `<cwd>/exports/`; **Open in ManifoldCAD** opens the
  share link for the source displayed in that room.

## Limits

- The Viewer is reachable only from the machine running the Harness.
- The embedded Viewer follows the system theme and browser language, not the
  Harness settings.
- Attachment and capture files are written with Node's local filesystem; a
  remote filesystem provider is not supported.
- Live models do not survive a Harness restart; reopened tabs show an empty
  Viewer until the next execution.
