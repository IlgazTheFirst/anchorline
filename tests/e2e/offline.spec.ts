import { expect, test } from '@playwright/test';
import { applyPreview, downloadText, openDemo, revision } from './helpers';

test('production build: save, go offline, reload, keep editing and exporting', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await openDemo(page);
  const url = page.url();

  await context.setOffline(true);
  await page.goto(url);
  await expect(page.getByText('Fictional demo.').first()).toBeVisible();
  await expect(page.getByText('You are offline.', { exact: false })).toBeVisible();

  await page.locator('ol > li.card', { hasText: 'Market City' }).getByRole('button', { name: 'Lock dates' }).click();
  await applyPreview(page);
  expect(await revision(page)).toBe(2);
  await page.reload();
  expect(await revision(page)).toBe(2);
  const backup = await downloadText(page, () => page.getByRole('button', { name: 'Export backup' }).click());
  expect(JSON.parse(backup).document.revision).toBe(2);
  await context.setOffline(false);
});
