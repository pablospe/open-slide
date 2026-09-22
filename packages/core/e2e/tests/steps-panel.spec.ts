import { writeFile } from 'node:fs/promises';
import { expect, type Locator, type Page, test } from '@playwright/test';
import {
  deleteSlide,
  duplicateSlide,
  editorCanvas,
  enterPlayMode,
  openSlide,
  readSlideSource,
  slideSourcePath,
} from './helpers.ts';

const SLIDE_ID = 'steps-panel';

const h2 = (text: string) => `<h2 style={{ fontSize: 64, margin: 0 }}>${text}</h2>`;

const deck = (
  imports: string,
  body: string[],
) => `import type { Page, SlideMeta } from '@open-slide/core';
${imports}export const meta: SlideMeta = { title: 'Steps panel', createdAt: '2026-01-01T00:00:00.000Z' };
const Intro: Page = () => <div style={{ padding: 80, fontSize: 48 }}>Intro page</div>;
const Reveal: Page = () => (
  <div style={{ width: '100%', height: '100%', padding: 80, background: '#101820', color: 'white', fontFamily: 'system-ui' }}>
${body.join('\n')}
  </div>
);
export default [Intro, Reveal] satisfies Page[];
`;

const STEPS_IMPORT = "import { Step, Steps } from '@open-slide/core';\n";

const initial = deck('', [`    ${h2('Alpha')}`, `    ${h2('Beta')}`, `    ${h2('Gamma')}`]);

const betaWrapped = deck(STEPS_IMPORT, [
  '    <Steps>',
  `      ${h2('Alpha')}`,
  '      <Step>',
  `        ${h2('Beta')}`,
  '      </Step>',
  `      ${h2('Gamma')}`,
  '    </Steps>',
]);

const bothWrapped = deck(STEPS_IMPORT, [
  '    <Steps>',
  `      ${h2('Alpha')}`,
  '      <Step>',
  `        ${h2('Beta')}`,
  '      </Step>',
  '      <Step>',
  `        ${h2('Gamma')}`,
  '      </Step>',
  '    </Steps>',
]);

const reordered = deck(STEPS_IMPORT, [
  '    <Steps>',
  `      ${h2('Alpha')}`,
  '      <Step>',
  `        ${h2('Gamma')}`,
  '      </Step>',
  '      <Step>',
  `        ${h2('Beta')}`,
  '      </Step>',
  '    </Steps>',
]);

function stepState(page: Page, root: Page | Locator, text: string) {
  return root
    .locator('[data-osd-step]')
    .filter({ has: page.getByText(text, { exact: true }) })
    .getAttribute('data-osd-step');
}

test.afterEach(async ({ page, request }) => {
  await page.close();
  await deleteSlide(request, SLIDE_ID);
});

test('wrap two elements in steps, reorder them, and present them in that order', async ({
  page,
  request,
}) => {
  await duplicateSlide(request, 'edit-target', SLIDE_ID);
  await writeFile(slideSourcePath(SLIDE_ID), initial);
  await openSlide(page, SLIDE_ID, '?p=2');
  const canvas = editorCanvas(page);
  await expect(canvas.getByText('Gamma', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-inspector-ready]')).toBeVisible();

  await canvas.getByText('Beta', { exact: true }).click();
  await page.keyboard.press('ControlOrMeta+Shift+S');
  await expect.poll(() => readSlideSource(SLIDE_ID)).toBe(betaWrapped);

  const panel = page.locator('aside[data-inspector-ui]');
  await panel.getByRole('tab', { name: 'Arrange', exact: true }).click();
  await expect(panel.locator('[data-step-status]')).toHaveText('Step 1 of 1');

  await canvas.getByText('Gamma', { exact: true }).click();
  await expect(panel.locator('[data-step-status]')).toContainText('Not a step');
  await panel.getByRole('button', { name: 'Wrap in step', exact: true }).click();
  await expect.poll(() => readSlideSource(SLIDE_ID)).toBe(bothWrapped);
  await expect(panel.locator('[data-step-status]')).toHaveText('Step 2 of 2');

  await panel.getByRole('button', { name: 'Reveal earlier', exact: true }).click();
  await expect.poll(() => readSlideSource(SLIDE_ID)).toBe(reordered);
  await expect(panel.locator('[data-step-status]')).toHaveText('Step 1 of 2');

  await expect(panel.getByRole('button', { name: 'Wrap in step', exact: true })).toBeDisabled();

  await panel.locator('[data-step-preview-toggle]').click();
  await expect(panel.locator('[data-step-preview-status]')).toHaveText('2/2');
  await panel.getByRole('slider').focus();
  await page.keyboard.press('Home');
  await expect(panel.locator('[data-step-preview-status]')).toHaveText('0/2');
  await expect(canvas.locator('[data-osd-step="pending"]')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => stepState(page, canvas, 'Gamma')).toBe('revealed');
  await expect.poll(() => stepState(page, canvas, 'Beta')).toBe('pending');
  await panel.locator('[data-step-preview-toggle]').click();
  await expect(canvas.locator('[data-osd-step="pending"]')).toHaveCount(0);
  expect(await readSlideSource(SLIDE_ID)).toBe(reordered);

  await openSlide(page, SLIDE_ID);
  await enterPlayMode(page);
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/[?&]p=2/);
  await expect(page.locator('[data-osd-step="pending"]')).toHaveCount(2);
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => stepState(page, page, 'Gamma')).toBe('revealed');
  await expect.poll(() => stepState(page, page, 'Beta')).toBe('pending');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-osd-step="revealed"]')).toHaveCount(2);
});

test('refuses to wrap an element whose parent holds text and leaves the file alone', async ({
  page,
  request,
}) => {
  const mixed = deck('', ['    Loose text', `    ${h2('Alpha')}`]);
  await duplicateSlide(request, 'edit-target', SLIDE_ID);
  await writeFile(slideSourcePath(SLIDE_ID), mixed);
  await openSlide(page, SLIDE_ID, '?p=2');
  const canvas = editorCanvas(page);
  await expect(canvas.getByText('Alpha', { exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('[data-inspector-ready]')).toBeVisible();

  await canvas.getByText('Alpha', { exact: true }).click();
  const panel = page.locator('aside[data-inspector-ui]');
  await panel.getByRole('tab', { name: 'Arrange', exact: true }).click();
  await expect(panel.locator('[data-step-refusal]')).toContainText('text or expressions');
  await expect(panel.getByRole('button', { name: 'Wrap in step', exact: true })).toBeDisabled();
  await page.keyboard.press('ControlOrMeta+Shift+S');
  await expect(page.getByText('Step change refused:')).toBeVisible();
  expect(await readSlideSource(SLIDE_ID)).toBe(mixed);
});
