import fs from 'node:fs/promises';
import { expect, type Locator, test } from '@playwright/test';
import {
  deleteSlide,
  duplicateSlide,
  editorCanvas,
  openSlide,
  readSlideSource,
  slideSourcePath,
} from './helpers.ts';

function compose(element: Locator, values: string[]): Promise<void> {
  return element.evaluate((node, steps) => {
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    for (const value of steps) {
      node.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          inputType: 'insertCompositionText',
          isComposing: true,
        }),
      );
      node.textContent = value;
      node.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    }
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  }, values);
}

const REUSED_CARDS_DECK = `export const meta = { title: 'Inline props' };
const Card = ({ title }: { title: string }) => <h2>{title}</h2>;
export default [() => (
  <div style={{ padding: 120, fontSize: 40 }}>
    <Card title="Alpha" />
    <Card title="Beta" />
  </div>
)];
`;

test.describe('inline prop text', () => {
  const slideId = 'inline-prop-regression';

  test.beforeEach(async ({ page, request }) => {
    await duplicateSlide(request, 'edit-target', slideId);
    await fs.writeFile(slideSourcePath(slideId), REUSED_CARDS_DECK);
    await openSlide(page, slideId);
    await expect(editorCanvas(page).getByText('Alpha', { exact: true })).toBeVisible();
  });

  test.afterEach(async ({ request }) => {
    await deleteSlide(request, slideId);
  });

  test('keeps the source value through typing, a failed save, and retry', async ({ page }) => {
    const alpha = editorCanvas(page).getByText('Alpha', { exact: true });
    await alpha.dblclick();
    await expect(alpha).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type(' edited');
    await page.keyboard.press('Escape');

    await page.route('**/__edit/batch', (route) => route.abort(), { times: 1 });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/Couldn't save/)).toBeVisible();
    expect(await readSlideSource(slideId)).toBe(REUSED_CARDS_DECK);

    const edited = editorCanvas(page).getByText('Alpha edited', { exact: true });
    await edited.dblclick();
    await expect(edited).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type(' again');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readSlideSource(slideId)).toContain('title="Alpha edited again"');
    expect(await readSlideSource(slideId)).toContain('title="Beta"');
    await page.reload();
    await expect(editorCanvas(page).getByText('Alpha edited again', { exact: true })).toBeVisible();
    await expect(editorCanvas(page).getByText('Beta', { exact: true })).toBeVisible();
  });

  test('saves when the first keystroke is not whitespace', async ({ page }) => {
    const alpha = editorCanvas(page).getByText('Alpha', { exact: true });
    await alpha.dblclick();
    await expect(alpha).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type('-edited');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readSlideSource(slideId)).toContain('title="Alpha-edited"');
    expect(await readSlideSource(slideId)).toContain('title="Beta"');
  });

  test('edits the second call site without touching the first', async ({ page }) => {
    const beta = editorCanvas(page).getByText('Beta', { exact: true });
    await beta.dblclick();
    await expect(beta).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type('-edited');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readSlideSource(slideId)).toContain('title="Beta-edited"');
    expect(await readSlideSource(slideId)).toContain('title="Alpha"');
  });

  test('discard restores the text from before the first input event', async ({ page }) => {
    const alpha = editorCanvas(page).getByText('Alpha', { exact: true });
    await alpha.dblclick();
    await expect(alpha).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type('-edited');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(editorCanvas(page).getByText('Alpha', { exact: true })).toBeVisible();
    await expect(editorCanvas(page).getByText('Beta', { exact: true })).toBeVisible();
    expect(await readSlideSource(slideId)).toBe(REUSED_CARDS_DECK);
  });

  test('keeps the original value while composing text', async ({ page }) => {
    const alpha = editorCanvas(page).getByText('Alpha', { exact: true });
    await alpha.dblclick();
    await expect(alpha).toHaveAttribute('contenteditable', 'true');
    await compose(alpha, ['Alpha z', 'Alpha zh', 'Alpha 中文']);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readSlideSource(slideId)).toContain('title="Alpha 中文"');
    expect(await readSlideSource(slideId)).toContain('title="Beta"');
  });

  test('undo restores the text from before the first keystroke', async ({ page }) => {
    const alpha = editorCanvas(page).getByText('Alpha', { exact: true });
    await alpha.dblclick();
    await expect(alpha).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type('-edited');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(editorCanvas(page).getByText('Alpha', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(editorCanvas(page).getByText('Alpha-edited', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readSlideSource(slideId)).toContain('title="Alpha-edited"');
    expect(await readSlideSource(slideId)).toContain('title="Beta"');
  });

  test('resyncs the original value when composing after an outside DOM change', async ({
    page,
  }) => {
    const alpha = editorCanvas(page).getByText('Alpha', { exact: true });
    await alpha.dblclick();
    await expect(alpha).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type('-draft');
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(alpha).toHaveText('Alpha');
    await expect(alpha).toHaveAttribute('contenteditable', 'true');
    await compose(alpha, ['Alpha z', 'Alpha 中文']);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readSlideSource(slideId)).toContain('title="Alpha 中文"');
    expect(await readSlideSource(slideId)).toContain('title="Beta"');
  });
});

const NBSP_DECK = `export const meta = { title: 'Inline NBSP' };
const Card = ({ title }: { title: string }) => <h2>{title}</h2>;
export default [() => (
  <div style={{ padding: 120, fontSize: 40 }}>
    <Card title="Alpha Beta" />
    <Card title={"Alpha\\u00a0Beta"} />
  </div>
)];
`;

test.describe('inline prop text with NBSP', () => {
  const slideId = 'inline-prop-nbsp';

  test.beforeEach(async ({ page, request }) => {
    await duplicateSlide(request, 'edit-target', slideId);
    await fs.writeFile(slideSourcePath(slideId), NBSP_DECK);
    await openSlide(page, slideId);
    await expect(editorCanvas(page).locator('h2').nth(1)).toBeVisible();
  });

  test.afterEach(async ({ request }) => {
    await deleteSlide(request, slideId);
  });

  test('edits the NBSP call site, not its plain-space twin', async ({ page }) => {
    const nbsp = editorCanvas(page).locator('h2').nth(1);
    await nbsp.dblclick();
    await expect(nbsp).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type('-x');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => readSlideSource(slideId)).toContain('Beta-x');
    const saved = await readSlideSource(slideId);
    expect(saved).toContain('<Card title="Alpha Beta" />');
    expect(saved).not.toContain('Alpha\\u00a0Beta"');
  });
});
