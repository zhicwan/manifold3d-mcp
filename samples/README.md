# Manifold 3D samples

[English](README.md) | [简体中文](README.zh-CN.md) · [Back to project](../README.md)

Explore parametric 3D models you can run, inspect, and adapt. Each file is a
self-contained TypeScript snippet for the Manifold sandbox that assigns a
single `Manifold` to `result`; that object may contain multiple separate parts.
The scripts typecheck against `samples/tsconfig.json` and work with either
plugin when passed as inline `code`.

The numbered prefix indicates difficulty (lower = simpler). Browse 01-04
to learn the API, then try the intermediate phone stand in 05.
The 90-series contains larger reference designs.

## Difficulty curve

| File                                                             | What it shows                                           | APIs exercised                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [01-hello-cube.ts](01-hello-cube.ts)                             | Smallest valid sandbox script                           | `Manifold.cube`, `scale`                                                                                                              |
| [02-revolve-vase.ts](02-revolve-vase.ts)                         | 2D profile → 3D solid via revolve                       | `CrossSection.ofPolygons`, `Manifold.revolve`                                                                                         |
| [03-levelset-gyroid.ts](03-levelset-gyroid.ts)                   | Implicit surface from an SDF                            | `Manifold.levelSet`                                                                                                                   |
| [04-warp-and-refine.ts](04-warp-and-refine.ts)                   | Smooth deformation of a refined mesh                    | `Manifold.sphere`, `refine`, `warp`                                                                                                   |
| [05-phone-stand.ts](05-phone-stand.ts)                           | Intermediate phone stand with an adjustable cable slot  | `CrossSection.square`, `offset`, `ofPolygons`, `extrude`, `Manifold.union`, `subtract`                                                |
| [90-dsa-keycap-set-108.ts](90-dsa-keycap-set-108.ts)             | Full ANSI 108-key DSA keycap set                        | `Manifold.cube`, `cylinder`, `sphere`, `extrude`, `hull`, `union`, `subtract`, `translate`, `rotate`, `CrossSection.square`, `offset` |
| [91-instax-mini-fridge-frame.ts](91-instax-mini-fridge-frame.ts) | Two-piece magnetic fridge frame                         | `Manifold.cube`, `cylinder`, `extrude`, `subtract`, `translate`, `rotate`, `add`, `CrossSection.square`, `ofPolygons`, `offset`       |
| [92-k2-terrain.ts](92-k2-terrain.ts)                             | Heightmap terrain via `Mesh`                            | `new Mesh`, `Manifold.ofMesh`                                                                                                         |
| [97-gecko-rock-terraces.ts](97-gecko-rock-terraces.ts)           | Four-part gecko hide with stairs and an arched platform | `Manifold.hull`, `difference`, `union`, `compose`, `decompose`, `CrossSection.ofPolygons`, `offset`, `extrude`                        |

## Gecko rock terraces

`97-gecko-rock-terraces.ts` preserves the assembled, upright design: a
170 x 120 x 65 mm hollow hide with a 55 mm arched doorway and six rear corner
vents, two 50 mm-wide stair flights, and a 100 x 100 mm platform at Z = 100 mm.
The complete assembly occupies 170 x 291.7 x 100 mm.

The output contains four separate connected components: the hide, ground stair,
upper stair, and platform with its arched supports. Split them into separate
objects before arranging print plates. Print the hide roof-down, both stairs
tread-up, and the platform top-down; each part fits within a 256 mm build volume.
Roof joints allow a 0.15 mm adhesive gap. Adhesive compatibility, full cure,
edge finishing, stability, material opacity, and ventilation still need to be
assessed for the actual print and enclosure.
These are geometric design checks, not load, animal-safety, or airflow tests.

## Running a sample

Install a plugin using the [usage guide](../docs/usage.md#installation), then
download a sample or use a local checkout.

**Native Canvas:** ask the assistant to read the sample and pass its contents as
inline `code` to `manifold_validate_script`, then `manifold_execute_script`.
Canvas does not accept `filePath`.

**MCP:** inline `code` is also the simplest option. Ask the assistant to use
`validate_script`, then `execute_script`. To load a file directly instead, use
an **absolute path** and explicitly authorize its directory in the MCP server's
`MANIFOLD_MCP_SCRIPT_ROOTS` environment before starting the server:

```sh
MANIFOLD_MCP_SCRIPT_ROOTS="/absolute/path/to/manifold3d-mcp/samples" \
  node /absolute/path/to/manifold.mjs
```

This example launches the standalone MCP release. For installed plugins, set
the same variable through the host's server environment or launch environment
and restart the server. Copilot starts plugin servers in the plugin directory;
Claude can retain the project directory. Do not assume your checkout is
authorized just because the assistant can read it. See
[local file access](../docs/usage.md#working-from-local-files) for root rules.

After authorization, an MCP tool call looks like:

```json
{
  "name": "validate_script",
  "arguments": {
    "filePath": "/absolute/path/to/manifold3d-mcp/samples/01-hello-cube.ts"
  }
}
```

Execute only after validation succeeds, inspect the preview and a rendered
capture, then use **Export → Export STL**. Review dimensions, printing setup,
and intended-use safety yourself; geometry validation is not a safety certification.

## Adding a new sample

1. Create `samples/NN-my-sample.ts` (pick the next free number for the difficulty slot).
2. Start with a top-comment block: title, one-line description, `// APIs:` line.
3. Assign the final manifold to `result` (no `import`/`export`).
4. Run `npx tsc -p samples/tsconfig.json --noEmit` to typecheck.
5. Validate with the appropriate plugin's inline `code` tool, or MCP
   `validate_script` with an absolute `filePath` inside an explicitly authorized root.
