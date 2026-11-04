import { expect, test } from '@playwright/test';
import { fresh, noPageErrors, saved } from './helpers';

test('Items tab: list bar, create list, named add toast, sort and group toggles', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, {
    items: [{ id: 'a', name: 'Apples', done: false }],
  });

  await page.getByRole('tab', { name: 'Items' }).click();
  await expect(page.locator('.list-bar-name')).toHaveText('Shopping list');
  await expect(page.locator('.also-list')).toContainText('Add to “Shopping list”');

  // Create a list from Items without leaving the catalog.
  await page.locator('.list-bar').click();
  await page.getByLabel('New list name').fill('Party');
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('button', { name: 'Shop this list' }).click();
  await expect(page.locator('.list-bar-name')).toHaveText('Party');
  await expect(page.locator('.also-list')).toContainText('Add to “Party”');
  await expect(page.getByRole('button', { name: 'Grocery items' })).toHaveClass(/active/);

  // Search and add Milk onto the active list; toast names the list.
  await page.getByPlaceholder(/Search or add/).fill('Milk');
  await page.getByRole('button', { name: 'Add Milk to “Party”' }).click();
  await expect(page.locator('.toast')).toContainText('Added Milk to “Party”');

  const lists = await saved<{ id: string; name: string }[]>(page, 'lists');
  const party = lists.find((l) => l.name === 'Party');
  expect(party).toBeTruthy();
  const items = await saved<{ name: string; listId?: string }[]>(page, 'items');
  expect(items.some((i) => i.name === 'Milk' && i.listId === party!.id)).toBe(true);

  // Sort cycle: category → A–Z.
  const sort = page.getByRole('button', { name: /Sort by category/ });
  await expect(sort).toBeVisible();
  await sort.click();
  await expect(page.getByRole('button', { name: /Sort alphabetically/ })).toBeVisible();

  // Group toggle: off → flat list (no category group heads).
  const group = page.getByRole('button', { name: 'Group by category' });
  await expect(group).toHaveAttribute('aria-pressed', 'true');
  await group.click();
  await expect(group).toHaveAttribute('aria-pressed', 'false');
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

  await page.getByRole('tab', { name: 'Items' }).click();
  await page.getByPlaceholder(/Search or add/).fill('Milk');
  const milk = page.locator('.item-entry').filter({ has: page.getByRole('button', { name: /Milk is on/ }) }).first();

  // Qty stepper is on by default (same × toggle as Shop).
  await expect(page.getByRole('button', { name: 'Quantity stepper' })).toHaveAttribute('aria-pressed', 'true');
  await milk.getByRole('button', { name: 'One more Milk' }).click();
  await expect(milk.locator('.qty-stepper-value')).toHaveText('2');

  // Prices start off; turning $ on reveals an inline price control.
  const prices = page.getByRole('button', { name: 'Prices' });
  await expect(prices).toHaveAttribute('aria-pressed', 'false');
  await expect(milk.getByRole('button', { name: /Add unit price for Milk/ })).toHaveCount(0);
  await prices.click();
  await expect(prices).toHaveAttribute('aria-pressed', 'true');
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

test('Items tab: × and $ toggles work while browsing items not yet on the list', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page); // empty shopping list
  await page.getByRole('tab', { name: 'Items' }).click();
  await page.getByPlaceholder(/Search or add/).fill('Apples');

  const qtyToggle = page.getByRole('button', { name: 'Quantity stepper' });
  const priceToggle = page.getByRole('button', { name: 'Prices' });
  await expect(qtyToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(priceToggle).toHaveAttribute('aria-pressed', 'false');

  // × on: steppers show on catalog rows (not only on-list items).
  const apples = page.locator('.item-entry').filter({ has: page.locator('.product-row .name', { hasText: /^Apples$/ }) }).first();
  await expect(apples.getByRole('button', { name: 'One more Apples' })).toBeVisible();
  await qtyToggle.click();
  await expect(qtyToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(apples.getByRole('button', { name: 'One more Apples' })).toHaveCount(0);

  // $ on: price control appears; setting a price adds the item to the list.
  await priceToggle.click();
  await expect(priceToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(apples.getByRole('button', { name: /Add unit price for Apples/ })).toBeVisible();
  await apples.getByRole('button', { name: /Add unit price for Apples/ }).click();
  await apples.getByLabel('Unit price for Apples').fill('1.29');
  await apples.getByLabel('Unit price for Apples').press('Enter');
  await expect(apples.getByRole('button', { name: /Apples is on/ })).toBeVisible();
  const items = await saved<{ name: string; price?: number }[]>(page, 'items');
  expect(items.find((i) => i.name === 'Apples')).toMatchObject({ price: 1.29 });
  ok();
});
