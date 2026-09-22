import { expect, test } from '@playwright/test';
import { deleteSlide, duplicateSlide, openSlide, readSlideSource } from './helpers';

const slideId = 'add-page-e2e';

test.describe('add page', () => {
  test.beforeEach(async ({ request }) => {
    await duplicateSlide(request, 'alpha', slideId);
  });

  test.afterEach(async ({ request }) => {
    await deleteSlide(request, slideId);
  });

  test('adds blank pages from the rail and keeps them after reload', async ({ page }) => {
    await openSlide(page, slideId);
    const rail = page
      .getByRole('complementary')
      .filter({ has: page.getByRole('button', { name: 'Slide overview (O)' }) });
    await expect(rail.getByRole('button', { name: /^Go to page \d+$/ })).toHaveCount(3);

    await rail.getByRole('button', { name: 'Go to page 1' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add page after' }).click();

    await expect(rail.getByRole('button', { name: /^Go to page \d+$/ })).toHaveCount(4);
    await expect(page).toHaveURL(/[?&]p=2\b/);
    await expect
      .poll(() => readSlideSource(slideId))
      .toContain('export default [One, Page2, Two, Three] satisfies Page[];');
    const source = await readSlideSource(slideId);
    expect(source).toContain(
      "const Page2: Page = () => <div style={{ width: '100%', height: '100%' }} />;",
    );
    expect(source).toContain(
      "export const notes: (string | undefined)[] = ['Alpha speaker note', undefined, undefined, 'Alpha final note'];",
    );

    await rail.getByRole('button', { name: 'Add a blank page at the end' }).click();
    await expect(rail.getByRole('button', { name: /^Go to page \d+$/ })).toHaveCount(5);
    await expect(page).toHaveURL(/[?&]p=5\b/);
    await expect
      .poll(() => readSlideSource(slideId))
      .toContain('export default [One, Page2, Two, Three, Page5] satisfies Page[];');

    await page.reload();
    await expect(rail.getByRole('button', { name: /^Go to page \d+$/ })).toHaveCount(5);
    await expect(page).toHaveURL(/[?&]p=5\b/);
  });
});
