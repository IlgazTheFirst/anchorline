import { expect, test } from '@playwright/test';
import { applyPreview, revision } from './helpers';

test('create → generate → edit → preview → apply → reload → undo → redo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Start a new trip' }).click();
  await page.getByLabel('Trip name').fill('Browser test trip');
  await page.getByLabel('Home city').fill('Testville');
  await page.getByLabel('Leave home').fill('2031-02-01');
  await page.getByLabel('First night away').fill('2031-02-02');
  await page.getByLabel('Leave the last stop').fill('2031-02-16');
  await page.getByLabel('Home by (date)').fill('2031-02-17');
  await page.getByLabel('Consecutive beach nights').fill('5');
  await page.getByRole('button', { name: 'Review summary' }).click();
  await expect(page.getByText('14 nights', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Create trip and plan it' }).click();

  await expect(page.getByRole('heading', { name: /Preview: Generate a plan/ })).toBeVisible();
  await applyPreview(page);
  await expect(page.getByText('14 nights planned')).toBeVisible();
  expect(await revision(page)).toBe(2);
  const firstStay = page.locator('ol > li.card').first();
  const nightsBefore = Number(await firstStay.locator('.nights strong').innerText());

  await firstStay.getByRole('button', { name: /One night more/ }).click();
  await expect(page.getByTestId('preview')).toContainText('Nights: 14 → 15');
  await applyPreview(page);
  expect(await revision(page)).toBe(3);

  await page.reload();
  await expect(page.getByText('15 nights planned')).toBeVisible();
  expect(Number(await page.locator('ol > li.card').first().locator('.nights strong').innerText())).toBe(nightsBefore + 1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('14 nights planned')).toBeVisible();
  expect(await revision(page)).toBe(4);
  await page.reload();
  await expect(page.getByText('14 nights planned')).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.getByText('15 nights planned')).toBeVisible();
  expect(await revision(page)).toBe(5);

  await page.getByRole('tab', { name: 'Travel' }).click();
  await expect(page.getByText('Planning estimate').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Evidence' }).click();
  await expect(page.getByText('Documented by a source').first()).toBeVisible();
});

test('a change that breaks a commitment is blocked and the plan stays as it was', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the fictional demo' }).click();
  const cliff = page.locator('ol > li.card', { hasText: 'Cliff Cove' });
  await page.getByLabel('When I change nights, move the later stops too').uncheck();
  await cliff.getByRole('button', { name: /One night fewer/ }).click();
  const preview = page.getByTestId('preview');
  await expect(preview).toContainText('would break a commitment');
  await expect(preview).toContainText('Seven consecutive beach nights');
  await expect(preview.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
  await preview.getByRole('button', { name: 'Keep current plan' }).click();
  expect(await revision(page)).toBe(1);
});
