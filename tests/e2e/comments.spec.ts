import { test, expect } from './extension-fixture.js';
import {
  batch,
  createMeasurement,
  dimension,
  editor,
  label,
  openMeasurementComment,
  openViewer,
  ordinaryComment,
  saveMeasurementComment,
} from './viewer-helpers.js';

test('shared editor handles keyboard, real IME composition, cancel and conditional number/preview', async ({
  page,
  extension,
}) => {
  await openViewer(page, extension);
  await createMeasurement(page);
  const input = await openMeasurementComment(page);
  await expect(input).toHaveAttribute('placeholder', 'Add a note...');
  await expect(editor(page).getByRole('button', { name: 'Send changes', exact: true })).toHaveCount(0);
  await input.fill('unsaved draft');
  await expect(label(page)).not.toContainText('#');
  await expect(batch(page)).toHaveCount(0);
  await input.press('Escape');
  await label(page).click();
  await expect(input).toHaveValue('');

  const cdp = await page.context().newCDPSession(page);
  await input.focus();
  await cdp.send('Input.imeSetComposition', { text: '宽度', selectionStart: 2, selectionEnd: 2 });
  await input.press('Enter');
  await expect(input).toBeVisible();
  await expect(batch(page)).toHaveCount(0);
  await expect(input).toHaveValue(/宽度/);
  await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
  await cdp.detach();
  await input.fill('宽度');
  await input.press('Shift+Enter');
  await input.pressSequentially('Use 85 mm');
  await expect(input).toHaveValue('宽度\nUse 85 mm');
  await input.press('Enter');
  await expect(editor(page)).toHaveCount(0);
  await expect(label(page)).toContainText('#1');
  await expect(batch(page)).toContainText('1 note');
  await label(page).click();
  await input.fill('discard by button');
  await editor(page).getByRole('button', { name: 'Cancel edit', exact: true }).click();
  await label(page).click();
  await expect(input).toHaveValue('宽度\nUse 85 mm');
  await input.fill('saved by tool switch');
  await expect(input).toHaveValue('saved by tool switch');
  await page.getByRole('button', { name: 'Orbit (V)', exact: true }).click();
  await label(page).hover();
  await expect(page.locator('.measurement-comment-preview')).toHaveText('saved by tool switch');
  await label(page).focus();
  await expect(page.locator('.measurement-comment-preview')).toHaveText('saved by tool switch');
  await ordinaryComment(page, 'ordinary uses the same editor');
  await expect(batch(page)).toContainText('2 notes');
  expect(extension.attachments).toHaveLength(0);
  expect(extension.messages).toHaveLength(0);
});

test('mixed notes Done is local; batch Cancel restores measurement and discards unsaved edits', async ({
  page,
  localViewer,
}) => {
  await openViewer(page, localViewer);
  await createMeasurement(page);
  await saveMeasurementComment(page, 'original measured width');
  await ordinaryComment(page, 'ordinary face note');
  await expect(batch(page)).toContainText('2 notes');
  await batch(page).getByRole('button', { name: 'Done', exact: true }).click();
  await expect(batch(page)).toHaveCount(0);
  await expect(dimension(page)).toHaveCount(1);
  await saveMeasurementComment(page, 'saved draft to cancel');
  await ordinaryComment(page, 'new ordinary note to cancel', [0, 17, 28]);
  await expect(batch(page)).toContainText('2 notes');
  const input = await openMeasurementComment(page);
  await input.fill('unsaved edit must not be saved by outside pointerdown');
  await batch(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(batch(page)).toHaveCount(0);
  await expect(dimension(page)).toHaveCount(1);
  await openMeasurementComment(page);
  await expect(input).toHaveValue('original measured width');
  await input.press('Escape');
  await page.getByRole('button', { name: 'Orbit (V)', exact: true }).click();
  await openMeasurementComment(page);
  await expect(input).toHaveValue('original measured width');
  await input.fill('');
  await expect(input).toHaveValue('');
  await input.press('Enter');
  await expect(editor(page)).toHaveCount(0);
  await expect(dimension(page)).toHaveCount(1);
  await expect(label(page)).not.toContainText('#');
  await expect(batch(page)).toHaveCount(0);
});

test('clearing the last unsaved note cannot remove batch Cancel before its click', async ({ page, localViewer }) => {
  await openViewer(page, localViewer);
  await createMeasurement(page);
  await saveMeasurementComment(page, 'committed measurement note');
  await batch(page).getByRole('button', { name: 'Done', exact: true }).click();
  await saveMeasurementComment(page, 'only pending note');
  await expect(batch(page)).toContainText('1 note');
  const input = await openMeasurementComment(page);
  await input.fill('');
  await expect(input).toHaveValue('');
  await batch(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await expect(batch(page)).toHaveCount(0);
  await expect(dimension(page)).toHaveCount(1);
  await expect(page.locator('#view')).toHaveAttribute('data-mark-mode', 'orbit');
  await openMeasurementComment(page);
  await expect(input).toHaveValue('committed measurement note');
  await input.press('Escape');
  await page.getByRole('button', { name: 'Measure (D)', exact: true }).click();
  await openMeasurementComment(page);
  await expect(input).toHaveValue('committed measurement note');
});
