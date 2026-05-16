# manifold-mcp

<!-- TODO: uncomment badges after first publish
[![CI](https://github.com/zhicwan/manifold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/zhicwan/manifold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zhicwan/manifold-mcp)](https://www.npmjs.com/package/@zhicwan/manifold-mcp)
-->

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
![Node.js >= 24](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-green)

An MCP server and plugin that lets an LLM design 3D-printable models with
[manifold-3d](https://github.com/elalish/manifold), validate the generated
TypeScript, and preview/export STL or 3MF in the browser.

## Demo

<!-- TODO: add GIF demo -->

## Easy install

### GitHub Copilot CLI

Install from the marketplace:

```text
/plugin add manifold-mcp
```

Or install directly from this repository:

```text
/plugin install zhicwan/manifold-mcp:plugin
```

### Claude Code

```bash
claude --plugin-dir ./plugin
```

### Standalone MCP server

```bash
npx @zhicwan/manifold-mcp
```

Or add it to `.mcp.json`:

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

## Contribute setup

```bash
git clone https://github.com/zhicwan/manifold-mcp.git
cd manifold-mcp
npm ci
npm run build
npm test
```

After building, the repo-root `.mcp.json` runs the local MCP server from
`dist/server/index.js`, and `.github/skills/` points to `plugin/skills/` for
local skill discovery.

See [CONTRIBUTING.md](CONTRIBUTING.md) for scripts, local plugin development,
branch workflow, and sample authoring.

## Features

- MCP tools for validating scripts, executing scripts, and reading preview
  annotations.
- Live three.js preview with STL and 3MF export.
- TypeScript snippets with ambient `Manifold`, `CrossSection`, and `Mesh`
  globals.
- Multi-stage validation: static lint, TypeScript compile, sandboxed execution,
  geometry checks, and print-readiness hints.
- Companion `use-manifold` skill under `plugin/skills/use-manifold/`.

## Configuration

| Environment variable        | Description                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `MANIFOLD_MCP_NO_OPEN`      | When set to any non-empty value, suppresses the automatic browser open on first `execute_script`.             |
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

## Other notes

- Snippets are untrusted LLM-generated code. They run in a dedicated
  `worker_threads` Worker with a 5-second timeout and 512 MB heap limit.
- The preview server binds to loopback only.
- No telemetry or analytics are collected.
- See [SECURITY.md](SECURITY.md) for the full threat model and how to report
  vulnerabilities.

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Zhicheng Wang.

See [NOTICE](NOTICE) for upstream attribution.

### Upstream

This project uses and adapts portions of
[elalish/manifold](https://github.com/elalish/manifold) (Apache-2.0):

- `src/server/sandbox/garbage-collector.ts`
- Documentation under `plugin/skills/use-manifold/references/`
