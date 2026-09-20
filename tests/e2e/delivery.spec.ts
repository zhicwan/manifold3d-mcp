import { test, expect } from './extension-fixture.js';
import { parseAnnotationAttachment } from '../../apps/copilot-extension/src/annotation-attachment.js';
import {
  attachmentPayload,
  attachMeasurement,
  batch,
  createMeasurement,
  dimension,
  editor,
  label,
  openMeasurementComment,
  openViewer,
  ordinaryComment,
  regionComment,
  saveMeasurementComment,
} from './viewer-helpers.js';

test('Select Attach and editor Send capture immutable snapshots without duplicate SDK effects', async ({
  page,
  extension,
}) => {
  await openViewer(page, extension);
  await createMeasurement(page);
  await attachMeasurement(page);
  await expect(label(page)).toContainText('#1');
  expect(extension.attachments).toHaveLength(1);
  expect(extension.messages).toHaveLength(0);
  expect(attachmentPayload(extension)).toMatchObject({
    mode: 'measurement',
    annotations: [{ displayNumber: 1, measurement: { kind: 'edge-length', distance: { value: 80, unit: 'mm' } } }],
  });
  const original = structuredClone(extension.attachments[0]);
  await saveMeasurementComment(page, 'use 85 mm');
  await expect(dimension(page)).toHaveAttribute('data-attachment-changed', 'true');
  await attachMeasurement(page);
  expect(extension.attachments).toHaveLength(2);
  expect(extension.attachments[0]).toEqual(original);
  expect(attachmentPayload(extension, 1)).toMatchObject({ annotations: [{ note: 'use 85 mm' }] });
  await expect(dimension(page)).not.toHaveAttribute('data-attachment-changed');
  const input = await openMeasurementComment(page);
  await expect(batch(page)).toHaveCount(0);
  await input.fill('Send this draft as 92 mm');
  await editor(page).getByRole('button', { name: 'Send changes', exact: true }).click();
  await expect(dimension(page)).not.toHaveAttribute('data-pending');
  await expect.poll(() => extension.messages.length).toBe(1);
  expect(extension.messages[0]).toMatchObject({ mode: 'enqueue' });
  expect(extension.messages[0]?.prompt).toContain('Send this draft as 92 mm');
  expect(extension.messages[0]?.prompt).toContain('edge-length');
  expect(extension.attachments).toHaveLength(2);
  expect(extension.attachments[0]).toEqual(original);
  await page.getByRole('button', { name: 'Annotate (M)', exact: true }).click();
  await expect(batch(page)).toHaveCount(0);
});

test('mixed batch Attach and Fix preserve point, region and measurement evidence through real host actions', async ({
  page,
  extension,
}) => {
  await openViewer(page, extension);
  await createMeasurement(page);
  await saveMeasurementComment(page, 'measured width');
  await ordinaryComment(page, 'ordinary point');
  await regionComment(page, 'ordinary region');
  await expect(batch(page)).toContainText('3 notes');
  await batch(page).getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(dimension(page)).toHaveAttribute('data-attached', 'true');
  expect(extension.attachments).toHaveLength(1);
  expect(extension.messages).toHaveLength(0);
  expect(attachmentPayload(extension)).toMatchObject({
    mode: 'annotation-batch',
    annotations: [
      {
        displayNumber: 1,
        note: 'measured width',
        selection: { kind: 'measurement', measurement: { kind: 'edge-length', distance: { value: 80, unit: 'mm' } } },
      },
      { displayNumber: 2, note: 'ordinary point', selection: { kind: 'point' } },
      { displayNumber: 3, note: 'ordinary region', selection: { kind: 'region', triangleCount: expect.any(Number) } },
    ],
  });
  const original = structuredClone(extension.attachments[0]);
  await saveMeasurementComment(page, 'narrow the width');
  await ordinaryComment(page, 'move this point', [0, 17, 28]);
  await batch(page).getByRole('button', { name: 'Fix', exact: true }).click();
  await expect.poll(() => extension.messages.length).toBe(1);
  await expect(dimension(page)).not.toHaveAttribute('data-pending');
  expect(extension.messages[0]).toMatchObject({ mode: 'enqueue' });
  expect(extension.messages[0]?.prompt).toContain('narrow the width');
  expect(extension.messages[0]?.prompt).toContain('move this point');
  expect(extension.messages[0]?.prompt).toContain('measurement');
  expect(extension.attachments).toHaveLength(1);
  expect(extension.attachments[0]).toEqual(original);
});

test('rejected Attach remains recoverable, pending is locked, and replacement ignores late receipts', async ({
  page,
  extension,
}) => {
  const socketReady = page.waitForEvent('websocket');
  await openViewer(page, extension);
  const socket = await socketReady;
  await createMeasurement(page);
  await saveMeasurementComment(page, 'keep this note');
  const rejected = extension.holdNextAttachment();
  await page.getByRole('button', { name: 'Select to chat (S)', exact: true }).click();
  await label(page).click();
  await expect.poll(() => extension.attachments.length).toBe(1);
  await expect(dimension(page)).toHaveAttribute('data-pending', 'true');
  await expect(label(page)).toBeDisabled();
  await page.getByRole('button', { name: 'Measure (D)', exact: true }).click();
  await expect(dimension(page).getByRole('button', { name: 'Remove measurement', includeHidden: true })).toBeDisabled();
  rejected.fail('E2E deliberate attachment rejection');
  await expect(dimension(page)).not.toHaveAttribute('data-pending');
  await expect(dimension(page)).not.toHaveAttribute('data-attached');
  await expect(page.getByRole('alert').first()).toContainText('E2E deliberate attachment rejection');
  const input = await openMeasurementComment(page);
  await expect(input).toHaveValue('keep this note');
  await input.press('Escape');
  const delayed = extension.holdNextAttachment();
  await page.getByRole('button', { name: 'Select to chat (S)', exact: true }).click();
  await label(page).click();
  await expect.poll(() => extension.attachments.length).toBe(2);
  await expect(dimension(page)).toHaveAttribute('data-pending', 'true');
  const oldSnapshot = structuredClone(extension.attachments[1]);
  await extension.replaceModel();
  await expect(page.getByText('E2E replacement bracket', { exact: true })).toBeVisible();
  await expect(dimension(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Annotate (M)', exact: true }).click();
  const terminalStatus = socket.waitForEvent('framereceived', {
    predicate: frame =>
      typeof frame.payload === 'string' &&
      frame.payload.includes('"kind":"host_action_status"') &&
      frame.payload.includes('"state":"succeeded"'),
  });
  delayed.succeed();
  await terminalStatus;
  await expect(page.locator('#view')).toHaveAttribute('data-mark-mode', 'annotate');
  await expect(dimension(page)).toHaveCount(0);
  await expect(batch(page)).toHaveCount(0);
  expect(extension.attachments).toHaveLength(2);
  expect(extension.attachments[1]).toEqual(oldSnapshot);
  expect(extension.messages).toHaveLength(0);
});

test('pending old batch neither blocks nor rolls back replacement model notes', async ({ page, extension }) => {
  const socketReady = page.waitForEvent('websocket');
  await openViewer(page, extension);
  const socket = await socketReady;
  await createMeasurement(page);
  await saveMeasurementComment(page, 'old model pending note');
  const oldRequest = extension.holdNextAttachment();
  await batch(page).getByRole('button', { name: 'Attach', exact: true }).click();
  await expect.poll(() => extension.attachments.length).toBe(1);
  await expect(dimension(page)).toHaveAttribute('data-pending', 'true');
  const oldSnapshot = structuredClone(extension.attachments[0]);
  const oldPayload = parseAnnotationAttachment(attachmentPayload(extension));
  await extension.replaceModel();
  await expect(page.getByText('E2E replacement bracket', { exact: true })).toBeVisible();
  await expect(dimension(page)).toHaveCount(0);
  await createMeasurement(page);
  await saveMeasurementComment(page, 'replacement model note');
  const attach = batch(page).getByRole('button', { name: 'Attach', exact: true });
  await expect(attach).toBeEnabled();
  await attach.click();
  await expect(dimension(page)).toHaveAttribute('data-attached', 'true');
  await expect(dimension(page)).not.toHaveAttribute('data-pending');
  expect(extension.attachments).toHaveLength(2);
  const newPayload = parseAnnotationAttachment(attachmentPayload(extension, 1));
  expect(newPayload.modelVersion).not.toBe(oldPayload.modelVersion);
  expect(newPayload).toMatchObject({
    mode: 'annotation-batch',
    annotations: [{ note: 'replacement model note', selection: { kind: 'measurement' } }],
  });
  const terminalStatus = socket.waitForEvent('framereceived', {
    predicate: frame =>
      typeof frame.payload === 'string' &&
      frame.payload.includes('"kind":"host_action_status"') &&
      frame.payload.includes('"state":"failed"'),
  });
  oldRequest.fail('obsolete batch failure');
  await terminalStatus;
  await expect(page.locator('#view')).toHaveAttribute('data-mark-mode', 'orbit');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(dimension(page)).toHaveAttribute('data-attached', 'true');
  await expect(dimension(page)).not.toHaveAttribute('data-pending');
  const input = await openMeasurementComment(page);
  await expect(input).toHaveValue('replacement model note');
  await expect(batch(page)).toHaveCount(0);
  expect(extension.attachments).toHaveLength(2);
  expect(extension.attachments[0]).toEqual(oldSnapshot);
  expect(extension.messages).toHaveLength(0);
});
