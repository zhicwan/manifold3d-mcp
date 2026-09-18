import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Runner } from '@manifold3d/modeling/runner/host.js';
import { afterAll, describe, expect, it } from 'vitest';

const references = resolve(import.meta.dirname, '../skills/shared/references');

function examples(file: string): string[] {
  return Array.from(readFileSync(resolve(references, file), 'utf8').matchAll(/```ts\r?\n([\s\S]*?)```/g), match => {
    const code = match[1];
    assert(code !== undefined, `Missing TypeScript block in ${file}`);
    return code;
  });
}

const memory = examples('memory-management.md');
const tips = examples('tips.md');
const models = examples('examples.md');
const openBox = models[2];
const openVase = models[4];
const roundedPlate = models[5];
assert(openBox !== undefined, 'Missing open-box example');
assert(openVase !== undefined, 'Missing open-vase example');
assert(roundedPlate !== undefined, 'Missing rounded-plate example');

function parameter(code: string, name: string, value: number): string {
  const declaration = new RegExp(`const ${name} = [^;]+;`);
  assert(declaration.test(code), `Missing ${name} parameter`);
  return code.replace(declaration, `const ${name} = ${value};`);
}

const boxChecks = `
const [width, depth, height] = outerSize;
const innerArea = (width - 2 * wall) * (depth - 2 * wall);
const sectionVolume = (z: number): number => result.slice(z).extrude(1).volume();
if (Math.abs(sectionVolume(bottom / 2) - width * depth) > 0.01) {
  throw new Error('floor section must fill the outer footprint');
}
for (const z of [bottom + 0.1, height / 2, height - 0.1]) {
  if (Math.abs(sectionVolume(z) - (width * depth - innerArea)) > 0.01) {
    throw new Error('wall sections must match the specified interior');
  }
}
const floorProbe = Manifold.cube([1, 1, 0.1]).translate([width / 2, depth / 2, bottom - 0.2]);
if (Math.abs(result.intersect(floorProbe).volume() - 0.1) > 0.0001) {
  throw new Error('floor must reach the specified bottom thickness');
}
const cavityProbe = Manifold.cube([width - 2 * wall - 0.2, depth - 2 * wall - 0.2, height - bottom + 1])
  .translate([wall + 0.1, wall + 0.1, bottom + 0.1]);
if (result.intersect(cavityProbe).volume() > 0.0001) {
  throw new Error('the interior and top opening must be empty');
}
const expectedVolume = width * depth * height - innerArea * (height - bottom);
if (Math.abs(result.volume() - expectedVolume) > 0.01) {
  throw new Error('box volume must match its walls and floor');
}
`;

const vaseChecks = `
const polygonAreaFactor = 96 * Math.sin(2 * Math.PI / 96) / 2;
const radiusAt = (z: number): number => {
  if (z <= shoulderHeight) return baseRadius + (shoulderRadius - baseRadius) * z / shoulderHeight;
  if (z <= neckHeight) return shoulderRadius + (neckRadius - shoulderRadius) *
    (z - shoulderHeight) / (neckHeight - shoulderHeight);
  return neckRadius + (rimRadius - neckRadius) * (z - neckHeight) / (height - neckHeight);
};
const floorRadius = radiusAt(bottom / 2);
if (Math.abs(result.slice(bottom / 2).extrude(1).volume() - polygonAreaFactor * floorRadius ** 2) > 0.01) {
  throw new Error('floor section must be solid');
}
for (const z of [shoulderHeight / 2, (shoulderHeight + neckHeight) / 2, (neckHeight + height) / 2]) {
  const radius = radiusAt(z);
  const expectedArea = polygonAreaFactor * (radius ** 2 - (radius - wall) ** 2);
  if (Math.abs(result.slice(z).extrude(1).volume() - expectedArea) > 0.01) {
    throw new Error('vase sections must preserve the stated radial wall separation');
  }
}
const floorProbe = Manifold.cube([1, 1, 0.1]).translate([0, 0, bottom - 0.2]);
if (Math.abs(result.intersect(floorProbe).volume() - 0.1) > 0.0001) {
  throw new Error('vase floor must reach the specified thickness');
}
const interiorProbe = Manifold.cube([1, 1, height - bottom + 1]).translate([0, 0, bottom + 0.1]);
if (result.intersect(interiorProbe).volume() > 0.0001) {
  throw new Error('vase must have an empty interior and open mouth');
}
`;

describe('shipped skill reference examples', () => {
  const runner = new Runner();
  afterAll(() => runner.dispose());

  it('includes all expected runnable examples', () => {
    expect(memory).toHaveLength(1);
    expect(tips).toHaveLength(3);
    expect(models).toHaveLength(8);
  });

  it.each([
    { name: 'managed cleanup', code: memory[0], size: [10, 10, 50], volume: 5000 },
    { name: 'restored millimetre scale', code: tips[0], size: [0.1, 0.1, 0.1], volume: 0.001 },
    { name: 'composed degree rotations', code: tips[1], size: [30 / Math.SQRT2, 30, 30 / Math.SQRT2], volume: 6000 },
    { name: 'radian conversion', code: tips[2], size: [30 / Math.SQRT2, 30 / Math.SQRT2, 30], volume: 6000 },
  ])('$name produces the intended geometry without cleanup failures', async ({ name, code, size, volume }) => {
    assert(code !== undefined, `Missing ${name} example`);
    const { report } = await runner.run({ mode: 'validate', code }, { timeoutMs: 15_000 });
    expect(report.ok, JSON.stringify(report.errors)).toBe(true);
    expect(report.hints.some(hint => hint.includes('GC_DELETE_FAILED'))).toBe(false);
    expect(report.stats?.volume).toBeCloseTo(volume, 4);
    size.forEach((length, axis) => {
      expect(report.stats?.bbox.size[axis]).toBeCloseTo(length, 5);
    });
  });

  it.each(models.map((code, index) => ({ code, number: index + 1 })))(
    'geometry example $number runs as a complete sandbox snippet',
    async ({ code }) => {
      const { report } = await runner.run({ mode: 'validate', code }, { timeoutMs: 15_000 });
      expect(report.ok, JSON.stringify(report.errors)).toBe(true);
      expect(report.stats?.volume).toBeGreaterThan(0);
      expect(report.hints.some(hint => hint.includes('GC_DELETE_FAILED'))).toBe(false);
    },
  );

  it.each([
    { name: 'default', code: openBox },
    { name: 'thicker walls and floor', code: parameter(parameter(openBox, 'wall', 2.4), 'bottom', 3) },
  ])('open box: $name has the promised walls, floor and opening', async ({ code }) => {
    const { report } = await runner.run({ mode: 'validate', code: `${code}\n${boxChecks}` }, { timeoutMs: 15_000 });
    expect(report.ok, JSON.stringify(report.errors)).toBe(true);
    expect(report.stats?.bbox.min).toEqual([0, 0, 0]);
    expect(report.stats?.bbox.size).toEqual([40, 30, 20]);
  });

  it.each([
    { name: 'default', code: openVase },
    { name: 'thicker walls and floor', code: parameter(parameter(openVase, 'wall', 3), 'bottom', 4) },
  ])('open vase: $name has a floor, radial walls and an open interior', async ({ code }) => {
    const { report } = await runner.run({ mode: 'validate', code: `${code}\n${vaseChecks}` }, { timeoutMs: 15_000 });
    expect(report.ok, JSON.stringify(report.errors)).toBe(true);
    expect(report.stats?.bbox.min[2]).toBeCloseTo(0, 5);
    [50, 50, 90].forEach((size, axis) => expect(report.stats?.bbox.size[axis]).toBeCloseTo(size, 5));
  });

  it.each([4, 6])('rounded plate preserves the outer envelope with radius %s', async radius => {
    const code = parameter(roundedPlate, 'radius', radius);
    const checks = `
const holeCenters: Vec2[] = [[-22, 10], [22, 10], [-22, -10], [22, -10]];
for (const [x, y] of holeCenters) {
  const probe = Manifold.cylinder(6, 1, 1, 32).translate([x, y, -1]);
  if (result.intersect(probe).volume() > 0.0001) {
    throw new Error('plate holes must remain open through the full thickness');
  }
}
`;
    const { report } = await runner.run({ mode: 'validate', code: `${code}\n${checks}` }, { timeoutMs: 15_000 });
    expect(report.ok, JSON.stringify(report.errors)).toBe(true);
    expect(report.stats?.bbox.size).toEqual([60, 30, 4]);
  });

  it.each([
    { name: 'zero box wall', code: parameter(openBox, 'wall', 0) },
    { name: 'box without interior height', code: parameter(openBox, 'bottom', 20) },
    { name: 'vase without interior neck', code: parameter(openVase, 'wall', 12) },
  ])('rejects invalid example parameters: $name', async ({ code }) => {
    const { report } = await runner.run({ mode: 'validate', code }, { timeoutMs: 15_000 });
    expect(report.ok).toBe(false);
    expect(report.errors.some(error => error.message.includes('must leave an open interior'))).toBe(true);
  });
});
