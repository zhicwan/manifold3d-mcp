# manifold-mcp samples

This directory holds parametric model samples for the manifold-mcp sandbox. Each
file is a self-contained TypeScript snippet that produces a single
`Manifold` and assigns it to `result`. They typecheck against
`samples/tsconfig.json` and run as-is via `validate_script` /
`execute_script` with `filePath`.

The numbered prefix indicates difficulty (lower = simpler). Browse 01-04
to learn the API; 90-92 are full reference designs.

## Difficulty curve

| File | What it shows | APIs exercised |
|------|---------------|----------------|
| `01-hello-cube.ts` | Smallest valid sandbox script | `Manifold.cube`, `scale` |
| `02-revolve-vase.ts` | 2D profile → 3D solid via revolve | `CrossSection.ofPolygons`, `Manifold.revolve` |
| `03-levelset-gyroid.ts` | Implicit surface from an SDF | `Manifold.levelSet` |
| `04-warp-and-refine.ts` | Smooth deformation of a refined mesh | `Manifold.sphere`, `refine`, `warp` |
| `90-dsa-keycap-set-108.ts` | Full ANSI 108-key DSA keycap set | `Manifold.cube`, `cylinder`, `sphere`, `extrude`, `hull`, `union`, `subtract`, `translate`, `rotate`, `CrossSection.square`, `offset` |
| `91-instax-mini-fridge-frame.ts` | Two-piece magnetic fridge frame | `Manifold.cube`, `cylinder`, `extrude`, `subtract`, `translate`, `rotate`, `add`, `CrossSection.square`, `ofPolygons`, `offset` |
| `92-k2-terrain.ts` | Heightmap terrain via `Mesh` | `new Mesh`, `Manifold.ofMesh` |

## Running a sample

```bash
# Through the MCP server: pass the absolute path as filePath.
# The server accepts paths under MANIFOLD_MCP_SCRIPT_ROOTS (default = CWD + samples/).
```

Pass the absolute path to `validate_script` or `execute_script`:

```json
{
  "name": "validate_script",
  "arguments": {
    "filePath": "/absolute/path/to/manifold-mcp/samples/01-hello-cube.ts"
  }
}
```

## Adding a new sample

1. Create `samples/NN-my-sample.ts` (pick the next free number for the difficulty slot).
2. Start with a top-comment block: title, one-line description, `// APIs:` line.
3. Assign the final manifold to `result` (no `import`/`export`).
4. Run `npx tsc -p samples/tsconfig.json --noEmit` to typecheck.
5. Validate through the MCP server with `validate_script { filePath: "..." }`.
