import { expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

export async function openDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open the fictional demo' }).click();
  await expect(page.getByText('Fictional demo.', { exact: false }).first()).toBeVisible();
}

export async function applyPreview(page: Page) {
  const preview = page.getByTestId('preview');
  await expect(preview).toBeVisible();
  await preview.getByRole('button', { name: 'Apply changes' }).click();
  await expect(preview).toBeHidden();
}

export async function revision(page: Page): Promise<number> {
  const text = await page.locator('.header-title small').innerText();
  return Number(/revision (\d+)/.exec(text)?.[1]);
}

/** Moves focus with the Tab key only, until the target has focus. */
export async function tabTo(page: Page, target: Locator, max = 250) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Could not reach the control with the keyboard');
}

export async function downloadText(page: Page, trigger: () => Promise<void>): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  const path = await download.path();
  return readFile(path!, 'utf8');
}
