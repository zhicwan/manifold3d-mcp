# Getting Started

> Source: [manifold/bindings/wasm/documents/bindings.md](https://github.com/elalish/manifold/blob/master/bindings/wasm/documents/bindings.md)
> (Apache-2.0). Adapted for the manifold3d-mcp sandbox.

## You do **not** need to install or initialize anything

In a stand-alone manifold project you would write:

```ts
import Module from 'manifold-3d';
const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection } = wasm;
```

Inside either plugin's sandbox, snippets are **TypeScript-only** and `Manifold`,
`CrossSection`, `Mesh`, `console`, and `result` are **already pre-bound as
ambient globals**. Do **not** write `import` or `export` statements — module
syntax is blocked by the static lint and will fail with `FORBIDDEN_GLOBAL`.

A minimal valid snippet is therefore one line:

```ts
result = Manifold.cube([20, 20, 20], true);
```

`result` is the only output channel: whatever Manifold instance you assign to
`result` is what the validator inspects and what the preview renders.

> **Don't redeclare `result`.** It is already declared by the sandbox, so
> `let result = …`, `const result = …`, and `var result = …` all fail
> typecheck with `TS2451: Cannot redeclare block-scoped variable 'result'`.
> Just write `result = …`.

## The intro example, in sandbox form

The official intro example becomes:

```ts
const { cube, sphere } = Manifold;
const box = cube([100, 100, 100], true);
const ball = sphere(60, 100);
result = box.subtract(ball);
```

Notice: no `delete()` calls, no top-level `await`, and no module syntax. The
typecheck stage compiles this TypeScript before runtime, so API
shape mistakes (for example object-style constructor arguments) are reported
without running the snippet.

## Design before code

Use [the design workflow](design-workflow.md) to decide what needs clarification.
A clear simple model does not need an interview; unresolved functional dimensions
or printing constraints should not be silently invented.

## Host tools and results

| Host   | Validate without changing preview | Execute and publish                                             | Script source                                                  |
| ------ | --------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| MCP    | `validate_script`                 | `execute_script`, with a `previewUrl` on success                | Exactly one of inline `code` or authorized absolute `filePath` |
| Canvas | `manifold_validate_script`        | `manifold_execute_script`, publishing to open Manifold Canvases | Inline `code` only                                             |

Both use the shared YAML validation report. Read the selected skill entry for
capture, opening the preview and feedback tools; those contracts are host-specific.
For installed MCP plugins, prefer inline code. A file must already be inside an
authorized script root; neither relative paths nor guessing parent roots is valid.
For Canvas, read any workspace file with the host's file tools and pass its content
as `code`.

See [`validation-report.md`](validation-report.md) for the report schema.
Geometry success is not manufacturing approval; use
[verification and handoff](verification-and-handoff.md).
