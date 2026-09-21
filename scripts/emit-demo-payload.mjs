#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { format, resolveConfig } from 'prettier';
import { Runner } from '@manifold3d/modeling/runner/host.js';
import { toViewerModelFrame } from '@manifold3d/modeling/runner/model-artifact.js';
import { createModelHeader, decodeViewerModel } from '@manifold3d/protocol/wire/model.js';

// Author the union here; the browser receives only its generated ViewerModel.
const code = `
result = Manifold.union([
  Manifold.cube([80, 50, 8], true).translate([0, 0, 4]),
  Manifold.cube([80, 8, 42], true).translate([0, 21, 25]),
  Manifold.cylinder(18, 12, 12, 48, true).translate([-18, -8, 15]),
  Manifold.cylinder(26, 4, 4, 32, true).translate([22, -10, 19]),
]);`;
const labels = {
  'cube#1': 'plate#1',
  'cube#2': 'wall#1',
  'cylinder#1': 'boss#1',
  'cylinder#2': 'pin#1',
};
const target = new URL('../packages/viewer/src/demo-payload.ts', import.meta.url);
const runner = new Runner();
try {
  const { artifact, report } = await runner.run({ mode: 'execute', description: 'Demo bracket (union)', code });
  if (!report.ok || !artifact) {
    throw new Error(`Demo bracket generation failed: ${JSON.stringify(report)}`);
  }
  const frame = toViewerModelFrame(artifact);
  const model = decodeViewerModel(createModelHeader(frame), frame);
  model.features = model.features.map(feature => {
    const label = labels[feature.label];
    if (!label) {
      throw new Error(`Unexpected demo feature: ${feature.label}`);
    }
    return { ...feature, label, params: {} };
  });
  const fields = Object.entries(model).map(([key, value]) => {
    // Nine significant decimal digits round-trip Float32 values exactly.
    const data = ArrayBuffer.isView(value)
      ? `new ${value.constructor.name}(${JSON.stringify(
          Array.from(value, number => (value instanceof Float32Array ? Number(number.toPrecision(9)) : number)),
        )})`
      : JSON.stringify(value);
    return `${key}: ${data}`;
  });
  const output = await format(
    `// AUTO-GENERATED from scripts/emit-demo-payload.mjs. DO NOT EDIT.
// Regenerate with npm run build:demo-payload.
import type { ViewerModel } from '@manifold3d/protocol/wire/model.js';

export function buildDemoPayload(): ViewerModel {
  return { ${fields.join(',\n')} };
}
`,
    { ...(await resolveConfig(target.pathname)), parser: 'typescript', endOfLine: 'lf' },
  );
  if (process.argv.includes('--check')) {
    if ((await readFile(target, 'utf8')) !== output) {
      throw new Error('Offline demo fixture is stale. Run npm run build:demo-payload.');
    }
  } else {
    await writeFile(target, output);
  }
} finally {
  await runner.dispose();
}
