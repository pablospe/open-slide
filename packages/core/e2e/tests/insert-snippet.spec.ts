import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import {
  deleteSlide,
  duplicateSlide,
  editorCanvas,
  openSlide,
  readSlideSource,
  slideSourcePath,
  TINY_PNG,
} from './helpers.ts';

const SLIDE_ID = 'insert-snippet';

const initial = `import type { Page, SlideMeta } from '@open-slide/core';
export const meta: SlideMeta = { title: 'Insert', createdAt: '2026-01-01T00:00:00.000Z' };
const Only: Page = () => (
  <div style={{ width: '100%', height: '100%', padding: 80, background: '#101820', color: 'white' }}>
    <h1 style={{ fontSize: 64, margin: 0 }}>Alpha</h1>
    <p style={{ fontSize: 32 }}>Omega</p>
  </div>
);
export default [Only] satisfies Page[];
`;

const heading = [
  '    <h2',
  '      style={{',
  '        margin: 0,',
  "        fontFamily: 'var(--osd-font-display)',",
  '        fontSize: 96,',
  '        fontWeight: 700,',
  '        lineHeight: 1.1,',
  "        color: 'var(--osd-text)',",
  '      }}',
  '    >',
  '      Heading',
  '    </h2>',
].join('\n');

const image = [
  '    <img',
  '      src={dot}',
  '      alt=""',
  '      style={{',
  '        width: 800,',
  '        height: 450,',
  "        objectFit: 'cover',",
  "        borderRadius: 'var(--osd-radius)',",
  '      }}',
  '    />',
].join('\n');

test.afterEach(async ({ page, request }) => {
  await page.close();
  await deleteSlide(request, SLIDE_ID);
});

test('inserts a heading after the selection and an image at the end of the page', async ({
  page,
  request,
}) => {
  await duplicateSlide(request, 'edit-target', SLIDE_ID);
  const file = slideSourcePath(SLIDE_ID);
  await writeFile(file, initial);
  await mkdir(path.join(path.dirname(file), 'assets'), { recursive: true });
  await writeFile(path.join(path.dirname(file), 'assets', 'dot.png'), TINY_PNG);
  await openSlide(page, SLIDE_ID);
  const canvas = editorCanvas(page);
  await expect(canvas.getByText('Omega', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-inspector-ready]')).toBeVisible();
  const panel = page.locator('aside[data-inspector-ui]');

  await canvas.getByText('Alpha', { exact: true }).click();
  await panel.getByRole('tab', { name: 'Arrange', exact: true }).click();
  await expect(panel.locator('[data-insert-placement]')).toHaveText(
    'Adds the block after the selected element.',
  );
  await panel.getByRole('button', { name: 'Insert Heading', exact: true }).click();
  const afterHeading = initial.replace('>Alpha</h1>\n', `>Alpha</h1>\n${heading}\n`);
  await expect.poll(() => readSlideSource(SLIDE_ID)).toBe(afterHeading);
  const inserted = canvas.getByText('Heading', { exact: true });
  await expect(inserted).toBeVisible();
  await expect(panel.getByText('index.tsx:6:5')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel.locator('[data-insert-placement]')).toHaveText(
    'Adds the block at the end of this page.',
  );
  await panel.getByRole('button', { name: 'Insert Image', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /dot\.png/ })
    .click();
  const afterImage = afterHeading
    .replace(
      "import type { Page, SlideMeta } from '@open-slide/core';",
      "import type { Page, SlideMeta } from '@open-slide/core';\nimport dot from './assets/dot.png';",
    )
    .replace('>Omega</p>\n', `>Omega</p>\n${image}\n`);
  await expect.poll(() => readSlideSource(SLIDE_ID)).toBe(afterImage);
  await expect(canvas.locator('img[alt=""]')).toHaveCount(1);
  await expect(panel.getByText('index.tsx:20:5')).toBeVisible();
});
