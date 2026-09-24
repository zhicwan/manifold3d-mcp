import { test, expect } from './extension-fixture.js';
import { attachMeasurement, attachmentPayload, label, modelPoint, openViewer } from './viewer-helpers.js';
import { parseAnnotationAttachment } from '../../apps/copilot-extension/src/annotation-attachment.js';

test('a real 120-degree bracket corner shows and attaches 120 degrees, not its supplement', async ({
  page,
  extension,
}, testInfo) => {
  await openViewer(page, extension);
  await extension.replaceModel(`
    const base = Manifold.cube([80, 50, 8], true).translate([0, 0, 4]);
    const wall = Manifold.cube([80, 8, 40])
      .translate([-40, 0, -2]).rotate([-30, 0, 0]).translate([0, 17, 8]);
    result = base.add(wall);
  `);
  await expect(page.getByText('E2E replacement bracket', { exact: true })).toBeVisible();
  const cosine = Math.sqrt(3) / 2;
  const framing = {
    center: [0, (17 + 19 + 8 * cosine - 25) / 2, (8 + 38 * cosine) / 2] as [number, number, number],
    maxDimension: 80,
  };
  await page.getByRole('button', { name: 'Measure (D)', exact: true }).click();
  const wall = modelPoint(page, [40, 26.5, 8 + 19 * cosine], framing);
  await page.mouse.move(wall.x, wall.y);
  await expect(page.locator('.measurement-preview-label')).toContainText('38 mm');
  await page.mouse.click(wall.x, wall.y);
  await expect(label(page)).toContainText('38 mm');
  const base = modelPoint(page, [40, -4, 8], framing);
  await page.mouse.move(base.x, base.y);
  await expect(page.locator('.measurement-preview-label')).toHaveText('120°');
  await page.mouse.click(base.x, base.y);
  await expect(label(page)).toHaveText('120°');
  await expect(label(page)).toHaveAttribute('aria-label', /Corner angle/);
  await testInfo.attach('corner-120-degrees', { body: await page.screenshot(), contentType: 'image/png' });
  await attachMeasurement(page);
  const payload = parseAnnotationAttachment(attachmentPayload(extension));
  expect(payload.version).toBe(6);
  expect(payload.mode).toBe('measurement');
  if (payload.mode !== 'measurement') {
    throw new Error('Expected a dedicated measurement snapshot.');
  }
  const evidence = payload.annotations[0]?.measurement;
  expect(evidence?.kind).toBe('relation');
  if (evidence?.kind !== 'relation') {
    throw new Error('Expected corner evidence.');
  }
  expect(evidence.angle?.method).toBe('edge-corner');
  expect(evidence.angle?.value).toBeCloseTo(120, 4);
  expect(evidence.distance?.value).toBe(0);
  expect(extension.messages).toHaveLength(0);
});
