import { test, expect } from './extension-fixture.js';
import { parseAnnotationsMessage, type AnnotationsMessage } from '@manifold3d/protocol/wire/annotations.js';
import {
  blueDimensionPixels,
  createMeasurement,
  dimension,
  editor,
  label,
  modelPoint,
  openViewer,
} from './viewer-helpers.js';

test('real pointer measurement preserves baseline appearance and mode routing', async ({
  page,
  extension,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openViewer(page, extension);
  const viewTools = page.locator('.viewer-view-controls').getByRole('button');
  await expect(viewTools.nth(0)).toHaveAttribute('aria-label', 'Measure (D)');
  await expect(viewTools.nth(1)).toHaveAttribute('aria-label', 'Zoom in');
  await createMeasurement(page);
  const edgePoint = modelPoint(page, [20, 17, 46]);
  await page.mouse.move(edgePoint.x, edgePoint.y);
  const hint = page.locator('.measurement-hud');
  await expect(hint.getByRole('button')).toHaveCount(1);
  await expect(hint.getByRole('button', { name: 'Exit measurement', exact: true })).toBeEnabled();
  await page.mouse.move(20, 180);
  await expect
    .poll(
      async () => {
        const pixels = await blueDimensionPixels(page);
        return pixels.line >= 8 && pixels.start >= 5 && pixels.end >= 5;
      },
      { message: 'Blue GPU dimension strokes and both witness balls must remain visible' },
    )
    .toBe(true);
  await expect(label(page)).not.toContainText('#');
  await label(page).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('#view')).toHaveAttribute('data-mark-mode', 'measure');
  await testInfo.attach('measurement-baseline', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await label(page).focus();
  await expect(label(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#view')).toHaveAttribute('data-mark-mode', 'orbit');
  await label(page).click();
  await expect(dimension(page)).not.toHaveAttribute('data-selected');
  await label(page).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(dimension(page)).toHaveCount(1);
  expect(extension.attachments).toHaveLength(0);
  expect(extension.messages).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('second geometry operand updates the same measurement; Measure deletes only that result', async ({
  page,
  extension,
}) => {
  const snapshots: AnnotationsMessage[] = [];
  page.on('websocket', socket => {
    socket.on('framesent', frame => {
      if (typeof frame.payload === 'string' && frame.payload.includes('"kind":"annotations"')) {
        snapshots.push(parseAnnotationsMessage(JSON.parse(frame.payload)));
      }
    });
  });
  await openViewer(page, extension);
  await createMeasurement(page);
  await expect.poll(() => snapshots.at(-1)?.items.length).toBe(1);
  const originalId = snapshots.at(-1)?.items[0]?.id;
  const revision = snapshots.at(-1)?.revision;
  const secondEdge = modelPoint(page, [0, -25, 8]);
  await page.mouse.move(secondEdge.x, secondEdge.y);
  await expect(page.locator('.measurement-dimension[data-preview]')).toBeVisible();
  await page.mouse.click(secondEdge.x, secondEdge.y);
  await expect(dimension(page)).toHaveCount(1);
  await expect(label(page)).not.toHaveText('80 mm');
  await expect.poll(() => snapshots.at(-1)?.revision).not.toBe(revision);
  expect(snapshots.at(-1)?.items).toMatchObject([{ id: originalId, measurement: { kind: 'relation' } }]);
  await page.getByRole('button', { name: 'Measure (D)', exact: true }).click();
  await label(page).click();
  await dimension(page).getByRole('button', { name: 'Remove measurement', exact: true }).click();
  await expect(dimension(page)).toHaveCount(0);
  expect(extension.attachments).toHaveLength(0);
  expect(extension.messages).toHaveLength(0);
});
