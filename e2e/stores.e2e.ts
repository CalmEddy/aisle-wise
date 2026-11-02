import { expect, test } from '@playwright/test';
import { addItems, fresh, saved, tick } from './helpers';

test.use({ geolocation: { latitude: 39.1, longitude: -84.5 }, permissions: ['geolocation'] });

test('a new store where you stand is picked again when you come back', async ({ page, context }) => {
  await fresh(page);
  await page.getByRole('button', { name: /Change store/ }).click();
  await page.getByLabel('New store name').fill('Kroger Main St');
  await page.getByRole('button', { name: '＋ Here' }).click();
  await page.getByRole('button', { name: 'Create store' }).click(); // as a typical supermarket
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

test('a new store starts from a default map: pick the kind, see a preview, set the aisles', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: /Change store/ }).click();
  await page.getByLabel('New store name').fill('Corner');
  await page.getByRole('button', { name: '＋ Here' }).click();
  const sheet = page.getByRole('dialog', { name: 'Start the map' });
  await expect(sheet.getByRole('radio', { name: /Typical supermarket/ })).toHaveAttribute('aria-checked', 'true');
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
  // Milk goes where the default map has dairy, marked as a guess; checked off, it's asked about.
  await addItems(page, 'Milk');
  await expect(page.locator('.visit', { hasText: 'Milk' })).toContainText('likely');
  await tick(page, 'Milk');
  await expect(page.locator('.where-bar')).toBeVisible();
});
