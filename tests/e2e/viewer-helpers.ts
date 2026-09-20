import type { Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { expect, MODEL_DESCRIPTION, type ExtensionHarness } from './extension-fixture.js';

export async function openViewer(page: Page, extension: Pick<ExtensionHarness, 'url'>) {
  await page.goto(extension.url);
  await expect(page.getByText(MODEL_DESCRIPTION, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Measure (D)', exact: true })).toBeEnabled();
  // Failure is explicit; there is no WebGL/environment skip.
  expect(
    await page.locator('#view').evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext('webgl2');
      return gl !== null && !gl.isContextLost();
    }),
  ).toBe(true);
}

export const dimension = (page: Page) => page.locator('.measurement-dimension:not([data-preview])');
export const label = (page: Page) => dimension(page).getByRole('button').first();
export const editor = (page: Page) => page.locator('.marks-flyout.expanded');
export const batch = (page: Page) => page.locator('.viewer-batch-bar');

// Project known fixture geometry, not pixels from one developer's window. This
// mirrors the documented default camera only; no production store/API is injected.
export function modelPoint(
  page: Page,
  point: [number, number, number],
  framing: { center: [number, number, number]; maxDimension: number } = { center: [0, 0, 23], maxDimension: 80 },
) {
  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error('E2E requires a fixed viewport.');
  }
  const camera = new PerspectiveCamera(40, viewport.width / viewport.height, 0.1, 5000);
  camera.up.set(0, 0, 1);
  const radius = framing.maxDimension;
  camera.position.fromArray(framing.center).add(new Vector3(radius * 1.4, -radius * 1.4, radius * 1.6));
  camera.lookAt(...framing.center);
  camera.updateMatrixWorld();
  const projected = new Vector3(...point).project(camera);
  return { x: ((projected.x + 1) * viewport.width) / 2, y: ((1 - projected.y) * viewport.height) / 2 };
}

export async function createMeasurement(page: Page) {
  await page.getByRole('button', { name: 'Measure (D)', exact: true }).click();
  const point = modelPoint(page, [0, 17, 46]);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.measurement-dimension[data-preview]')).toBeVisible();
  await page.mouse.click(point.x, point.y);
  await expect(dimension(page)).toHaveCount(1);
  await expect(label(page)).toContainText('80 mm');
}

export async function openMeasurementComment(page: Page) {
  await page.getByRole('button', { name: 'Annotate (M)', exact: true }).click();
  await label(page).click();
  await expect(editor(page)).toHaveAttribute('data-intent', 'measurement');
  return editor(page).getByRole('textbox');
}

export async function saveMeasurementComment(page: Page, note: string) {
  const input = await openMeasurementComment(page);
  await input.fill(note);
  await editor(page).getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
}

export async function ordinaryComment(page: Page, note: string, position: [number, number, number] = [24, 17, 30]) {
  await page.getByRole('button', { name: 'Annotate (M)', exact: true }).click();
  const point = modelPoint(page, position);
  await page.mouse.click(point.x, point.y);
  await expect(editor(page)).toHaveAttribute('data-intent', 'comment');
  await editor(page).getByRole('textbox').fill(note);
  await editor(page).getByRole('textbox').press('Enter');
  await expect(editor(page)).toHaveCount(0);
}

export async function regionComment(page: Page, note: string) {
  await page.getByRole('button', { name: 'Annotate (M)', exact: true }).click();
  const a = modelPoint(page, [-30, -22, 8]);
  const b = modelPoint(page, [30, 12, 8]);
  await page.mouse.move(Math.min(a.x, b.x), Math.min(a.y, b.y));
  await page.mouse.down();
  await page.mouse.move(Math.max(a.x, b.x), Math.max(a.y, b.y), { steps: 8 });
  await page.mouse.up();
  await expect(editor(page)).toHaveAttribute('data-kind', 'region');
  await editor(page).getByRole('textbox').fill(note);
  await editor(page).getByRole('textbox').press('Enter');
  await expect(editor(page)).toHaveCount(0);
}

export async function attachMeasurement(page: Page) {
  await page.getByRole('button', { name: 'Select to chat (S)', exact: true }).click();
  await label(page).click();
  await expect(dimension(page)).toHaveAttribute('data-attached', 'true');
  await expect(dimension(page)).not.toHaveAttribute('data-pending');
}

export function attachmentPayload(extension: ExtensionHarness, index = 0) {
  const attachment = extension.attachments[index]?.attachments[0];
  if (attachment?.type !== 'extension_context') {
    throw new Error(`Missing SDK attachment ${index}.`);
  }
  return attachment.payload;
}

export async function blueDimensionPixels(page: Page) {
  const start = modelPoint(page, [-40, 17, 46]);
  const end = modelPoint(page, [40, 17, 46]);
  const image = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
  return page.evaluate(
    async ({ image: source, start: a, end: b }) => {
      const screenshot = new Image();
      screenshot.src = source;
      await screenshot.decode();
      const canvas = document.createElement('canvas');
      canvas.width = screenshot.width;
      canvas.height = screenshot.height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Screenshot sampler could not create a 2D context.');
      }
      context.drawImage(screenshot, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const blueNear = (x: number, y: number, radius: number) => {
        let pixels = 0;
        for (let row = Math.floor(y - radius); row <= y + radius; row++) {
          for (let col = Math.floor(x - radius); col <= x + radius; col++) {
            const offset = (row * canvas.width + col) * 4;
            const red = data[offset] ?? 0;
            const green = data[offset + 1] ?? 0;
            const blue = data[offset + 2] ?? 0;
            if (blue > red + 35 && blue > green + 15) {
              pixels++;
            }
          }
        }
        return pixels;
      };
      // Exclude the inline number; sample the GPU line and witness balls.
      const samples = [0.05, 0.1, 0.15, 0.2, 0.25, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
      return {
        start: blueNear(a.x, a.y, 7),
        end: blueNear(b.x, b.y, 7),
        line: samples.filter(t => blueNear(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, 5) > 0).length,
      };
    },
    { image, start, end },
  );
}
