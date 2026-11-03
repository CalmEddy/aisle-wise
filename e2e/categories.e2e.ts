import { expect, test } from '@playwright/test';
import { addItems, fresh, newStore, noPageErrors, row, saved } from './helpers';

test('brands get a category; the list shows categories and subcategories, and 🏷 turns them off', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page);
  await newStore(page, 'Corner');
  // A brand that isn't a starter item: guessed as it's typed.
  await page.getByRole('button', { name: 'Add items' }).first().click();
  await page.getByLabel('Item to add').fill('Cheerios');
  await expect(page.locator('.suggestion.new')).toContainText('Cold Cereal & Granola');
  await page.getByLabel('Item to add').press('Enter');
  await page.getByLabel('Item to add').fill('Tide pods, Jam');
  await page.getByLabel('Item to add').press('Enter');
  await page.locator('.add-sheet').getByRole('button', { name: 'Done' }).click();
  const products = await saved<any[]>(page, 'products');
  expect(products.find((p) => p.name === 'Cheerios').categoryId).toBe('breakfast_cereal_sub');
  expect(products.find((p) => p.name === 'Tide pods').categoryId).toBe('household_laundry');
  // "Jam" is another name for Jelly: linked to it, shown as typed.
  await expect(row(page, 'Jam')).toBeVisible();
  // In typical store order, under their categories and subcategories.
  const list = page.locator('.by-clue');
  await expect(list.locator('.list-cat-head')).toHaveText(['Breakfast & Cereal', 'Household & Cleaning']);
  await expect(list.locator('.list-sub-head')).toHaveText(['Cold Cereal & Granola', 'Nut Butters, Jams & Honey', 'Laundry']);
  await page.getByRole('button', { name: 'Categories in list' }).click();
  await expect(list.locator('.list-cat-head')).toHaveCount(0);
  // The picker: categories in walking order, subcategories under each.
  await row(page, 'Cheerios').getByRole('button', { name: 'More options for Cheerios' }).click();
  const picker = page.getByRole('combobox', { name: 'Category of Cheerios' });
  await expect(picker).toHaveValue(/Cold Cereal & Granola · Breakfast & Cereal/);
  await picker.click();
  const options = page.getByRole('listbox', { name: 'Category of Cheerios' }).getByRole('option');
  await expect(options.nth(0)).toHaveText(/No category/);
  // Current subcategory's parent and siblings come first for a quick switch.
  await expect(options.nth(1)).toHaveText(/Breakfast & Cereal/);
  await expect(options.nth(2)).toHaveText('Cold Cereal & Granola');
  await expect(options.filter({ hasText: 'Produce' }).first()).toBeVisible();
  await picker.fill('soup');
  await expect(options.first()).toContainText('Soup & Broth');
  await expect(options.first()).toContainText('Canned & Jarred Goods');
  ok();
});

test('saved with the first categories: moved over on load, places kept', async ({ page }) => {
  await fresh(page, {
    categories: [{ id: 'fruit', name: 'Fruit' }, { id: 'canned', name: 'Canned Goods & Soup' }, { id: 'c-mine', name: 'Camping' }],
    products: [
      { id: 'p-black-beans', name: 'Black beans', categoryId: 'canned', locations: { s1: 'sh1:canned' } },
      { id: 'p-x', name: 'Grandma’s chutney', categoryId: 'canned' },
      { id: 'p-tent', name: 'Tent pegs', categoryId: 'c-mine' },
    ],
    layouts: [{ id: 's1', name: 'Mine', width: 20, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 },
      places: [{ kind: 'shelf', id: 'sh1', label: 'Cans', orientation: 'vertical', x: 5, y: 2, length: 8, categories: ['canned'] }] }],
    activeLayout: 's1',
  });
  await expect.poll(async () => (await saved<any[]>(page, 'categories')).some((c) => c.id === 'fruit')).toBe(false);
  const products = await saved<any[]>(page, 'products');
  const cat = (name: string) => products.find((p) => p.name === name)?.categoryId;
  expect([cat('Black beans'), cat('Grandma’s chutney'), cat('Tent pegs')]).toEqual(['canned_beans', 'canned_jarred', 'c-mine']);
  expect(products.find((p) => p.name === 'Black beans').locations).toEqual({ s1: 'sh1:canned' });
  expect((await saved<any[]>(page, 'layouts'))[0].places[0].categories).toEqual(['canned_jarred']);
  expect((await saved<any[]>(page, 'categories')).some((c) => c.id === 'c-mine')).toBe(true);
});
