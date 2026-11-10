import { expect, test } from '@playwright/test';
import { addItems, fresh, row, saved, tick } from './helpers';

test.use({ geolocation: { latitude: 39.1, longitude: -84.5 }, permissions: ['geolocation'] });

test('a new store where you stand is picked again when you come back', async ({ page, context }) => {
  await fresh(page);
  await page.getByRole('button', { name: /Change store/ }).click();
  await page.getByLabel('New store name').fill('Kroger Main St');
  await page.getByRole('button', { name: '＋ Here' }).click();
  await page.getByRole('button', { name: 'Create typical store' }).click();
  await expect(page.locator('.store-pick')).toContainText('Kroger Main St');
  const kroger = (await saved<any[]>(page, 'layouts')).find((l) => l.name === 'Kroger Main St');
  expect(kroger.geo).toEqual({ lat: 39.1, lon: -84.5 });

  await page.getByRole('button', { name: /Change store/ }).click();
  await page.locator('.store-row-btn', { hasText: 'Demo Market' }).click();
  await expect(page.locator('.store-pick')).toContainText('Demo Market');
  await page.reload();
  await expect(page.locator('.store-pick')).toContainText('Kroger Main St');

  // Somewhere else: no switch.
  await context.setGeolocation({ latitude: 39.2, longitude: -84.5 });
  await page.getByRole('button', { name: /Change store/ }).click();
  await page.locator('.store-row-btn', { hasText: 'Demo Market' }).click();
  await page.reload();
  await page.waitForTimeout(800);
  await expect(page.locator('.store-pick')).toContainText('Demo Market');
});

test('store picker shows list price totals and marks the cheapest store', async ({ page }) => {
  await fresh(page);
  // Second store so comparison has somewhere else to go.
  await page.getByRole('button', { name: /Change store/ }).click();
  await page.getByLabel('New store name').fill('Aldi');
  await page.getByRole('button', { name: '＋ Here' }).click();
  await page.getByRole('button', { name: 'Other layouts or blank…' }).click();
  await page.getByRole('radio', { name: /Blank/ }).click();
  await page.getByRole('button', { name: 'Create store' }).click();
  await expect(page.locator('.store-pick')).toContainText('Aldi');

  // Remember Milk cheaper at Demo than Aldi.
  const products = await saved<any[]>(page, 'products');
  const layouts = await saved<any[]>(page, 'layouts');
  const demoId = layouts.find((l) => l.name === 'Demo Market')!.id;
  const aldiId = layouts.find((l) => l.name === 'Aldi')!.id;
  const next = products.map((p) => (p.name === 'Milk'
    ? { ...p, prices: { [demoId]: { amount: 2.5, at: '2026-01-01T00:00:00.000Z' }, [aldiId]: { amount: 3.5, at: '2026-01-01T00:00:00.000Z' } } }
    : p));
  await page.evaluate((ps) => localStorage.setItem('aw.products', JSON.stringify(ps)), next);
  await page.reload();
  await addItems(page, 'Milk');
  await page.getByRole('button', { name: /Change store/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Stores' });
  await expect(sheet).toContainText(/List totals use remembered prices/);
  await expect(sheet.locator('.store-row-btn', { hasText: 'Demo Market' })).toContainText(/best price/);
  await expect(sheet.locator('.store-row-btn', { hasText: 'Demo Market' })).toContainText(/\$2\.50/);
  await expect(sheet.locator('.store-row-btn', { hasText: 'Aldi' })).toContainText(/\$3\.50/);
});

test('a new store starts from a default map: pick the kind, see a preview, set the aisles', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: /Change store/ }).click();
  await page.getByLabel('New store name').fill('Corner');
  await page.getByRole('button', { name: '＋ Here' }).click();
  const sheet = page.getByRole('dialog', { name: 'Start the map' });
  await expect(sheet.getByRole('radio', { name: /Typical supermarket/ })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: 'Other layouts or blank…' }).click();
  await sheet.getByRole('radio', { name: /Small store/ }).click();
  await expect(sheet.locator('input[type=number]')).toHaveValue('7');
  await sheet.getByRole('button', { name: 'More Aisles' }).click();
  await expect(sheet.getByLabel('Preview').locator('svg.map')).toBeVisible();
  await sheet.getByRole('button', { name: 'Create store' }).click();
  const corner = async () => (await saved<any[]>(page, 'layouts')).find((l) => l.name === 'Corner');
  await expect.poll(async () => (await corner())?.gen?.template).toBe('small');
  const l = await corner();
  expect(l.gen.aisleCount).toBe(8);
  expect(l.aisles).toHaveLength(8);
  // Milk goes where the default map has dairy (dashed guess shelves); checked off, it's asked about.
  await addItems(page, 'Milk');
  await expect(row(page, 'Milk')).toBeVisible();
  await expect(page.locator('svg.map .place.guess')).not.toHaveCount(0);
  await tick(page, 'Milk');
  // Template dairy home is a clear guess → quiet save (Change opens the bar).
  await expect(page.locator('.toast')).toContainText(/Milk: saved at/i);
  await expect(page.locator('.where-bar')).toHaveCount(0);
});
