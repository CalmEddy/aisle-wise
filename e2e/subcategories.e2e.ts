import { expect, test } from '@playwright/test';
import { fresh, noPageErrors, saved } from './helpers';

test('tap a subcategory heading to move it under another category', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page);
  await page.getByRole('tab', { name: 'Items' }).click();
  // Open Breakfast & Cereal so Nut Butters heading is visible.
  await page.locator('.group-head', { hasText: 'Breakfast & Cereal' }).click();
  await page.getByRole('button', { name: 'Edit subcategory Nut Butters, Jams & Honey' }).click();
  const sheet = page.getByRole('dialog', { name: /Edit Nut Butters/ });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Condiments, Oils & Dressings', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText(/moved under Condiments/);
  const categories = await saved<{ id: string; parent?: string }[]>(page, 'categories');
  expect(categories.find((c) => c.id === 'breakfast_spreads')?.parent).toBe('condiments_sauces');
  // Items regroup under Condiments.
  await page.locator('.group-head', { hasText: 'Condiments, Oils & Dressings' }).click();
  await expect(page.getByRole('button', { name: 'Edit subcategory Nut Butters, Jams & Honey' })).toBeVisible();
  ok();
});

test('after reparent, Automatic follows the new top-level category (or says no shelf)', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page);
  await page.getByRole('tab', { name: 'Items' }).click();
  await page.locator('.group-head', { hasText: 'Breakfast & Cereal' }).click();
  await page.getByRole('button', { name: 'Edit subcategory Nut Butters, Jams & Honey' }).click();
  const sheet = page.getByRole('dialog', { name: /Edit Nut Butters/ });
  await sheet.getByRole('button', { name: 'Condiments, Oils & Dressings', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.toast')).toContainText(/moved under Condiments/);

  // Open Peanut butter: Automatic should name Condiments (or say no Condiments shelf), not Cereal.
  await page.getByLabel('Search or add grocery items').fill('Peanut butter');
  await page.locator('.item-entry .product-row', { hasText: 'Peanut butter' }).click();
  await expect(page.locator('.item-editor')).toBeVisible();
  const loc = page.getByLabel(/Location at/);
  const text = await loc.locator('option[value=""]').textContent();
  expect(text ?? '').toMatch(/Condiments|Automatic:/);
  expect(text ?? '').not.toMatch(/Cereal aisle|Breakfast/i);
  ok();
});
