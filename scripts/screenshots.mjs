// Regenerates README screenshots from the fictional demo and a generated plan.
// Usage: npm run build && (npm run preview &) && node scripts/screenshots.mjs
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:4173';
const out = new URL('../docs/screenshots/', import.meta.url).pathname;
const browser = await chromium.launch();

const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await desktop.goto(base);
await desktop.screenshot({ path: `${out}home.png` });
await desktop.getByRole('button', { name: 'Open the fictional demo' }).click();
await desktop.getByText('Fictional demo.').first().waitFor();
await desktop.screenshot({ path: `${out}demo-workspace.png` });
await desktop.getByLabel('When I change nights, move the later stops too').uncheck();
await desktop.locator('ol > li.card', { hasText: 'Cliff Cove' }).getByRole('button', { name: /One night fewer/ }).click();
await desktop.getByTestId('preview').waitFor();
await desktop.screenshot({ path: `${out}blocked-preview.png` });

await desktop.goto(`${base}/#/new`);
await desktop.getByLabel('Trip name').fill('Two weeks of food, temples and beaches');
await desktop.getByLabel('Home city').fill('Home');
await desktop.getByLabel('Leave home').fill('2031-02-01');
await desktop.getByLabel('First night away').fill('2031-02-02');
await desktop.getByLabel('Leave the last stop').fill('2031-02-16');
await desktop.getByLabel('Home by (date)').fill('2031-02-17');
await desktop.getByLabel('Consecutive beach nights').fill('5');
await desktop.getByRole('button', { name: 'Review summary' }).click();
await desktop.getByRole('button', { name: 'Create trip and plan it' }).click();
await desktop.getByTestId('preview').waitFor();
await desktop.screenshot({ path: `${out}generated-preview.png` });
await desktop.getByRole('button', { name: 'Apply changes' }).click();
await desktop.getByRole('tab', { name: 'Days' }).click();
await desktop.screenshot({ path: `${out}days.png` });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await mobile.goto(base);
await mobile.getByRole('button', { name: 'Open the fictional demo' }).click();
await mobile.getByText('Fictional demo.').first().waitFor();
await mobile.screenshot({ path: `${out}mobile.png` });
await browser.close();
console.log('Screenshots written to docs/screenshots/');
