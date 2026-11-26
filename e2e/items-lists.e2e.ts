import { expect, test } from '@playwright/test';
import { fresh, noPageErrors, saved, goTab, toggleListOptions } from './helpers';

/** The row options live in Shop's List options (Items shares them). */
async function setRowOption(page: import('@playwright/test').Page, name: 'Quantity stepper' | 'Prices', on: boolean) {
  await goTab(page, 'Shop');
  await toggleListOptions(page);
  const chip = page.getByRole('button', { name, exact: true });
  if ((await chip.getAttribute('aria-pressed')) !== String(on)) await chip.click();
  await toggleListOptions(page);
}

test('Items tab: names where adds go, has no list pill, and a View switch', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, {
    items: [{ id: 'a', name: 'Apples', done: false }],
  });

  await goTab(page, 'Items');
  await expect(page.locator('.also-list')).toContainText('Add to “Shopping list”');
  await expect(page.locator('.list-bar')).toHaveCount(0);

  // Make a list on the Lists tab and shop it; Items then adds to it.
  await goTab(page, 'Lists');
  await page.getByLabel('Which list').selectOption({ value: '__new__' });
  await page.getByLabel('New list name').fill('Party');
  await page.getByRole('button', { name: '+ Create' }).click();
  await goTab(page, 'Shop');
  await page.locator('.list-pick-hero').click();
  await page.locator('.list-pick', { hasText: 'Party' }).click();
  await goTab(page, 'Items');
  await expect(page.locator('.also-list')).toContainText('Add to “Party”');

  // Search and add Milk onto the active list; toast names the list.
  await page.getByLabel('Search or add grocery items').fill('Milk');
  await page.getByRole('button', { name: 'Add Milk to “Party”' }).click();
  await expect(page.locator('.toast')).toContainText('Added Milk to “Party”');

  const lists = await saved<{ id: string; name: string }[]>(page, 'lists');
  const party = lists.find((l) => l.name === 'Party');
  expect(party).toBeTruthy();
  const items = await saved<{ name: string; listId?: string }[]>(page, 'items');
  expect(items.some((i) => i.name === 'Milk' && i.listId === party!.id)).toBe(true);

  // View: by category (current) or one A–Z list.
  await expect(page.getByRole('radio', { name: 'Show by category' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Group by category' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Show A–Z' }).click();
  await expect(page.getByRole('radio', { name: 'Show A–Z' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.group-head')).toHaveCount(0);

  const display = await saved<{ itemsSort?: string; itemsGroupByCategory?: boolean }>(page, 'display');
  expect(display.itemsSort).toBe('alpha');
  expect(display.itemsGroupByCategory).toBe(false);
  ok();
});

test('Items tab: qty stepper and price toggle match Shop, prices are line totals', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, {
    items: [{ id: 'm1', name: 'Milk', done: false, productId: 'p-milk' }],
  });

  await setRowOption(page, 'Prices', false);
  await goTab(page, 'Items');
  await page.getByLabel('Search or add grocery items').fill('Milk');
  const milk = page.locator('.item-entry').filter({ has: page.getByRole('button', { name: /Milk is on/ }) }).first();

  // Qty stepper is on by default (the same option as Shop; Items has no toggles of its own).
  await expect(page.getByRole('button', { name: 'Quantity stepper' })).toHaveCount(0);
  await milk.getByRole('button', { name: 'One more Milk' }).click();
  await expect(milk.locator('.qty-stepper-value')).toHaveText('2');

  // Prices start off; turning them on in Shop's List options reveals an inline price control here.
  await expect(milk.getByRole('button', { name: /Add unit price for Milk/ })).toHaveCount(0);
  await setRowOption(page, 'Prices', true);
  await goTab(page, 'Items');
  await page.getByLabel('Search or add grocery items').fill('Milk');
  await milk.getByRole('button', { name: /Add unit price for Milk/ }).click();
  await milk.getByLabel('Unit price for Milk').fill('3.49');
  await milk.getByLabel('Unit price for Milk').press('Enter');
  // Viewed amount is qty × unit price.
  await expect(milk.getByRole('button', { name: /Line total for Milk: \$6\.98/ })).toBeVisible();

  const items = await saved<{ name: string; qty?: number; price?: number }[]>(page, 'items');
  expect(items.find((i) => i.name === 'Milk')).toMatchObject({ qty: 2, price: 3.49 });
  const display = await saved<{ listPrice?: boolean; listQty?: boolean }>(page, 'display');
  expect(display.listPrice).toBe(true);
  ok();
});

test('Items tab: the Qty and Price options work while browsing items not yet on the list', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page); // empty shopping list
  await goTab(page, 'Items');
  await page.getByLabel('Search or add grocery items').fill('Apples');

  // Qty on (default): steppers show on catalog rows (not only on-list items).
  const apples = page.locator('.item-entry').filter({ has: page.locator('.product-row .item-name', { hasText: /^Apples$/ }) }).first();
  await expect(apples.getByRole('button', { name: 'One more Apples' })).toBeVisible();
  await setRowOption(page, 'Quantity stepper', false);
  await goTab(page, 'Items');
  await page.getByLabel('Search or add grocery items').fill('Apples');
  await expect(apples.getByRole('button', { name: 'One more Apples' })).toHaveCount(0);

  // Prices on: price control appears; setting a price adds the item to the list.
  await setRowOption(page, 'Prices', true);
  await goTab(page, 'Items');
  await page.getByLabel('Search or add grocery items').fill('Apples');
  await expect(apples.getByRole('button', { name: /Add unit price for Apples/ })).toBeVisible();
  await apples.getByRole('button', { name: /Add unit price for Apples/ }).click();
  await apples.getByLabel('Unit price for Apples').fill('1.29');
  await apples.getByLabel('Unit price for Apples').press('Enter');
  await expect(apples.getByRole('button', { name: /Apples is on/ })).toBeVisible();
  const items = await saved<{ name: string; price?: number }[]>(page, 'items');
  expect(items.find((i) => i.name === 'Apples')).toMatchObject({ price: 1.29 });
  ok();
});

test('Items tab: quiet by default (no idle hint, no empty filter chips, no list pill)', async ({ page }) => {
  await fresh(page);
  await goTab(page, 'Items');
  await expect(page.getByText('Swipe an item for shortcuts')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^No category/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Not sold here/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Needs a place/ })).toBeVisible();
  await expect(page.locator('.list-bar')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Jump to category' })).toHaveCount(0);
});
