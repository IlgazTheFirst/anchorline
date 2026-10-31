import { expect, test } from '@playwright/test';
import { applyPreview, openDemo, revision } from './helpers';

test('two tabs: the older proposal gets a conflict and nothing is overwritten', async ({ page, context }) => {
  await openDemo(page);
  const url = page.url();
  const tabB = await context.newPage();
  await tabB.goto(url);
  await expect(tabB.getByText('Fictional demo.').first()).toBeVisible();

  await tabB.locator('ol > li.card', { hasText: 'Market City' }).getByRole('button', { name: 'Lock dates' }).click();
  await expect(tabB.getByTestId('preview')).toContainText('Ready to apply');

  await page.locator('ol > li.card', { hasText: 'Harbour City' }).getByRole('button', { name: 'Lock dates' }).click();
  await applyPreview(page);
  expect(await revision(page)).toBe(2);

  const previewB = tabB.getByTestId('preview');
  const applyB = previewB.getByRole('button', { name: 'Apply changes' });
  if (await applyB.isEnabled()) await applyB.click();
  await expect(tabB.getByText(/older version of the plan|Conflict/).first()).toBeVisible();

  await page.reload();
  expect(await revision(page)).toBe(2);
  await expect(page.locator('ol > li.card', { hasText: 'Harbour City' }).getByText('dates locked')).toBeVisible();
  await expect(page.locator('ol > li.card', { hasText: 'Market City' }).getByText('dates locked')).toHaveCount(0);
});
