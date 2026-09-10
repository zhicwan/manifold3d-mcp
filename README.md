# Manifold 3D

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
![Node.js >= 24](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-green)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/zhicwan/manifold3d-mcp)

Two plugins that let an agent design 3D-printable models with
[manifold-3d](https://github.com/elalish/manifold), validate the generated
TypeScript, and preview/export STL. Both share the same modeling engine.

## Install

Node.js 24 or later is required. Plugins include their runtime code, Worker,
WASM and Viewer resources; installation does not run npm or download dependencies.

| Plugin               | Experience                                                 | Supported hosts                               |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `manifold`           | MCP tools, browser Viewer with optional XR, modeling skill | Copilot CLI and Claude Code                   |
| `manifold-extension` | Native Canvas, annotation messages and modeling skill      | Copilot CLI / Copilot app with Canvas support |

For Copilot, register the marketplace and choose the experience you want:

```sh
copilot plugin marketplace add zhicwan/manifold3d-mcp
copilot plugin install manifold-extension@manifold3d-mcp
# Or use the MCP/browser experience:
copilot plugin install manifold@manifold3d-mcp
```

For Claude Code:

```text
/plugin marketplace add zhicwan/manifold3d-mcp
/plugin install manifold@manifold3d-mcp
```

The Extension does not start an MCP server. Its **Fix** action sends the saved
annotation batch directly as a message; **Attach** adds a pill to the composer
without sending. The plugins have distinct skills and can be installed separately.

New versions are distributed from this repository, not npmjs.org. Update with
your host's plugin update command. Existing npm versions are unchanged; remove
an old manually configured `npx` MCP server or user-installed extension before
replacing it with the corresponding plugin, to avoid duplicate tools.

### Standalone MCP

GitHub releases also provide `manifold.mjs`, which a stdio MCP client can start
with `node /absolute/path/to/manifold.mjs`. No adjacent resource files or
`node_modules` are required. `extension.mjs` requires the Copilot extension host;
it is not a standalone app.

Prefer inline `code` when using an installed MCP plugin. Hosts do not agree on
the server's working directory: Copilot uses the plugin directory, while Claude
can retain the project directory. To use `filePath` outside that directory,
explicitly authorize roots with `MANIFOLD_MCP_SCRIPT_ROOTS`; the server never
guesses a project root or broadens file access.

## Point at what you mean

The Viewer turns a point or region on the model into context for your AI
conversation. In the Extension, **Select to chat** attaches a location without
sending a message, then returns to browsing. In the MCP browser, **Annotate**
combines a location with a note for the agent's `get_annotations` workflow.

Small numbered anchors reveal their notes on demand. The compact editor saves
with the check button or Enter; the cross or Escape cancels the current edit.
Shift+Enter adds a line. Committed notes remain readable but cannot change
already-attached snapshots.

While the Viewer is focused, **V** browses, **M** annotates, **S** selects a
location when supported, and **F** fits the model. Hold **Space** to temporarily
orbit while marking. Middle/right drag still pans and the wheel zooms.
**?** opens the remaining gestures and shortcuts; typing in a note never changes
the active tool.

Use **Language** in the top toolbar to switch between **English** and **简体中文**.

## Development

```sh
git clone https://github.com/zhicwan/manifold3d-mcp.git
cd manifold3d-mcp
npm ci
npm run build:plugins
npm test
```

After building, the repo-root `.mcp.json` runs the local MCP server from
`apps/manifold3d-mcp/dist/manifold.mjs`.

`apps/` contains the MCP and Copilot compositions. `packages/` contains only
protocol, modeling, Viewer and Viewer Host. XR is an optional Viewer subpath,
not a dependency of the flat or Extension Viewer.

Edit skill sources under `skills/`. `build:plugins` copies the common references
and two short, host-specific entries into complete `plugins/` directories.
Those generated directories are committed alongside their sources. Do not edit
generated files or use cross-plugin symlinks.

For repository changes, start with [AGENTS.md](AGENTS.md). The
[architecture](docs/architecture.md) and [change guide](docs/change-guide.md)
explain ownership, design choices and how to choose meaningful evidence.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the build/release workflow and
[the Extension README](apps/copilot-extension/README.md) for Canvas integration.

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Zhicheng Wang.

See [NOTICE](NOTICE) for upstream attribution.

### Upstream

This project uses and adapts portions of
[elalish/manifold](https://github.com/elalish/manifold) (Apache-2.0):

- `packages/modeling/src/sandbox/garbage-collector.ts`
- Documentation under `skills/shared/references/`
