import { expect, test, type Page } from '@playwright/test';
import { applyPreview, revision } from './helpers';

/**
 * The core workflow, at desktop and mobile sizes, with a screenshot at each
 * step saved to docs/demo/. All inputs are made up; no real trip is used.
 */
const SIZES = [
  { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
] as const;

for (const size of SIZES) {
  test.describe(`core workflow (${size.name})`, () => {
    test.use(size.use);

    test('create → edit a stay → preview → apply → reload → undo', async ({ page }) => {
      const shot = (step: string) => page.screenshot({ path: `docs/demo/${size.name}-${step}.png` });
      const nightsPlanned = (n: number) => expect(page.getByText(`${n} nights planned`)).toBeVisible();

      await page.goto('/#/new');
      await page.getByLabel('Trip name').fill('Example trip (fictional)');
      await page.getByLabel('Home city').fill('Example Town');
      await page.getByLabel('Leave home').fill('2031-02-01');
      await page.getByLabel('First night away').fill('2031-02-02');
      await page.getByLabel('Leave the last stop').fill('2031-02-14');
      await page.getByLabel('Home by (date)').fill('2031-02-15');
      await page.getByLabel('Consecutive beach nights').fill('4');
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot('01-create-trip');

      await page.getByRole('button', { name: 'Review summary' }).click();
      await expect(page.getByRole('heading', { name: 'Check before planning' })).toBeVisible();
      await shot('02-summary');

      await page.getByRole('button', { name: 'Create trip and plan it' }).click();
      await expect(page.getByRole('heading', { name: /Preview: Generate a plan/ })).toBeVisible();
      await shot('03-plan-preview');
      await applyPreview(page);
      await nightsPlanned(12);
      expect(await revision(page)).toBe(2);
      await scrollTo(page, page.locator('ol > li.card').first());
      await shot('04-plan-applied');

      const first = page.locator('ol > li.card').first();
      const before = Number(await first.locator('.nights strong').innerText());
      await first.getByRole('button', { name: /One night more/ }).click();
      const preview = page.getByTestId('preview');
      await expect(preview).toContainText('Nights: 12 → 13');
      await expect(preview).toContainText('Ready to apply');
      await shot('05-edit-stay-preview');

      await applyPreview(page);
      await nightsPlanned(13);
      expect(await revision(page)).toBe(3);
      await scrollTo(page, page.locator('ol > li.card').first());
      await shot('06-applied-and-saved');

      await page.reload();
      await nightsPlanned(13);
      expect(Number(await page.locator('ol > li.card').first().locator('.nights strong').innerText())).toBe(before + 1);
      await scrollTo(page, page.locator('ol > li.card').first());
      await shot('07-after-reload');

      await page.getByRole('button', { name: 'Undo' }).click();
      await nightsPlanned(12);
      expect(await revision(page)).toBe(4);
      expect(Number(await page.locator('ol > li.card').first().locator('.nights strong').innerText())).toBe(before);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot('08-after-undo');
    });
  });
}

async function scrollTo(page: Page, target: ReturnType<Page['locator']>) {
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
}
