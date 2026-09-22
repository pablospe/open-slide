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

const SLIDE_ID = 'context-menu';

const source = (...items: string[]) => `import type { Page, SlideMeta } from '@open-slide/core';
export const meta: SlideMeta = { title: 'Context menu', createdAt: '2026-01-01T00:00:00.000Z' };
const Only: Page = () => (
  <div style={{ width: '100%', height: '100%', padding: 80, background: '#101820', color: 'white', fontFamily: 'system-ui' }}>
${items.map((item) => `    <h2 style={{ fontSize: 64, margin: 0 }}>${item}</h2>`).join('\n')}
  </div>
);
export default [Only] satisfies Page[];
`;

test.afterEach(async ({ page, request }) => {
  await page.close();
  await deleteSlide(request, SLIDE_ID);
});

test('right-click selects the element and duplicates it from the menu', async ({
  page,
  request,
}) => {
  await duplicateSlide(request, 'edit-target', SLIDE_ID);
  await writeFile(slideSourcePath(SLIDE_ID), source('Alpha', 'Beta'));
  await openSlide(page, SLIDE_ID);
  const canvas = editorCanvas(page);
  await expect(canvas.getByText('Beta', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-inspector-ready]')).toBeVisible();

  await canvas.getByText('Beta', { exact: true }).click({ button: 'right' });
  const menu = page.locator('[data-editor-context-menu]');
  await expect(menu).toBeVisible();
  await expect(page.locator('[data-selection-frame]')).toBeVisible();

  const clear = menu.locator('[data-editor-action="clearLayout"]');
  await expect(clear).toHaveAttribute('data-disabled', '');
  await expect(clear).toContainText('Nothing to clear');
  await expect(menu.locator('[data-editor-action="editText"]')).not.toHaveAttribute(
    'data-disabled',
  );

  await menu.getByRole('menuitem', { name: /Duplicate element/ }).click();
  await expect(menu).toBeHidden();
  await expect.poll(() => readSlideSource(SLIDE_ID)).toBe(source('Alpha', 'Beta', 'Beta'));
  await expect(canvas.getByText('Beta', { exact: true })).toHaveCount(2);
});
