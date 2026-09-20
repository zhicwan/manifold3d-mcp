# Contributing

Use Node.js 24 or later and npm. npm installs development dependencies; it is
not the distribution channel for the plugins.

```sh
npm ci
npm run build:plugins
```

## Ownership

Applications compose reusable packages; `skills` is authored content and `plugins`
is generated installation output. The full ownership map and design rationale
live in [Architecture](docs/architecture.md).

Coding agents should start with [AGENTS.md](AGENTS.md) and the applicable local
guidance. Use [Making a good change](docs/change-guide.md) to identify the owner,
affected consumers and appropriate behavioral evidence.

## Build and check

| Command                            | Purpose                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `npm run build:plugins`            | Build both single-file applications and assemble plugins                  |
| `npm run build:plugins -- --check` | Build and compare without replacing committed plugin output               |
| `npm run build:mcp`                | Build the standalone MCP runtime and its browser/XR Viewer                |
| `npm run build:extension`          | Build the single-file native Extension and flat Viewer                    |
| `npm run build:sandbox-types`      | Regenerate canonical declarations and sample types                        |
| `npm run check:sync`               | Check authored skill tool lists against application tools                 |
| `npm run typecheck`                | Type-check the workspace                                                  |
| `npm run lint`                     | Lint authored code                                                        |
| `npm run format:check`             | Check authored formatting                                                 |
| `npm test`                         | Build, check generated plugins, and run behavioral and distribution tests |
| `npm run verify:extension`         | Verify the Extension can run its self-test without sibling resources      |
| `npm run verify:viewer-flat`       | Verify the flat Viewer does not include XR                                |
| `npm run dev:viewer`               | Run the demo Viewer                                                       |
| `npm run test:e2e`                 | Run isolated Chromium tests against production Viewer assets              |

The root `.mcp.json` starts `apps/manifold3d-mcp/dist/manifold.mjs`. Build first.
For local plugin development, load the assembled plugin with the host's
`--plugin-dir` option or install that directory in an isolated host configuration.
Do not replace a user's installed plugin or reload their active Canvas as part
of a build.

`clean` removes temporary build output, not the committed `plugins` directories.
Generated JavaScript and copied references should change only through the build.

Keep the complete lockfile, including optional native packages for other
platforms. If npm produces an incomplete lock from an existing platform-specific
installation, regenerate it with no workspace `node_modules` directories or
old lockfile, then rebuild the plugins. Do not repair CI with extra
platform-specific install commands.

### Browser E2E

```sh
npm ci
npx playwright install chromium
npm run build:extension
npm run test:e2e
```

On Linux, use `npx playwright install --with-deps chromium` to install Chromium's
system dependencies as well. The browser revision comes from the npm lockfile;
no system Chrome, personal browser profile, or running development server is used.
After changing Viewer sources, rebuild the Extension before testing. Packaging
removes the intermediate Viewer directory, so `test:e2e` first recreates it using
the existing production Viewer build and shared license-completion helper.
The fixture compares every asset's SHA-256
against the bundled Extension's self-test manifest before opening the browser.
Missing or stale artifacts fail explicitly; CI checks the same bytes it packages.
CI runs `verify:viewer-flat` before the production build because that proof cleans
shared application asset directories.

The suite starts a random-port loopback Viewer Host per test. Extension cases use
the production Extension composition, real modeling runner and WebSocket path,
capturing only SDK attachment/enqueue side effects. The local Done case uses a
real Viewer Host with no composer actions. Tests never install/reload an extension
or send a real Copilot message. Geometry-assisted pointer coordinates are for the
fixed union fixture and default camera, not injected measurement-store state.

Run a focused case with `npm run test:e2e -- -g "mixed batch"` or inspect the HTML
report using `npx playwright show-report`. Failures retain screenshots and traces
in ignored `test-results/e2e/` and `playwright-report/`; CI uploads both. These
paths are explicitly separate from `.test-tmp/`, which the Vitest runner deletes
before and after each invocation, so later unit/Extension/smoke runs preserve
browser evidence. Playwright fixture workspaces also use their test output path.
The measurement test also attaches a representative screenshot. Blue GPU strokes
and witness balls are checked with tolerant semantic pixel sampling, not
cross-platform screenshot equality. WebGL initialization failure fails the test.
Vitest excludes `tests/e2e/`; these tests have their own Playwright runner.
The unit/watch commands also explicitly exclude the browser directory alongside
their smoke-test filter.

The lifecycle smoke performs 20 full-page navigations with real measurement
and editor creation. It checks unique scene/editor DOM, one new WebSocket per
navigation, no page errors, and no annotation traffic during 16-frame windows
after publication settles. This is bounded lifecycle behavior evidence, not
browser heap measurement or a count of same-document observer/frame-hook disposal.

## Skills

Write shared geometry/API material in `skills/shared/references`. Keep the
MCP entry and workflows in `skills/use-manifold`, and the Canvas entry and
workflows in `skills/use-manifold-canvas`.

The build copies each entry and the shared references into that plugin's own
`skills` directory. Duplication in installation output is intentional: either
plugin must work without the repository or the other plugin. Shared filenames
must not collide with host-specific references.

Use ordinary Markdown and relative links within the assembled skill. There is
no macro language or conditional compiler. MCP's `get_annotations` workflow and
Canvas's Fix/Attach workflow are different and should remain explicit.

The sandbox declaration source is
`packages/modeling/src/sandbox/ambient-types.ts`. Regenerate it instead of
editing `.d.ts` copies. Add model examples under `samples/`, use the ambient
globals, and assign the final solid to the predeclared `result`.

## Plugin configuration

The MCP plugin shares `.claude-plugin/plugin.json` and `.mcp.json` between
Copilot and Claude. Its executable is relative to `${CLAUDE_PLUGIN_ROOT}`,
which both target clients expand. The configuration has no host-only
`type: "local"` or `tools` fields.

Executable location and working directory are different concerns. Copilot
starts plugin MCP servers in the installed plugin directory; Claude can use the
workspace directory. Prefer inline code in plugin tools. Explicitly set
`MANIFOLD_MCP_SCRIPT_ROOTS` to authorize other file roots; never derive an
authorization root by guessing a parent directory. Standalone MCP inherits its
caller's working directory.

The native Extension has a separate manifest, distinct skill name and no MCP
declaration. The GitHub marketplace lists both plugins; the Claude marketplace
lists only MCP.

## Version and release

The root private `package.json` version is the product version. The build
generates plugin/catalog versions and embeds it in the MCP runtime. Both
application workspaces are private.

1. Update the root product version when shipped behavior or content changes.
2. Run `npm run build:plugins` and include source, lockfile, metadata and generated
   plugin changes in the same PR.
3. Merge through the normal review process. Do not use a post-merge bot to
   patch missing generated output into main.
4. Tag that merged commit with the matching `v<version>`.

The release workflow uploads the two already-committed `.mjs` files. It does not
rebuild a different artifact, publish npm packages or update a distribution
branch. Marketplace installs use Git plugin directories, not release asset URLs.
Runtime dependencies must be embedded; the Copilot SDK alone remains external
for the Extension host.

Previously published npm versions remain available but no longer receive new
releases. Migration is an explicit plugin update/configuration change, never
an automatic uninstall or a hidden second MCP server.
