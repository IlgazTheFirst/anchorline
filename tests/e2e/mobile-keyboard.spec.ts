import { expect, test } from '@playwright/test';
import { downloadText, tabTo } from './helpers';

test('mobile, keyboard only: setup, plan, change nights, see checks, apply, undo, export', async ({ page }) => {
  await page.goto('/');
  await tabTo(page, page.getByRole('link', { name: 'Start a new trip' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByLabel('Trip name'));
  await page.keyboard.type('Keyboard trip');
  await tabTo(page, page.getByLabel('Home city'));
  await page.keyboard.type('Keyton');
  await tabTo(page, page.getByLabel('Consecutive beach nights'));
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('4');
  await tabTo(page, page.getByRole('button', { name: 'Review summary' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Create trip and plan it' }));
  await page.keyboard.press('Enter');

  const preview = page.getByTestId('preview');
  await expect(preview).toBeVisible();
  await expect(page.getByRole('heading', { name: /Preview: Generate a plan/ })).toBeFocused();
  await tabTo(page, preview.getByRole('button', { name: 'Apply changes' }));
  await page.keyboard.press('Enter');
  await expect(preview).toBeHidden();

  const firstMore = page.locator('ol > li.card').first().getByRole('button', { name: /One night more/ });
  await tabTo(page, firstMore);
  await page.keyboard.press('Enter');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('Nights:');
  await tabTo(page, preview.getByRole('button', { name: 'Apply changes' }));
  await page.keyboard.press(' ');
  await expect(preview).toBeHidden();

  await expect(page.getByRole('heading', { name: 'Checks' })).toBeVisible();
  await expect(page.locator('.check.unresolved').first()).toBeVisible();

  await tabTo(page, page.getByRole('button', { name: 'Undo' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Undone' })).toHaveCount(1);

  const text = await downloadText(page, async () => {
    await tabTo(page, page.getByRole('button', { name: 'Export backup' }));
    await page.keyboard.press('Enter');
  });
  expect(JSON.parse(text).document.title).toBe('Keyboard trip');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
