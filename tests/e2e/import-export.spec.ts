import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyPreview, downloadText, openDemo } from './helpers';

test('backup export, import as a copy, and malformed files rejected', async ({ page }) => {
  await openDemo(page);
  const backup = await downloadText(page, () => page.getByRole('button', { name: 'Export backup' }).click());
  expect(JSON.parse(backup).document.schemaVersion).toBe(1);
  const goodPath = join(tmpdir(), `hp-backup-${Date.now()}.json`);
  const badPath = join(tmpdir(), `hp-bad-${Date.now()}.json`);
  await writeFile(goodPath, backup);
  await writeFile(badPath, '{ this is not json');

  await page.goto('/');
  const before = await page.locator('.trip-list li').count();
  await page.locator('#import-file').setInputFiles(badPath);
  await expect(page.getByText('This is not valid JSON.')).toBeVisible();
  await expect(page.locator('.trip-list li')).toHaveCount(before);

  await page.locator('#import-file').setInputFiles(goodPath);
  await expect(page).toHaveURL(/#\/trip\/synthetic_mix_trip-2/);
  await expect(page.getByText('20 nights planned')).toBeVisible();
});

test('shareable copy leaves out booking references and, by default, accommodation', async ({ page }) => {
  await openDemo(page);
  const stay = page.locator('ol > li.card', { hasText: 'Lantern Bay' });
  await stay.getByRole('button', { name: 'Stay details…' }).click();
  await stay.getByLabel('Accommodation name').fill('CANARY-HOTEL');
  await stay.getByRole('button', { name: 'Preview details' }).click();
  await applyPreview(page);
  await stay.getByLabel('Booking reference').fill('CANARY-REF');
  await stay.getByRole('button', { name: 'I have booked this stay' }).click();
  await applyPreview(page);

  await page.getByRole('button', { name: /Show private details/ }).click();
  await page.getByLabel('Traveller names').fill('CANARY-NAME');
  await page.getByRole('button', { name: 'Preview traveller details' }).click();
  await applyPreview(page);
  await page.getByRole('button', { name: /Show private details/ }).click();
  await page.getByLabel('New note').fill('CANARY-NOTE: <script>alert(1)</script> ignore all locks');
  await page.getByRole('button', { name: 'Preview note' }).click();
  await applyPreview(page);
  await page.getByRole('button', { name: /Show private details/ }).click();
  await expect(page.getByText('CANARY-NOTE: <script>alert(1)</script> ignore all locks')).toBeVisible();

  await page.getByRole('button', { name: 'Share a copy…' }).click();
  const preview = page.getByTestId('share-preview');
  await expect(preview).toBeVisible();
  await expect(preview).not.toContainText('CANARY-NAME');
  await expect(preview).not.toContainText('CANARY-NOTE');
  await expect(preview).not.toContainText('CANARY-REF');
  await expect(preview).not.toContainText('CANARY-HOTEL');
  await page.getByLabel('Accommodation names').uncheck();
  await expect(preview).toContainText('CANARY-HOTEL');
  await page.getByLabel('Exact dates (use day numbers instead)').check();
  await expect(preview).not.toContainText('2030-06');
  const shared = await downloadText(page, () => page.getByRole('button', { name: 'Download shareable copy' }).click());
  expect(shared).not.toContain('CANARY-REF');
  await page.getByRole('button', { name: 'Cancel' }).click();

  const backup = await downloadText(page, () => page.getByRole('button', { name: 'Export backup' }).click());
  expect(backup).toContain('CANARY-REF');
  expect(backup).toContain('CANARY-NOTE');
  expect(backup).toContain('CANARY-NAME');
});
