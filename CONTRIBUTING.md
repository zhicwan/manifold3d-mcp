# Contributing to manifold-mcp

Thank you for your interest in contributing!

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- npm (ships with Node.js)

## Getting started

```bash
git clone https://github.com/zhicwan/manifold-mcp.git
cd manifold-mcp
npm ci
```

## Local plugin development

Plugin files live under `plugin/`. Build the local server first, then load that
plugin folder in your client:

```bash
npm run build
copilot plugin install ./plugin
claude --plugin-dir ./plugin
```

`plugin/.mcp.json` runs `plugin/bin/manifold-mcp.mjs`. The proxy prefers the
local `dist/server/index.js` build and falls back to `npx -y
@zhicwan/manifold-mcp` for public installs. If a cached plugin install cannot
see your checkout, start the client with an explicit local entry:

```bash
MANIFOLD_MCP_LOCAL_ENTRY="$PWD/dist/server/index.js" copilot
```

## Scripts

| Command                          | Description                                          |
| -------------------------------- | ---------------------------------------------------- |
| `npm run build`                  | Full build (viewer + server + sandbox types)         |
| `npm run plugin:build`           | Alias for the full build before local plugin testing |
| `npm run plugin:copilot:install` | Build, then install `./plugin` into Copilot CLI      |
| `npm run typecheck`              | TypeScript type checking (all projects)              |
| `npm run lint`                   | ESLint                                               |
| `npm run lint:fix`               | ESLint with auto-fix                                 |
| `npm run format`                 | Prettier formatting                                  |
| `npm run format:check`           | Prettier check (CI)                                  |
| `npm test`                       | Unit + smoke tests                                   |
| `npm run test:unit`              | Unit tests only                                      |
| `npm run test:smoke`             | Smoke tests (builds first)                           |
| `npm run test:watch`             | Unit tests in watch mode                             |

## Adding a sample

1. Create a new `.ts` file in `samples/` following the existing naming
   convention (`NN-descriptive-name.ts`).
2. Use the ambient types from `samples/manifold-sandbox.d.ts`.
3. Assign the final `Manifold` to a variable named `result`.

## Updating sandbox types

If you change the sandbox API surface, regenerate the ambient declarations:

```bash
npm run build:sandbox-types
```

This updates `samples/manifold-sandbox.d.ts` and
`plugin/skills/use-manifold/references/manifold-sandbox.d.ts`.

## Branch and PR workflow

1. Branch from `main`.
2. Make your changes and ensure all checks pass:

   ```bash
   npm run build && npm run typecheck && npm run lint && npm test
   ```

3. Open a pull request. Squash merge only; all CI checks must pass.

## Publishing

Publishing to npm is automated via GitHub Actions when a version tag (`v*`) is
pushed. The `NPM_TOKEN` repo secret is required (maintainer-only).
