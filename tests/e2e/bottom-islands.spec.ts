import { test, expect } from './extension-fixture.js';
import { attachMeasurement, createMeasurement, dimension, label, openViewer } from './viewer-helpers.js';

test('a status-only tip shares the ViewCube vertical center', async ({ page, extension }) => {
  await openViewer(page, extension);
  await createMeasurement(page);
  await attachMeasurement(page);
  const status = page.locator('.viewer-action-status');
  await expect(status).toBeVisible();
  const viewport = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = await status.boundingBox();
      return box ? Math.abs(box.y + box.height / 2 - (viewport.height - 68)) : Infinity;
    })
    .toBeLessThanOrEqual(1);
});

test('measurement hint and a single delivery error share non-overlapping bottom islands', async ({
  page,
  extension,
}) => {
  await openViewer(page, extension);
  await createMeasurement(page);
  const pending = extension.holdNextAttachment();
  await page.getByRole('button', { name: 'Select to chat (S)', exact: true }).click();
  await label(page).click();
  await expect(dimension(page)).toHaveAttribute('data-pending', 'true');
  await page.getByRole('button', { name: 'Measure (D)', exact: true }).click();
  pending.fail('E2E single readable failure');
  await expect(dimension(page)).not.toHaveAttribute('data-pending');
  await expect(page.getByText(/E2E single readable failure/)).toHaveCount(1);
  const islands = page.locator('.viewer-bottom-islands');
  const hint = islands.getByRole('region', { name: 'Measure', exact: true });
  const alert = islands.getByRole('alert');
  await expect(hint).toBeVisible();
  await expect(alert).toHaveCount(1);
  for (const viewport of [
    { width: 1100, height: 780 },
    { width: 420, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(async () => {
        const hintBox = await hint.boundingBox();
        const statusBox = await alert.boundingBox();
        if (!hintBox || !statusBox) {
          return false;
        }
        return (
          statusBox.y + statusBox.height <= hintBox.y &&
          Math.abs(viewport.height - hintBox.y - hintBox.height - 24) <= 1 &&
          hintBox.x >= 0 &&
          hintBox.x + hintBox.width <= viewport.width &&
          statusBox.x >= 0 &&
          statusBox.x + statusBox.width <= viewport.width
        );
      })
      .toBe(true);
  }
  expect(extension.attachments).toHaveLength(1);
  expect(extension.messages).toHaveLength(0);
});
