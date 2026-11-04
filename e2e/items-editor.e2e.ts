import { expect, test } from '@playwright/test';
import { fresh, noPageErrors, saved } from './helpers';

async function openPeanutButter(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Items' }).click();
  await page.getByRole('button', { name: 'Grocery items' }).click();
  // Search jumps straight to the item without unfolding categories.
  await page.getByPlaceholder(/Search or add/).fill('Peanut butter');
  await page.locator('.item-entry .product-row', { hasText: 'Peanut butter' }).click();
  await expect(page.locator('.item-editor')).toBeVisible();
}

test('item editor: switch subcategory quickly and add a second category', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page);
  await openPeanutButter(page);
  await expect(page.locator('.cat-chip.primary')).toContainText(/Nut Butters/);
  // Sibling chips under Breakfast & Cereal.
  await page.getByRole('button', { name: 'Cold Cereal & Granola', exact: true }).click();
  await expect(page.locator('.cat-chip.primary')).toContainText(/Cold Cereal/);
  let products = await saved<{ name: string; categoryId?: string; extraCategoryIds?: string[] }[]>(page, 'products');
  expect(products.find((p) => p.name === 'Peanut butter')?.categoryId).toBe('breakfast_cereal_sub');
  // Add another category (Condiments).
  await page.getByRole('button', { name: '＋ Add another category' }).click();
  const add = page.getByRole('combobox', { name: 'Add another category' });
  await add.fill('Ketchup');
  await page.getByRole('listbox', { name: 'Add another category' }).getByRole('option').filter({ hasText: 'Ketchup, Mustard & Mayo' }).click();
  products = await saved(page, 'products');
  const pb = products.find((p) => p.name === 'Peanut butter')!;
  expect(pb.categoryId).toBe('breakfast_cereal_sub');
  expect(pb.extraCategoryIds).toEqual(['condiments_table']);
  await expect(page.locator('.cat-chip')).toHaveCount(2);
  ok();
});

test('item editor: set and clear a per-store price', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page);
  await openPeanutButter(page);
  const price = page.getByLabel(/Price for Peanut butter at/);
  await price.fill('4.29');
  await price.blur();
  await expect(page.locator('.item-editor')).toContainText(/\$4\.29/);
  let products = await saved<{ name: string; prices?: Record<string, { amount: number }> }[]>(page, 'products');
  const pb = products.find((p) => p.name === 'Peanut butter')!;
  expect(Object.values(pb.prices ?? {})[0]?.amount).toBe(4.29);
  await page.locator('.store-price-row').getByRole('button', { name: 'Clear' }).click();
  products = await saved(page, 'products');
  expect(products.find((p) => p.name === 'Peanut butter')?.prices).toBeFalsy();
  ok();
});

test('item editor: Clear returns Automatic location to Unknown', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page);
  await openPeanutButter(page);
  const loc = page.getByLabel(/Location at/);
  await expect(loc).toContainText(/Automatic:/);
  await page.getByRole('button', { name: /Clear location of Peanut butter/ }).click();
  await expect(loc).toHaveValue('__unknown__');
  const products = await saved<{ name: string; clearedAt?: string[] }[]>(page, 'products');
  const pb = products.find((p) => p.name === 'Peanut butter')!;
  expect(pb.clearedAt?.length).toBeGreaterThan(0);
  // Restore Automatic.
  await loc.selectOption('');
  await expect(loc).toHaveValue('');
  const after = (await saved<{ name: string; clearedAt?: string[] }[]>(page, 'products')).find((p) => p.name === 'Peanut butter')!;
  expect(after.clearedAt ?? []).toEqual([]);
  ok();
});
