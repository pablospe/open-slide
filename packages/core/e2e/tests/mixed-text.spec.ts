import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  deleteSlide,
  duplicateSlide,
  editorCanvas,
  openSlide,
  readSlideSource,
  slideSourcePath,
} from './helpers.ts';

const FOOTER_DECK = `export const meta = { title: 'Mixed text' };
const master = { footerLabel: 'FADE BASICS' };
const Footer = ({ current, total }: { current: number; total: number }) => (
  <footer style={{ position: 'absolute', left: 120, right: 120, bottom: 80, display: 'flex', justifyContent: 'space-between', fontSize: 32 }}>
    <span>{master.footerLabel}</span>
    <span>
      {String(current).padStart(2, '0')} / {String(total).padStart(2, '0')}
    </span>
  </footer>
);
export default [
  () => (
    <div style={{ padding: 120, fontSize: 64 }}>
      <h1>Plain title</h1>
      <Footer current={1} total={2} />
    </div>
  ),
  () => (
    <div style={{ padding: 120, fontSize: 64 }}>
      <h1>Second page</h1>
      <Footer current={2} total={2} />
    </div>
  ),
];
`;

test.describe('text mixing literals and expressions', () => {
  const slideId = 'mixed-text-footer';

  test.beforeEach(async ({ page, request }) => {
    await duplicateSlide(request, 'edit-target', slideId);
    await fs.writeFile(slideSourcePath(slideId), FOOTER_DECK);
    await openSlide(page, slideId);
    await expect(editorCanvas(page).getByText('Plain title', { exact: true })).toBeVisible();
  });

  test.afterEach(async ({ request }) => {
    await deleteSlide(request, slideId);
  });

  test('refuses inline editing of the shared footer and leaves the file untouched', async ({
    page,
  }) => {
    const footer = editorCanvas(page).locator('footer');
    await expect(footer).toContainText('01 / 02');

    await footer.getByText('01 / 02').dblclick();
    const panel = page.locator('aside[data-inspector-ui]');
    const reason = panel.locator('[data-text-refusal="dynamic-text"]');
    await expect(reason).toContainText('dynamic text');
    await expect(reason).toContainText('rendered 2 times');
    await expect(panel.getByRole('button', { name: 'Edit text on slide' })).toBeDisabled();
    await expect(page.getByText('This text contains dynamic text')).toBeVisible();
    await expect(editorCanvas(page).locator('[contenteditable="true"]')).toHaveCount(0);

    await page.keyboard.type('XYZ');
    await expect(footer).not.toContainText('XYZ');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    expect(await readSlideSource(slideId)).toBe(FOOTER_DECK);
  });

  test('still edits plain text on the same page', async ({ page }) => {
    const title = editorCanvas(page).getByText('Plain title', { exact: true });
    await title.dblclick();
    await expect(title).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readSlideSource(slideId)).toContain('<h1>Plain title edited</h1>');
    const source = await readSlideSource(slideId);
    expect(source).toContain(
      "{String(current).padStart(2, '0')} / {String(total).padStart(2, '0')}",
    );
  });
});
