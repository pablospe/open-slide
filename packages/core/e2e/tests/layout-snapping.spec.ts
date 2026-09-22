import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  deleteSlide,
  duplicateSlide,
  editorCanvas,
  openSlide,
  readSlideSource,
  slideSourcePath,
} from './helpers.ts';

const SLIDE_ID = 'layout-thirds-clear';

test.afterEach(async ({ page, request }) => {
  await page.close();
  await deleteSlide(request, SLIDE_ID);
});

test('dragging near a canvas third snaps onto it and Clear layout removes the offset', async ({
  page,
  request,
}) => {
  await duplicateSlide(request, 'edit-target', SLIDE_ID);
  await writeFile(
    slideSourcePath(SLIDE_ID),
    `import type { Page, SlideMeta } from '@open-slide/core';
export const meta: SlideMeta = { title: 'Thirds', createdAt: '2026-01-01T00:00:00.000Z' };
const Only: Page = () => (
  <div style={{ width: '100%', height: '100%', position: 'relative', background: '#14213d', color: 'white', fontFamily: 'system-ui', fontSize: 32 }}>
    <div style={{ position: 'absolute', left: 120, top: 160, width: 240, height: 160, background: '#2a9d8f' }}>Lone block</div>
  </div>
);
export default [Only] satisfies Page[];
`,
  );
  await openSlide(page, SLIDE_ID);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-inspector-ready]')).toBeVisible();
  const block = editorCanvas(page).getByText('Lone block', { exact: true });
  await block.click();
  const panel = page.locator('aside[data-inspector-ui]');
  await panel.getByRole('tab', { name: 'Arrange' }).click();
  await panel.getByRole('button', { name: 'Thirds', exact: true }).click();
  const clear = panel.getByRole('button', { name: 'Clear layout', exact: true });

  const scale = await block.evaluate((node) => {
    const canvas = node.closest<HTMLElement>('[data-osd-canvas]');
    if (!canvas) throw new Error('Block is outside the slide canvas');
    return canvas.getBoundingClientRect().width / canvas.offsetWidth;
  });
  const box = await block.boundingBox();
  if (!box) throw new Error('Block has no bounding box');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The left edge starts at 120; a third of 1920 is 640, so 523 lands 3px past it.
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 523 * scale, start.y, { steps: 10 });
  await expect(page.locator('[data-guide-kind="third"]')).toBeVisible();
  await page.mouse.up();
  await expect(page.getByText('1 unsaved change')).toBeVisible();

  const save = async () => {
    const saved = page.waitForResponse(
      (response) => response.url().includes('/__edit') && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await saved).ok()).toBe(true);
  };
  await save();
  await expect.poll(() => readSlideSource(SLIDE_ID)).toContain("translate: '520px 0px'");

  await block.click();
  await expect.poll(() => block.evaluate((node) => node.style.translate)).not.toBe('');
  await clear.click();
  await expect.poll(() => block.evaluate((node) => node.style.translate)).toBe('');
  await save();
  await expect.poll(() => readSlideSource(SLIDE_ID)).not.toContain('translate');
  const source = await readSlideSource(SLIDE_ID);
  expect(source).toContain(
    "<div style={{ position: 'absolute', left: 120, top: 160, width: 240, height: 160, background: '#2a9d8f' }}>Lone block</div>",
  );
});
