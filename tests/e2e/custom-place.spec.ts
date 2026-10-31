import { expect, test } from '@playwright/test';
import { applyPreview } from './helpers';

test('a place outside the catalogue: name, time zone, stay, journeys and an honest coverage message', async ({ page }) => {
  await page.goto('/#/new');
  await page.getByLabel('Trip name').fill('Custom place trip (fictional)');
  await page.getByLabel('Home city').fill('Example Town');
  await page.getByLabel('Home time zone').selectOption('Europe/London');
  await page.getByLabel('Leave home').fill('2031-03-01');
  await page.getByLabel('First night away').fill('2031-03-02');
  await page.getByLabel('Leave the last stop').fill('2031-03-08');
  await page.getByLabel('Home by (date)').fill('2031-03-10');
  await page.getByRole('button', { name: 'Review summary' }).click();
  await page.getByRole('button', { name: 'Create an empty trip (plan by hand)' }).click();

  const add = page.getByRole('region', { name: 'Add a stop' });
  await add.getByLabel('Place', { exact: true }).selectOption({ label: 'Somewhere else (plan by hand)…' });
  await expect(add.getByText('Outside the catalogue there are no automatic routes')).toBeVisible();
  await add.getByLabel('Place name').fill('Example Isle (fictional)');
  await add.getByLabel('Time zone').selectOption('Pacific/Auckland');
  await add.getByLabel('Tags').fill('beach');
  await add.getByLabel('Check-in').fill('2031-03-02');
  await add.getByLabel('Nights').fill('6');
  await add.getByRole('button', { name: 'Preview new stop' }).click();
  await expect(page.getByTestId('preview')).toContainText('Added: Example Isle (fictional)');
  await applyPreview(page);

  const stay = page.locator('ol > li.card', { hasText: 'Example Isle (fictional)' });
  await expect(stay).toContainText('6 nights');
  await expect(stay).toContainText('Your own place.');
  await expect(page.getByText('6 nights planned')).toBeVisible();

  await page.getByRole('tab', { name: 'Travel' }).click();
  const back = page.getByRole('region', { name: 'Example Isle (fictional) to Example Town' });
  await expect(back).toContainText('No times yet');
  await expect(back).toContainText('to be decided');
  await back.getByRole('button', { name: 'Edit journey…' }).click();
  await back.getByLabel('How (mode, carrier or service)').fill('ferry, then flights');
  await back.getByLabel('Departs (local time, Pacific/Auckland)').fill('2031-03-08T10:00');
  await back.getByLabel('Arrives (local time, Europe/London)').fill('2031-03-09T07:00');
  await back.getByRole('button', { name: 'Preview journey change' }).click();
  await applyPreview(page);
  await expect(back).toContainText('Entered by you');
  await expect(back).toContainText('34 h on the times you entered.');
  await page.getByRole('button', { name: /Show \d+ met check/ }).click();
  await expect(page.getByText(/Ready at .* before the deadline/)).toBeVisible();
});
