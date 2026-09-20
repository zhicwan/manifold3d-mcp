import { test, expect } from './extension-fixture.js';
import { batch, createMeasurement, editor, label, openViewer } from './viewer-helpers.js';

test.use({ hasTouch: true });

test('shared measurement notes retain Chinese drafts across dark theme and narrow touch layouts', async ({
  page,
  extension,
}, testInfo) => {
  await openViewer(page, extension);
  await createMeasurement(page);
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).tap();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Language', exact: true }).tap();
  await page.getByRole('menuitemradio', { name: '简体中文', exact: true }).tap();
  await expect(page.locator('[data-viewer-root]')).toHaveAttribute('lang', 'zh-CN');
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);

  await page.getByRole('button', { name: '添加批注（M）', exact: true }).tap();
  await label(page).tap();
  const input = editor(page).getByRole('textbox', { name: '批注内容', exact: true });
  const note = Array.from(
    { length: 20 },
    (_, index) => `第 ${index + 1} 项：保留蓝色尺寸线，将宽度调整为 85 mm。🌏`,
  ).join('\n');
  await input.fill(note);
  await editor(page).getByRole('button', { name: '保存批注', exact: true }).tap();
  await expect(batch(page)).toBeVisible();
  await expect(label(page)).toContainText('#1');
  await label(page).tap();

  for (const viewport of [
    { width: 1100, height: 780 },
    { width: 420, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(input).toHaveValue(note);
    await expect
      .poll(async () => {
        const body = await editor(page).locator('.marks-flyout-body').boundingBox();
        return (
          body !== null &&
          body.x >= 0 &&
          body.y >= 0 &&
          body.x + body.width <= viewport.width &&
          body.y + body.height <= viewport.height
        );
      })
      .toBe(true);
    expect(
      await input.evaluate(element => {
        const style = getComputedStyle(element);
        return element.scrollHeight > element.clientHeight && style.overflowY === 'auto' && element.clientHeight <= 120;
      }),
    ).toBe(true);
    const save = await editor(page).getByRole('button', { name: '保存批注', exact: true }).boundingBox();
    expect(save?.width).toBeGreaterThanOrEqual(44);
    expect(save?.height).toBeGreaterThanOrEqual(44);
    await testInfo.attach(`dark-chinese-touch-${viewport.width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  }
  await editor(page).getByRole('button', { name: '取消编辑', exact: true }).tap();
  await expect(editor(page)).toHaveCount(0);
  await label(page).tap();
  await expect(input).toHaveValue(note);
  expect(extension.attachments).toHaveLength(0);
  expect(extension.messages).toHaveLength(0);
});
