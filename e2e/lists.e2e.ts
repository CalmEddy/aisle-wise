import { expect, test } from '@playwright/test';
import { fresh, saved, toggleListOptions, goTab } from './helpers';

async function goTabLists(page: import('@playwright/test').Page) {
  await goTab(page, 'Lists');
}

async function goShop(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Shop', exact: true }).click();
}

/** Select a list in the Setup → Lists pulldown by display name prefix. */
async function selectSetupList(page: import('@playwright/test').Page, name: string) {
  const sel = page.getByLabel('Which list');
  const value = await sel.locator('option').evaluateAll((opts, n) => {
    const hit = opts.find((o) => (o.textContent ?? '').startsWith(n));
    return hit ? (hit as HTMLOptionElement).value : null;
  }, name);
  expect(value).toBeTruthy();
  await sel.selectOption(value!);
}

/** Create a list from the Setup → Lists pulldown (does not change the Shop trip). */
async function createListInSetup(page: import('@playwright/test').Page, name: string) {
  await goTabLists(page);
  await page.getByLabel('Which list').selectOption({ value: '__new__' });
  await page.getByLabel('New list name').fill(name);
  await page.getByRole('button', { name: '+ Create' }).click();
  await expect(page.locator('.lists-select option:checked')).toContainText(name);
}

async function addInlineOnSetup(page: import('@playwright/test').Page, ...ns: string[]) {
  for (const n of ns) {
    await page.getByLabel('Item to add').fill(n);
    await page.getByLabel('Item to add').press('Enter');
  }
}

/** Add items via the always-visible Shop search box. */
async function addOnShop(page: import('@playwright/test').Page, ...ns: string[]) {
  await goShop(page);
  for (const n of ns) {
    await page.getByLabel('Item to add').fill(n);
    await page.getByLabel('Item to add').press('Enter');
  }
}

/** Open the Shop list picker sheet. */
async function openTripLists(page: import('@playwright/test').Page) {
  await page.locator('.list-pick-hero').click();
}

test('several lists: make, switch, combine into one (with undo), rename, delete', async ({ page }) => {
  await fresh(page, { items: [{ id: 'a', name: 'Apples', done: false }] });
  const names = async () => (await page.locator('main .name').allInnerTexts()).map((t) => t.split('\n')[0].trim()).sort();
  const newListAndShop = async (n: string) => {
    await createListInSetup(page, n);
    await goShop(page);
    await openTripLists(page);
    await page.locator('.list-pick', { hasText: n }).click();
  };
  await expect(page.locator('.list-pick-hero-name')).toHaveText('Shopping list');
  await newListAndShop('Weekly staples');
  await addOnShop(page, 'Milk', 'Eggs');
  await newListAndShop('Taco night');
  await addOnShop(page, 'Tortillas', 'Eggs');
  expect(await names()).toEqual(['Eggs', 'Tortillas']);

  await openTripLists(page);
  await page.locator('.list-pick', { hasText: 'Shopping list' }).click();
  expect(await names()).toEqual(['Apples']);
  await openTripLists(page);
  await page.locator('.lists-sheet .check', { hasText: 'Weekly staples' }).locator('input').check();
  await page.locator('.lists-sheet .check', { hasText: 'Taco night' }).locator('input').check();
  await page.locator('.combine .btn.primary').click();
  expect(await names()).toEqual(['Apples', 'Eggs', 'Milk', 'Tortillas']);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  expect(await names()).toEqual(['Apples']);

  await goTabLists(page);
  await selectSetupList(page, 'Taco night');
  await page.getByRole('button', { name: 'More for Taco night' }).click();
  await page.getByLabel('List name', { exact: true }).fill('Taco Tuesday');
  await page.getByRole('button', { name: 'Save' }).click();
  await selectSetupList(page, 'Weekly staples');
  await page.getByRole('group', { name: 'Actions for Weekly staples' }).getByRole('button', { name: 'Delete' }).click();
  await page.locator('.list-confirm').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.toast')).toContainText('Deleted');
  await expect(page.locator('.lists-select option').filter({ hasNotText: 'New list' })).toHaveText([
    /Shopping list/,
    /Taco Tuesday/,
  ]);
  await selectSetupList(page, 'Taco Tuesday');
  await expect(page.getByRole('button', { name: 'More for Taco Tuesday' })).toHaveCount(1);
  const lists = await saved<{ name: string }[]>(page, 'lists');
  expect(lists.map((l) => l.name)).toContain('Taco Tuesday');
  expect(lists.map((l) => l.name)).not.toContain('Weekly staples');
});

test('create in Lists does not change the Shop trip; add onto another list', async ({ page }) => {
  await fresh(page, { items: [{ id: 'a', name: 'Apples', done: false }] });
  const names = async () => (await page.locator('main .name').allInnerTexts()).map((t) => t.split('\n')[0].trim()).sort();
  await createListInSetup(page, 'Party');
  await addInlineOnSetup(page, 'Chips');
  await expect(page.locator('.lists-manage-items .name')).toContainText(['Chips']);
  // No cart control while editing lists.
  await expect(page.locator('.add-inline .s-btn.cart')).toHaveCount(0);
  await goShop(page);
  await expect(page.locator('.list-pick-hero-name')).toHaveText('Shopping list');
  expect(await names()).toEqual(['Apples']);

  await goShop(page);
  await openTripLists(page);
  await page.locator('.list-pick', { has: page.locator('.name', { hasText: /^Party$/ }) }).click();
  expect(await names()).toEqual(['Chips']);
});

test('Setup Lists: sort cycles and search badges show List / Cart', async ({ page }) => {
  await fresh(page, {
    items: [
      { id: 'a', name: 'Apples', done: false },
      { id: 'm', name: 'Milk', done: true, productId: 'p-milk' },
    ],
    display: { noAskStores: ['demo'] },
  });
  await goTabLists(page);
  await addInlineOnSetup(page, 'Eggs');
  await expect(page.locator('.lists-manage-items .name')).toContainText(['Apples', 'Eggs']);

  await expect(page.getByRole('radio', { name: /Sort by order of entry/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /Sort by category/ }).click();
  await expect(page.getByRole('radio', { name: /Sort by category/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: /Sort alphabetically/ }).click();
  await expect(page.getByRole('radio', { name: /Sort alphabetically/ })).toHaveAttribute('aria-checked', 'true');

  await page.getByLabel('Item to add').fill('Milk');
  const milkSug = page.locator('.add-inline .suggestion', { hasText: 'Milk' }).first();
  await expect(milkSug.locator('.status-pill.in-cart')).toHaveText('Cart');
  await page.getByLabel('Item to add').fill('Apples');
  const appleSug = page.locator('.add-inline .suggestion', { hasText: 'Apples' }).first();
  await expect(appleSug.locator('.status-pill.on-list')).toHaveText('List');
});

test('Lists: Buy again lives under the add box; no Duplicate / Clear buttons; each item has a Remove button', async ({ page }) => {
  const t = (start: number, names: string[]) => ({ layoutId: 'demo', start, picks: names.map((name, i) => ({ name, at: start + i })) });
  await fresh(page, {
    trips: [t(1, ['Milk', 'Bread', 'Eggs']), t(2, ['Milk', 'Bread']), t(3, ['Milk', 'Apples'])],
    items: [{ id: 'a', name: 'Apples', done: false }, { id: 'b', name: 'Bread', done: false }],
    display: { noAskStores: ['demo'] },
  });
  await goTab(page, 'Lists');
  await expect(page.locator('details.buy-again')).toHaveCount(1);
  for (const name of ['Duplicate', 'Clear checked', 'Clear to-buy']) {
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Remove Apples from list' }).click();
  await expect(page.locator('.lists-manage-items .name')).not.toContainText(['Apples']);
  await expect(page.locator('.lists-manage-items .name')).toContainText(['Bread']);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.lists-manage-items .name')).toContainText(['Apples']);
  // The Items tab has no Buy again.
  await goTab(page, 'Items');
  await expect(page.locator('.buy-again')).toHaveCount(0);
});

test('Grocery Items marks List and Cart badges', async ({ page }) => {
  await fresh(page, {
    items: [
      { id: 'a', name: 'Apples', done: false },
      { id: 'm', name: 'Milk', done: true, productId: 'p-milk' },
    ],
  });
  await goTab(page, 'Items');
  await page.getByLabel('Search or add grocery items').fill('Apples');
  const apples = page.locator('.item-entry').filter({ has: page.locator('.item-name', { hasText: /^Apples$/ }) }).first();
  await expect(apples.locator('.status-pill.on-list')).toHaveText('List');
  await page.getByLabel('Search or add grocery items').fill('Milk');
  const milk = page.locator('.item-entry').filter({ has: page.locator('.item-name', { hasText: /^Milk$/ }) }).first();
  await expect(milk.locator('.status-pill.in-cart')).toHaveText('Cart');
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
  await openTripLists(page);
  await page.locator('.list-pick', { hasText: 'Party' }).click();
  expect(await names()).toEqual(['Apples']);
});

test('things with no place and things not sold here can be removed from the list', async ({ page }) => {
  await fresh(page, { display: { noAskStores: ['demo'] } });
  await page.getByLabel('Item to add').fill('Zorblax, Quuxberries, Apples');
  await page.getByLabel('Item to add').press('Enter');
  await expect(page.locator('.unplaced-items .name')).toHaveText(['Zorblax', 'Quuxberries']);
  await page.getByRole('button', { name: 'Remove Zorblax' }).click();
  await expect(page.locator('.unplaced-items .name')).toHaveText(['Quuxberries']);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.locator('.unplaced-items .off-head').getByRole('button', { name: 'Remove all' }).click();
  await expect(page.locator('.unplaced-items')).toHaveCount(0);
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

  await toggleListOptions(page);
  await page.getByLabel('Include Weekly staples on this trip').check();

  await expect(page.locator('.list-pick-hero-name')).toHaveText('Shopping list');
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
