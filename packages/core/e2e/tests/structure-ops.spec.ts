import { writeFile } from 'node:fs/promises';
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  deleteSlide,
  duplicateSlide,
  editorCanvas,
  openSlide,
  readSlideSource,
  slideSourcePath,
} from './helpers.ts';

const SLIDE_ID = 'structure-ops';

const source = (...items: string[]) => `import type { Page, SlideMeta } from '@open-slide/core';
export const meta: SlideMeta = { title: 'Structure', createdAt: '2026-01-01T00:00:00.000Z' };
const Only: Page = () => (
  <div style={{ width: '100%', height: '100%', padding: 80, background: '#101820', color: 'white', fontFamily: 'system-ui' }}>
${items.map((item) => `    <h2 style={{ fontSize: 64, margin: 0 }}>${item}</h2>`).join('\n')}
  </div>
);
export default [Only] satisfies Page[];
`;

async function expectSelected(page: Page, element: Locator) {
  await expect
    .poll(async () => {
      const frame = await page.locator('[data-selection-frame]').boundingBox();
      const box = await element.boundingBox();
      if (!frame || !box) return Infinity;
      return Math.abs(frame.y + frame.height / 2 - (box.y + box.height / 2));
    })
    .toBeLessThan(4);
}

test.afterEach(async ({ page, request }) => {
  await page.close();
  await deleteSlide(request, SLIDE_ID);
});

test('duplicate, move and delete rewrite the slide file and keep a sensible selection', async ({
  page,
  request,
}) => {
  await duplicateSlide(request, 'edit-target', SLIDE_ID);
  await writeFile(slideSourcePath(SLIDE_ID), source('Alpha', 'Beta', 'Gamma'));
  await openSlide(page, SLIDE_ID);
  const canvas = editorCanvas(page);
  await expect(canvas.getByText('Gamma', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-inspector-ready]')).toBeVisible();

  await canvas.getByText('Beta', { exact: true }).click();
  await page.keyboard.press('ControlOrMeta+d');
  await expect.poll(() => readSlideSource(SLIDE_ID)).toBe(source('Alpha', 'Beta', 'Beta', 'Gamma'));
  await expect(canvas.getByText('Beta', { exact: true })).toHaveCount(2);
  await expectSelected(page, canvas.getByText('Beta', { exact: true }).nth(1));

  const gamma = canvas.getByText('Gamma', { exact: true });
  await gamma.click();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => readSlideSource(SLIDE_ID)).toBe(source('Alpha', 'Beta', 'Gamma', 'Beta'));
  await expectSelected(page, gamma);

  const panel = page.locator('aside[data-inspector-ui]');
  await panel.getByRole('tab', { name: 'Arrange', exact: true }).click();
  await panel.getByRole('button', { name: 'Delete element', exact: true }).click();
  await expect.poll(() => readSlideSource(SLIDE_ID)).toBe(source('Alpha', 'Beta', 'Beta'));
  await expect(gamma).toHaveCount(0);
  await expect(page.locator('[data-selection-frame]')).toHaveCount(0);
});

test('refuses to delete the page root and leaves the file untouched', async ({ page, request }) => {
  await duplicateSlide(request, 'edit-target', SLIDE_ID);
  await writeFile(slideSourcePath(SLIDE_ID), source('Alpha'));
  await openSlide(page, SLIDE_ID);
  const canvas = editorCanvas(page);
  await expect(canvas.getByText('Alpha', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-inspector-ready]')).toBeVisible();

  await canvas.getByText('Alpha', { exact: true }).click();
  const panel = page.locator('aside[data-inspector-ui]');
  await panel.getByRole('tab', { name: 'Arrange', exact: true }).click();
  await panel.getByRole('button', { name: 'Select parent' }).click();
  await panel.getByRole('button', { name: 'Delete element', exact: true }).click();
  await expect(page.getByText('the page or component root cannot be deleted')).toBeVisible();
  expect(await readSlideSource(SLIDE_ID)).toBe(source('Alpha'));
});
