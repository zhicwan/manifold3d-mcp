# manifold-mcp

<!-- TODO: uncomment badges after first publish
[![CI](https://github.com/zhicwan/manifold-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/zhicwan/manifold-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@zhicwan/manifold-mcp)](https://www.npmjs.com/package/@zhicwan/manifold-mcp)
-->

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
![Node.js >= 24](https://img.shields.io/badge/Node.js-%E2%89%A5%2024-green)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/zhicwan/manifold-mcp)

An MCP server and plugin that lets an LLM design 3D-printable models with
[manifold-3d](https://github.com/elalish/manifold), validate the generated
TypeScript, and preview/export STL or 3MF in the browser.

## Easy install

```text
/plugin marketplace add zhicwan/manifold-mcp
/plugin install manifold@manifold-mcp
```

## Contribute setup

```bash
git clone https://github.com/zhicwan/manifold-mcp.git
cd manifold-mcp
npm install
npm run build
npm test
```

After building, the repo-root `.mcp.json` runs the local MCP server from
`dist/server/index.js`, and `.github/skills/` points to `plugin/skills/` for
local skill discovery.

See [CONTRIBUTING.md](CONTRIBUTING.md) for scripts, local plugin development,
branch workflow, and sample authoring.

## License

[Apache License 2.0](LICENSE) — Copyright 2026 Zhicheng Wang.

See [NOTICE](NOTICE) for upstream attribution.

### Upstream

This project uses and adapts portions of
[elalish/manifold](https://github.com/elalish/manifold) (Apache-2.0):

- `src/server/sandbox/garbage-collector.ts`
- Documentation under `plugin/skills/use-manifold/references/`
