import { expect, test } from '@playwright/test';
import { fresh, saved } from './helpers';

test.use({ geolocation: { latitude: 39.1, longitude: -84.5 }, permissions: ['geolocation'] });

test('a new store where you stand is picked again when you come back', async ({ page, context }) => {
  await fresh(page);
  await page.getByRole('button', { name: /Change store/ }).click();
  await page.getByLabel('New store name').fill('Kroger Main St');
  await page.getByRole('button', { name: '＋ Here' }).click();
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
