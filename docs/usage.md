# Using Manifold 3D

[English](usage.md) | [简体中文](usage.zh-CN.md) · [Back to README](../README.md)

Describe your model to an assistant, validate the generated TypeScript, inspect
the result, and export STL. The two plugins share a modeling engine but use
different preview and feedback workflows.

## Installation

### Requirements and host choice

- **Node.js 24 or later**, available to the host that runs the plugin.
- **Native Canvas:** Copilot CLI / Copilot app with Canvas support.
- **MCP/browser:** Copilot CLI or Claude Code. Other stdio MCP clients can use
  the standalone release below.

Plugins include the runtime, Worker, WASM, Viewer resources, and a host-specific
modeling skill. Plugin installation does not run npm or download dependencies.
Canvas is a host capability; installing an MCP server does not add it.

### Copilot: native Canvas

```sh
copilot plugin marketplace add zhicwan/manifold3d-mcp
copilot plugin install manifold-extension@manifold3d-mcp
```

Ask the assistant to use Manifold and open the **Manifold 3D Viewer** Canvas.
This plugin registers `manifold_validate_script`, `manifold_execute_script`,
and `manifold_capture_view`, with the `use-manifold-canvas` skill. It does not
start an MCP server.

### Copilot CLI: MCP with browser Viewer

```sh
copilot plugin marketplace add zhicwan/manifold3d-mcp
copilot plugin install manifold@manifold3d-mcp
```

### Claude Code: MCP with browser Viewer

Run inside Claude Code:

```text
/plugin marketplace add zhicwan/manifold3d-mcp
/plugin install manifold@manifold3d-mcp
```

The MCP plugin includes the `use-manifold` skill and tools `validate_script`,
`execute_script`, `get_annotations`, and `capture_view`. Successful execution
returns a `previewUrl` for the browser Viewer. Optional XR belongs to this
browser experience, not the native Canvas.

### Standalone MCP

Download `manifold.mjs` from [GitHub Releases](https://github.com/zhicwan/manifold3d-mcp/releases).
Configure your stdio MCP client to launch:

```sh
node /absolute/path/to/manifold.mjs
```

Use `node` as the command and the absolute artifact path as its argument in
your client's MCP configuration. No adjacent resource files or `node_modules`
are needed. The standalone process inherits its launch working directory.
The separate `extension.mjs` artifact requires the Copilot extension host;
it is not a standalone application.

### Updates and migration

New versions come from this repository, not npmjs.org. Use your host's plugin
update command. Older npm releases remain unchanged.

Before replacing an older installation:

1. Remove the old manually configured `npx` MCP server if switching to the
   `manifold` plugin.
2. Remove a user-installed copy of the extension if switching to
   `manifold-extension`, so the same tools are not registered twice.
3. Start a fresh host session and check that the intended plugin's tools are
   available.

The two plugins have distinct skills and can be installed separately. You do
not need both; if both are installed, tell the assistant which workflow to use.

## Your first model

Try this prompt:

```text
Use Manifold to design a parametric phone stand in millimeters: 80 mm wide,
85 mm deep, with a 6 mm base, a backrest tilted 20 degrees from vertical,
and a centered 14 mm front cable slot. Keep the key dimensions as named
parameters. Validate the script, preview the model, and inspect a rendered
view before showing me the result.
```

The useful loop is **describe → validate → execute → inspect → revise**:

1. Give dimensions, fit requirements, and the intended use.
2. Have the assistant validate the script and compare reported dimensions with
   your request. Validation alone does not update the preview.
3. Execute the validated script. In Canvas, open the panel; for MCP, open the
   returned `previewUrl` if the browser did not open.
4. Inspect useful angles, including a rendered capture. Ask for a specific
   revision, such as “Widen the cable slot to 22 mm; keep everything else unchanged.”
5. Repeat validation and inspection after changes, then export.

The assistant writes the code, but you can keep and edit it. Scripts use
millimeters by convention, use the provided `Manifold`, `CrossSection`, and
`Mesh` globals, and assign the final solid to `result` without redeclaring it.
Do not add imports or exports. A small valid snippet is:

```ts
const size: [number, number, number] = [20, 20, 10];
result = Manifold.cube(size);
```

See [samples](../samples/README.md) for complete designs and the English
[script reference](../skills/shared/references/script-conventions.md) for sandbox rules.

## Example: widen a cable slot

| Before: 14 mm slot                                                                                 | After: 22 mm slot                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| ![Software-rendered phone stand with a narrow 14 mm front cable slot](assets/phone-stand-14mm.png) | ![Software-rendered phone stand with the front cable slot widened to 22 mm, retaining the same backrest and base](assets/phone-stand-22mm.png) |

_Software-rendered model comparison; see the Canvas interaction example below._

Both versions measure approximately **80 × 85 × 91.6 mm**, with a 6 mm base
and a backrest tilted 20° from vertical. Widening the slot removes more material
at the front without changing the outer dimensions, backrest, or side supports.

To reproduce the comparison:

1. Open the [phone stand source](../samples/05-phone-stand.ts). Ask the assistant to
   read it and pass its contents as inline `code` to your plugin's validation
   tool, then execute it.
2. Inspect the preview and capture an `iso` view.
3. Change `cableSlotWidth` from `14` to `22`; validate, execute, and capture again.
4. Compare the front opening and confirm that the rest of the model is unchanged.

To request this kind of revision interactively, use the Canvas or MCP feedback
workflow below.

## Working from local files

**Inline `code` is the simplest option for either plugin.** Ask the assistant
to read your local script using its workspace tools and pass the content as
`code`. Host permissions still apply when it reads the file.

| Workflow      | Accepted script source                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Native Canvas | Inline `code` only; no `filePath`                                                                    |
| MCP           | Exactly one of inline `code` or an absolute `filePath` to a supported script inside authorized roots |

For an installed MCP plugin, do not assume the server starts in your project.
Copilot starts it in the plugin directory; Claude can retain the project
directory. A file being visible to the assistant does **not** authorize the
MCP server to read it.

To use `filePath`, set **`MANIFOLD_MCP_SCRIPT_ROOTS` in the MCP server's
environment** to the directories you intend to authorize. Use absolute
directories; separate multiple roots with `:` on macOS/Linux or `;` on Windows.
For example, a standalone macOS/Linux launch is:

```sh
MANIFOLD_MCP_SCRIPT_ROOTS="/absolute/path/to/my-models" \
  node /absolute/path/to/manifold.mjs
```

For installed plugins, set the variable through the host's server environment
configuration or launch environment; restart the MCP server after changing it.
Roots are cached for the process lifetime. Only authorize directories you need,
not your entire home directory or filesystem.

Without an explicit setting, the defaults are the server's working directory
and its `samples/` subdirectory—not a guessed project root. With an explicit
setting, it replaces the working-directory default; `<server CWD>/samples`
is still added. Roots must exist, and paths are checked after resolving
symlinks. The server does not broaden access automatically.

After authorizing your directory, ask the assistant to validate the absolute
file path, then execute it. A `FILE_NOT_ALLOWED` error means you should use
inline code or correct the server's explicit roots, not try relative paths.

## Point at what you mean

### Native Canvas feedback

- **Select to chat:** select a point or region. Its location is attached to
  the composer without sending a message, and the Viewer returns to browsing.
  Add your request and send it when ready.
- **Annotate:** add notes to model locations. **Attach** puts a saved annotation
  batch in the composer without sending. **Fix** sends that batch directly as
  a revision request.
- Attachments are snapshots. Editing a note later does not change a previously
  attached snapshot. A successful Fix send means the request was accepted,
  not that the assistant has finished modifying the model.

#### Select to chat example

![Two crops showing a selected cable-slot point, the location-attached confirmation, and a composer attachment with an unsent request to widen the slot to 26 mm](assets/phone-stand-selection.png)

_Two crops from the same Canvas screenshot: selected location and unsent revision request._

The current model has a **22 mm** cable slot. The selected cable-slot location
is attached to the composer alongside an **unsent request to widen it to 26 mm**.
This shows a draft revision request, not an executed model change.

### MCP browser feedback

Use **Annotate** to mark a point or region and save a note. Then ask the assistant
to read your annotations with `get_annotations` and apply the change.
This is not Canvas's selection-to-chat or Fix/Attach workflow.

### Viewer controls

With the Viewer focused:

| Key or gesture    | Action                                |
| ----------------- | ------------------------------------- |
| **V**             | Browse                                |
| **M**             | Annotate                              |
| **S**             | Select a location, when supported     |
| **F**             | Fit the model                         |
| Hold **Space**    | Temporarily orbit while marking       |
| Middle/right drag | Pan                                   |
| Mouse wheel       | Zoom                                  |
| **?**             | Show remaining gestures and shortcuts |

Numbered anchors reveal their notes on demand. In the note editor, the check
button or **Enter** saves; the cross or **Escape** cancels the current edit.
**Shift+Enter** adds a line. Typing in a note does not switch Viewer tools.

## Export and printing

Choose **Export → Export STL** in the Viewer. Open the STL in your slicer,
check its dimensions in millimeters, and review orientation, supports, wall
thickness, clearances, and material choice. For multipart designs, inspect and
arrange the separate parts before printing.

**STL is the supported model export format.** STEP and 3MF are not supported.
Keep the TypeScript source if you want to change parameters later; STL is the
mesh output, not a parametric project file.

Validation checks scripts and geometry. It does not certify load capacity,
manufacturing quality, food contact, animal safety, or suitability for any
particular use. A successful report and an attractive preview are not substitutes
for inspecting and testing the actual print.

## Troubleshooting and further reading

- **No Canvas?** Check that your Copilot host supports Canvas and that you
  installed `manifold-extension`, not just `manifold`.
- **No tools or duplicate tools?** Check the selected plugin, Node version,
  and older manual installations. Restart the host after configuration changes.
- **Validation failed?** Ask the assistant to fix the reported error and
  validate again before execution. See the English
  [validation report reference](../skills/shared/references/validation-report.md).
- **Need SDK integration or local development?** See the English
  [Extension README](../apps/copilot-extension/README.md) and
  [CONTRIBUTING.md](../CONTRIBUTING.md). They own the technical details.
