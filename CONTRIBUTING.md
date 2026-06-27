# Contributing to manifold3d-mcp

Thank you for your interest in contributing!

## Prerequisites

- [Node.js](https://nodejs.org/) >= 24
- npm (ships with Node.js)

## Getting started

```bash
git clone https://github.com/zhicwan/manifold3d-mcp.git
cd manifold3d-mcp
npm ci
```

## Local plugin development

Plugin files live under `plugin/`. The repo-root `.mcp.json` points the
`manifold3d-mcp` MCP server at your local `dist/server/index.js`, so after
building your changes are picked up automatically:

```bash
npm run build
```

The repo ships two `.mcp.json` files with the same server name (`manifold3d-mcp`):

| File               | Command                                | Purpose                                 |
| ------------------ | -------------------------------------- | --------------------------------------- |
| `.mcp.json` (root) | `node dist/server/index.js`            | Local development against your build    |
| `plugin/.mcp.json` | `npx -y @zhicwan/manifold3d-mcp@1.0.x` | Published package for end-user installs |

When working from the repo root the local config takes precedence, so your
changes are picked up automatically after `npm run build`.

To test the published plugin experience (via `npx`), install from outside the
repo checkout:

```bash
# Copilot CLI
/plugin install zhicwan/manifold3d-mcp:plugin

# Claude Code
claude --plugin-dir /path/to/manifold3d-mcp/plugin
```

> **Note:** `dist/` is git-ignored. You must run `npm run build` at least once
> before the root `.mcp.json` can start the local MCP server.

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

## Releasing / Publishing

The npm package, plugin manifests, and `plugin/.mcp.json` range move in
lockstep. Use this semver convention:

- Patch: bug fixes only, with no MCP tool additions or behavior changes. The
  plugin launches `@zhicwan/manifold3d-mcp@1.0.x`, so compatible patch releases
  are picked up automatically.
- Minor: any new or changed MCP tool. Update the skill docs, bump all package
  and plugin manifest versions, and raise the `plugin/.mcp.json` range in the
  same change.
- Major: breaking changes.

Release steps:

```bash
npm version patch # or minor/major
git push --follow-tags
```

GitHub Actions publishes tagged releases through npm OIDC Trusted Publishing.
Before the first release, a maintainer must register this GitHub repository and
the `cd.yml` workflow as a Trusted Publisher on the package access/settings page:
https://www.npmjs.com/package/@zhicwan/manifold3d-mcp/access.

CI runs `npm run check:sync` (`scripts/check-sync.mjs`) to prevent version drift
and ensure the skill's documented tools match the MCP server's registered tools.
