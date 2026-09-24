import { parseAnnotationsMessage } from '@manifold3d/protocol/wire/annotations.js';
import { test, expect } from './extension-fixture.js';
import { createMeasurement, editor, openMeasurementComment, openViewer } from './viewer-helpers.js';

test('20 full-page lifecycles keep one Viewer/editor and settled annotation transport quiet', async ({
  page,
  extension,
}) => {
  test.setTimeout(240_000);
  const connections: Array<{ annotations: number; items: number }> = [];
  page.on('websocket', socket => {
    const connection = { annotations: 0, items: 0 };
    connections.push(connection);
    socket.on('framesent', frame => {
      if (typeof frame.payload === 'string' && frame.payload.includes('"kind":"annotations"')) {
        connection.annotations++;
        connection.items = parseAnnotationsMessage(JSON.parse(frame.payload)).items.length;
      }
    });
  });

  for (let cycle = 0; cycle < 20; cycle++) {
    await test.step(`navigation ${cycle + 1}`, async () => {
      await openViewer(page, extension);
      await createMeasurement(page);
      const input = await openMeasurementComment(page);
      await expect(input).toBeVisible();
      await expect(page.locator('canvas#view')).toHaveCount(1);
      await expect(page.locator('.marks-flyout')).toHaveCount(1);
      await expect(editor(page)).toHaveCount(1);
      expect(connections).toHaveLength(cycle + 1);
      await expect.poll(() => connections.at(-1)?.items).toBe(1);
      const annotationCount = () => connections.reduce((total, connection) => total + connection.annotations, 0);
      const settledCount = annotationCount();
      // Observe real animation frames after the measurement has reached the WS.
      // This is transport quiescence, not a browser-driver heap measurement.
      await page.evaluate(
        () =>
          new Promise<void>(resolve => {
            let remaining = 16;
            const frame = () => {
              if (--remaining === 0) {
                resolve();
              } else {
                requestAnimationFrame(frame);
              }
            };
            requestAnimationFrame(frame);
          }),
      );
      expect(annotationCount(), `annotation churn after settling cycle ${cycle + 1}`).toBe(settledCount);
    });
  }
  expect(connections).toHaveLength(20);
  expect(extension.attachments).toHaveLength(0);
  expect(extension.messages).toHaveLength(0);
  await page.goto('about:blank');
  await expect(page.locator('canvas#view, .marks-flyout')).toHaveCount(0);
});
