import { test, expect } from './extension-fixture.js';
import { dimension, label, modelPoint, openViewer } from './viewer-helpers.js';

test('a distance between post tops offsets above the endpoint solids, not into midpoint-only free space', async ({
  page,
  extension,
}, testInfo) => {
  await openViewer(page, extension);
  await page.getByRole('button', { name: 'Measure (D)', exact: true }).click();
  const first = modelPoint(page, [-18, -8, 24]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.click(first.x, first.y);
  await expect(page.locator('.measurement-hint-text')).toHaveText('Choose another object');
  const second = modelPoint(page, [22, -10, 32]);
  await page.mouse.move(second.x, second.y);
  await expect(page.locator('.measurement-preview-label')).toHaveText('40.84 mm');
  await page.mouse.click(second.x, second.y);
  await expect(dimension(page)).toHaveCount(1);
  await expect(label(page)).toHaveText('40.84 mm');
  const midpoint = modelPoint(page, [2, -9, 28]);
  await expect
    .poll(async () => {
      const bounds = await label(page).boundingBox();
      return bounds !== null && bounds.y + bounds.height / 2 < midpoint.y - 2;
    })
    .toBe(true);
  await testInfo.attach('post-top-clearance', { body: await page.screenshot(), contentType: 'image/png' });
  expect(extension.attachments).toHaveLength(0);
  expect(extension.messages).toHaveLength(0);
});
