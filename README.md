# manifold-mcp

<!-- TODO: uncomment badges after first publish
[![CI](https://github.com/zhicwan/manifold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/zhicwan/manifold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zhicwan/manifold-mcp)](https://www.npmjs.com/package/@zhicwan/manifold-mcp)
-->
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
![Node.js >= 20](https://img.shields.io/badge/Node.js-%E2%89%A5%2020-green)

A [Model Context Protocol](https://modelcontextprotocol.io/) server that lets an LLM design 3D-printable models with the [manifold-3d](https://github.com/elalish/manifold) library, validate them through a multi-stage pipeline, and stream the result to a live three.js preview page in the user's browser. Export STL or 3MF directly from the preview.

<!-- TODO: add screenshot or GIF -->

## Install as a plugin

### Claude Code

```bash
claude plugin install zhicwan/manifold-mcp
```

### GitHub Copilot CLI

```
/plugin install zhicwan/manifold-mcp
```

Both methods clone the repo, discover the MCP server from `.mcp.json`, and register the `use-manifold` skill automatically.

## Use as a standalone MCP server

```bash
npx @zhicwan/manifold-mcp
```

Or add to your MCP client config (`.mcp.json`):

```json
{
  "mcpServers": {
    "manifold-mcp": {
      "command": "npx",
      "args": ["-y", "@zhicwan/manifold-mcp"]
    }
  }
}
```

## Highlights

- **Two MCP tools**:
  - `validate_script` — fast pre-flight (~1–2 s) for the AI to iterate
    without thrashing the user's preview.
  - `execute_script` — runs the snippet, validates the resulting Manifold,
    and pushes the mesh to the live preview page.
  - `get_annotations` — reads the user's active marks on the current model.
- **YAML diagnostic report** — every tool returns a structured report
  (errors, warnings, hints, stats, `previewUrl`) that LLMs find easy to
  read and self-correct against.
- **TypeScript-only snippets** — compiled inside the sandbox with ambient
  globals for `Manifold`, `CrossSection`, `Mesh`, `console`, and `result`.
- **Multi-stage validation pipeline**: static lint → TypeScript
  typecheck/compile → sandboxed execution (5 s timeout, 512 MB heap) →
  geometric checks → print-readiness hints.
- **Live three.js preview** with `Export 3MF` and `Export STL`.
  WebSocket reconnection replays the latest mesh.
- **Companion skill** at `skills/use-manifold/` (symlinked to
  `.github/skills/use-manifold/` for Copilot CLI). The skill name is
  `use-manifold`; it requires the `manifold-mcp` MCP server.

## Architecture

```
┌─────────┐  stdio   ┌──────────────────────────┐
│   LLM   │ ───────> │  MCP Server (Node)       │
└─────────┘          │  ┌────────────────────┐  │
                     │  │ validate_script    │  │
                     │  │ execute_script     │  │
                     │  └────────┬───────────┘  │
                     │           │ run req      │
                     │  ┌────────▼───────────┐  │
                     │  │ runner/host        │──┼─► fresh worker_threads.Worker
                     │  │ (1-slot serialise) │  │   ├─ manifold WASM (await Module())
                     │  │ + 5 s kill watchdog│  │   ├─ static AST lint
                     │  │                    │  │   ├─ TypeScript compile (in-memory)
                     │  │                    │  │   ├─ user code (new Function)
                     │  └────────┬───────────┘  │   ├─ validators
                     │           │ mesh payload │   └─ garbage-collector cleanup
                     │  ┌────────▼───────────┐  │
                     │  │ preview/server     │  │
                     │  │ HTTP / + WS /ws    │  │
                     │  │ caches latest mesh │  │
                     │  └────────┬───────────┘  │
                     └───────────┼──────────────┘
                                 ▼
                              browser (React + three.js)
                               Export 3MF / STL
```

## Security model

> **TL;DR**: Snippets are untrusted LLM-generated code. The isolation is
> defense-in-depth, not a hardened sandbox.

- Each snippet runs in a dedicated `worker_threads` Worker with:
  - A **5-second timeout** — exceeding it kills the worker.
  - A **512 MB hard heap limit** (`maxOldGenerationSizeMb`).
- **`MANIFOLD_MCP_SCRIPT_ROOTS`** restricts which directories `filePath`-based
  scripts may be read from. Never grant access to directories containing
  credentials or sensitive data.
- Static lint catches common API mistakes but is **not** a security boundary.
- The live preview server binds to **loopback (localhost) only**.
- No telemetry or analytics are collected. See [SECURITY.md](SECURITY.md)
  for the full threat model and how to report vulnerabilities.

## Configuration

| Environment variable | Description |
| --- | --- |
| `MANIFOLD_MCP_NO_OPEN` | When set to any non-empty value, suppresses the automatic browser open on first `execute_script`. |
| `MANIFOLD_MCP_SCRIPT_ROOTS` | Platform-separator-delimited list of directories that `filePath` may reference. Defaults to CWD + `samples/`. |

## Samples

Sample scripts live in [`samples/`](samples/). Run one with:

```json
{
  "tool": "execute_script",
  "arguments": {
    "filePath": "/absolute/path/to/manifold-mcp/samples/01-hello-cube.ts"
  }
}
```

## Development

```bash
git clone https://github.com/zhicwan/manifold-mcp.git
cd manifold-mcp
npm ci
npm run build
npm test
```

| Command | Description |
| --- | --- |
| `npm run build` | Full build (viewer + server + sandbox types) |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run format` | Prettier formatting |
| `npm test` | Unit + smoke tests |
| `npm run dev` | Vite dev server for the viewer |

### Local development with the lazy-npx `.mcp.json`

The checked-in `.mcp.json` runs `npx -y @zhicwan/manifold-mcp`, which
fetches the published package. To test your local changes instead:

```bash
npm run build
npm link
# Now npx @zhicwan/manifold-mcp resolves to your local checkout
```

### Windows symlink note

The `.github/skills/use-manifold` directory is a git-tracked symlink to
`../../skills/use-manifold`. On Windows, enable symlinks:

```bash
git config --global core.symlinks true
```

This requires Developer Mode or administrator privileges.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branch workflow,
and how to add samples.

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Zhicheng Wang.

See [NOTICE](NOTICE) for upstream attribution.

### Upstream

This project uses and adapts portions of
[elalish/manifold](https://github.com/elalish/manifold) (Apache-2.0):
- `src/server/sandbox/garbage-collector.ts`
- Documentation under `skills/use-manifold/references/`
