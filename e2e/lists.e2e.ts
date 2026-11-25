import { expect, test } from '@playwright/test';
import { fresh, saved } from './helpers';

async function goSetupLists(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  await page.getByRole('tab', { name: 'Lists', exact: true }).click();
}

async function goShop(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Shop', exact: true }).click();
}

test('several lists: make, switch, combine into one (with undo), rename, delete', async ({ page }) => {
  await fresh(page, { items: [{ id: 'a', name: 'Apples', done: false }] });
  const names = async () => (await page.locator('main .name').allInnerTexts()).map((t) => t.split('\n')[0].trim()).sort();
  const addOnShop = async (...ns: string[]) => {
    await goShop(page);
    for (const n of ns) {
      await page.getByRole('button', { name: 'Add items' }).first().click();
      await page.getByLabel('Item to add').fill(n);
      await page.getByLabel('Item to add').press('Enter');
      await page.locator('.add-sheet').getByRole('button', { name: 'Done' }).click();
    }
  };
  const openTripLists = async () => { await page.locator('.list-bar').click(); };
  const newListAndShop = async (n: string) => {
    await goSetupLists(page);
    await page.getByLabel('New list name').fill(n);
    await page.getByRole('button', { name: '+ New' }).click();
    // Add sheet opens for the new list; close it and select on Shop.
    await page.locator('.add-sheet').getByRole('button', { name: 'Done' }).click();
    await goShop(page);
    await openTripLists();
    await page.locator('.list-pick', { hasText: n }).click();
  };
  await expect(page.locator('.list-bar-name')).toHaveText('Shopping list');
  await newListAndShop('Weekly staples');
  await addOnShop('Milk', 'Eggs');
  await newListAndShop('Taco night');
  await addOnShop('Tortillas', 'Eggs');
  expect(await names()).toEqual(['Eggs', 'Tortillas']);

  await openTripLists();
  await page.locator('.list-pick', { hasText: 'Shopping list' }).click();
  expect(await names()).toEqual(['Apples']);
  await openTripLists();
  await page.locator('.lists-sheet .check', { hasText: 'Weekly staples' }).locator('input').check();
  await page.locator('.lists-sheet .check', { hasText: 'Taco night' }).locator('input').check();
  await page.locator('.combine .btn.primary').click();
  expect(await names()).toEqual(['Apples', 'Eggs', 'Milk', 'Tortillas']);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  expect(await names()).toEqual(['Apples']);

  await goSetupLists(page);
  await page.getByRole('button', { name: 'More for Taco night' }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('List name', { exact: true }).fill('Taco Tuesday');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'More for Weekly staples' }).click();
  await page.getByRole('button', { name: 'Delete list' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Deleted');
  await expect(page.locator('.lists-manage .list-pick .name')).toHaveText(['Shopping list', 'Taco Tuesday']);
  await expect(page.getByRole('button', { name: 'More for Shopping list' })).toHaveCount(1);
  const lists = await saved<{ name: string }[]>(page, 'lists');
  expect(lists.map((l) => l.name)).toContain('Taco Tuesday');
  expect(lists.map((l) => l.name)).not.toContain('Weekly staples');
});

test('create in Setup does not change Shop trip; duplicate and add onto another list', async ({ page }) => {
  await fresh(page, { items: [{ id: 'a', name: 'Apples', done: false }] });
  const names = async () => (await page.locator('main .name').allInnerTexts()).map((t) => t.split('\n')[0].trim()).sort();
  await goSetupLists(page);
  await page.getByLabel('New list name').fill('Party');
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByLabel('Item to add').fill('Chips');
  await page.getByLabel('Item to add').press('Enter');
  await page.locator('.add-sheet').getByRole('button', { name: 'Done' }).click();
  await goShop(page);
  await expect(page.locator('.list-bar-name')).toHaveText('Shopping list');
  expect(await names()).toEqual(['Apples']);

  await goSetupLists(page);
  await page.getByRole('button', { name: 'More for Party' }).click();
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.locator('.toast')).toContainText('Duplicated');
  await expect(page.locator('.lists-manage .list-pick .name')).toHaveText(['Shopping list', 'Party', 'Party (again)']);
  await goShop(page);
  await page.locator('.list-bar').click();
  await page.locator('.list-pick', { has: page.locator('.name', { hasText: /^Party$/ }) }).click();
  expect(await names()).toEqual(['Chips']);
});

test('move an item to another list from the item menu', async ({ page }) => {
  await fresh(page, {
    items: [{ id: 'a', name: 'Apples', done: false }],
    lists: [{ id: 'main', name: 'Shopping list' }, { id: 'l-party', name: 'Party' }],
  });
  const names = async () => (await page.locator('main .name').allInnerTexts()).map((t) => t.split('\n')[0].trim()).sort();
  await page.getByRole('button', { name: 'More options for Apples' }).click();
  await page.getByRole('button', { name: 'Move to another list…' }).click();
  await page.getByRole('button', { name: 'Party', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Moved Apples to “Party”');
  expect(await names()).toEqual([]);
  await page.locator('.list-bar').click();
  await page.locator('.list-pick', { hasText: 'Party' }).click();
  expect(await names()).toEqual(['Apples']);
});

test('things with no place and things not sold here can be removed from the list', async ({ page }) => {
  await fresh(page, { display: { noAskStores: ['demo'] } });
  await page.getByRole('button', { name: 'Add items' }).first().click();
  await page.getByLabel('Item to add').fill('Zorblax, Quuxberries, Apples');
  await page.getByLabel('Item to add').press('Enter');
  await page.locator('.add-sheet').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.off-route .name')).toHaveText(['Zorblax', 'Quuxberries']);
  await page.getByRole('button', { name: 'Remove Zorblax' }).click();
  await expect(page.locator('.off-route .name')).toHaveText(['Quuxberries']);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.locator('.off-route .off-head', { hasText: 'No location yet' }).getByRole('button', { name: 'Remove all' }).click();
  await expect(page.locator('.off-route')).toHaveCount(0);
});

test('Include other lists on this trip without copying onto the active list', async ({ page }) => {
  await fresh(page, {
    items: [
      { id: 'a', name: 'Apples', done: false },
      { id: 'd', name: 'Bread', done: false },
      { id: 'b', name: 'Milk', done: false, listId: 'staples', productId: 'milk' },
      { id: 'c', name: 'Bread', done: false, listId: 'staples' },
    ],
    lists: [
      { id: 'main', name: 'Shopping list' },
      { id: 'staples', name: 'Weekly staples' },
    ],
    display: { noAskStores: ['demo'] },
  });
  const toBuyNames = async () => (await page.locator('main .row:not(.checked) .name').allInnerTexts())
    .map((t) => t.split('\n')[0].trim()).filter(Boolean).sort();
  const mainItems = async () => (await saved<any[]>(page, 'items')).filter((i) => !i.listId || i.listId === 'main');

  expect(await toBuyNames()).toEqual(['Apples', 'Bread']);
  expect((await mainItems()).length).toBe(2);

  await page.locator('.trip-include summary').click();
  await page.getByLabel('Include Weekly staples on this trip').check();

  await expect(page.locator('.list-bar-name')).toHaveText('Shopping list');
  // Union + dedupe: Bread once (on both lists), plus Milk from staples.
  expect(await toBuyNames()).toEqual(['Apples', 'Bread', 'Milk']);
  await expect(page.locator('main .row', { hasText: 'Bread' }).locator('.source-badge')).toHaveText(['Shopping list', 'Weekly staples']);
  // Active list was not grown — staples items stay on staples.
  expect((await mainItems()).length).toBe(2);
  expect(await saved<string[]>(page, 'shopWith')).toEqual(['staples']);

  // Milk is only on staples; checking it off marks that source done.
  await page.locator('main .row', { hasText: 'Milk' }).getByRole('checkbox').click();
  const afterMilk = await saved<any[]>(page, 'items');
  expect(afterMilk.find((i) => i.id === 'b')?.done).toBe(true);
  expect(afterMilk.find((i) => i.id === 'a')?.done).toBe(false);
  expect((await mainItems()).length).toBe(2);

  // Same product on both lists: one check-off marks every trip source.
  await page.locator('main .row', { hasText: 'Bread' }).getByRole('checkbox').click();
  const afterBread = await saved<any[]>(page, 'items');
  expect(afterBread.find((i) => i.id === 'c')?.done).toBe(true);
  expect(afterBread.find((i) => i.id === 'd')?.done).toBe(true);
});
