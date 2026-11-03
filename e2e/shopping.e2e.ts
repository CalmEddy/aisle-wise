import { expect, test } from '@playwright/test';
import { addItems, fresh, noPageErrors, row, saved, tick, toastText } from './helpers';

// Shopping the demo store: adding, the route, checking off, trip done. "Where was it?" is off here.
test.beforeEach(async ({ page }) => {
  await fresh(page, { display: { noAskStores: ['demo'] } });
});

test('adds items with amounts and notes, sorted into a walk through the store', async ({ page }) => {
  const ok = noPageErrors(page);
  await addItems(page, '2 milk, bread, flour (big bag), 2 lb ground beef, eggs x12, toothpaste');
  const items = await saved<{ name: string; qty?: number; note?: string }[]>(page, 'items');
  expect(items.map((i) => [i.name, i.qty ?? null, i.note ?? null])).toEqual([
    ['Milk', 2, null], ['Bread', null, null], ['Flour', null, 'big bag'], ['Ground beef', null, '2 lb'], ['Eggs', 12, null], ['Toothpaste', null, null],
  ]);
  // Qty stepper is on by default (shows the count; no separate ×N).
  await expect(row(page, 'Milk').locator('.qty-stepper-value')).toHaveText('2');
  await expect(row(page, 'Flour')).toContainText('big bag');
  // Default sort is nearest-first; the closest stop is marked.
  await expect(page.locator('main .flat-list')).toContainText(/Nearest first/i);
  await expect(page.locator('main .flat-list .row.nearest')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  ok();
});

test('checks off by the checkbox, with progress and undoable removal', async ({ page }) => {
  await addItems(page, 'apples, pasta, milk');
  await tick(page, 'Pasta');
  await expect(page.locator('.progress')).toHaveText(/1\s*\/\s*3/);
  await row(page, 'Milk').getByRole('button', { name: /More options/ }).click();
  await page.getByRole('button', { name: 'Remove from list' }).click();
  await expect(page.locator('.toast')).toContainText('Removed Milk');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Milk')).toBeVisible();
});

test('inline qty and rename work without opening the menu', async ({ page }) => {
  await addItems(page, 'milk');
  await row(page, 'Milk').getByRole('button', { name: 'One more Milk' }).click();
  await expect(row(page, 'Milk').locator('.qty-stepper-value')).toHaveText('2');
  await row(page, 'Milk').getByRole('button', { name: 'Rename Milk' }).click();
  await row(page, 'Milk').getByLabel('Rename Milk').fill('Oat milk');
  await row(page, 'Milk').getByLabel('Rename Milk').press('Enter');
  await expect(row(page, 'Oat milk')).toBeVisible();
  const items = await saved<{ name: string; qty?: number }[]>(page, 'items');
  expect(items.find((i) => i.name === 'Oat milk')?.qty).toBe(2);
});

test('the item menu sets unit, price and note, and pins it on the map', async ({ page }) => {
  await addItems(page, 'milk');
  await row(page, 'Milk').getByRole('button', { name: /More options/ }).click();
  await page.getByLabel('Unit for Milk').selectOption('box');
  await page.getByLabel('Price for Milk').fill('3.49');
  await page.getByLabel('Note for Milk').fill('skim');
  await page.getByRole('button', { name: '◎ Show on the map' }).click();
  await expect(row(page, 'Milk')).toContainText(/box/i);
  await expect(row(page, 'Milk')).toContainText(/\$3\.49/);
  await expect(row(page, 'Milk')).toContainText('skim');
  await expect(page.locator('.map-pin')).toHaveCount(1);
  const items = await saved<{ unit?: string; price?: number; note?: string }[]>(page, 'items');
  expect(items[0]).toMatchObject({ unit: 'box', price: 3.49, note: 'skim' });
});

test('list sort cycles through nearest, category and A–Z', async ({ page }) => {
  await addItems(page, 'zucchini, apples, milk');
  const sort = page.getByRole('button', { name: /Sort / });
  await expect(page.locator('main .flat-list')).toContainText(/Nearest first/i);
  await sort.click(); // category
  await expect(page.locator('main .flat-list')).toContainText(/By category/i);
  await sort.click(); // alpha
  await expect(page.locator('main .flat-list')).toContainText(/A–Z/);
  const names = await page.locator('main .flat-list .row .name-edit').allTextContents();
  expect(names.map((n) => n.trim())).toEqual([...names].map((n) => n.trim()).sort((a, b) => a.localeCompare(b)));
});

test('trip done: summary, things to get elsewhere, clear the cart with undo', async ({ page }) => {
  await addItems(page, 'Milk, Bread, Saffron threads');
  await tick(page, 'Milk');
  await tick(page, 'Bread');
  await row(page, 'Saffron').getByRole('button', { name: /More options/ }).click();
  await page.getByRole('button', { name: /Not available at/ }).click();
  const card = page.locator('.trip-done-card');
  await expect(card).toContainText('All done');
  await expect(card).toContainText('2 items in your cart');
  await expect(card).toContainText('Get elsewhere: Saffron threads');
  await card.getByRole('button', { name: 'Clear cart · start next trip' }).click();
  expect((await saved<{ name: string }[]>(page, 'items')).map((i) => i.name)).toEqual(['Saffron threads']);
  await expect(page.locator('.toast')).toContainText('Cart cleared (2 items)');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  expect((await saved<{ name: string }[]>(page, 'items')).length).toBe(3);
});

test('buy again: past trips at the top of the add window, one tap adds', async ({ page }) => {
  const t = (start: number, names: string[]) => ({ layoutId: 'demo', start, picks: names.map((name, i) => ({ name, at: start + i })) });
  await fresh(page, { trips: [t(1, ['Milk', 'Bread', 'Eggs']), t(2, ['Milk', 'Bread']), t(3, ['Milk', 'Apples'])], display: { noAskStores: ['demo'] } });
  await page.getByRole('button', { name: 'Add items' }).first().click();
  const chips = page.locator('.buy-again .chip');
  await expect(chips.first()).toContainText('Milk');
  await chips.filter({ hasText: 'Milk' }).click();
  await expect(chips.filter({ hasText: 'Milk' })).toHaveCount(0);
  await expect(page.locator('.added-strip')).toContainText('Milk');
  expect(await toastText(page)).not.toContain('Error');
});

test('the toggle strip is usable, and the map can be shown whole', async ({ page }) => {
  await addItems(page, 'apples, bread, milk');
  await expect(page.locator('.toggles')).toBeVisible();
  // Horizontal scroll is OK on a phone; the strip itself must stay one row tall.
  expect(await page.locator('.toggles').evaluate((e) => e.clientHeight < 64)).toBe(true);
  const strip = await page.locator('svg.map').evaluate((e) => e.getBoundingClientRect().height);
  await page.getByRole('button', { name: 'Show the whole map' }).click();
  const whole = await page.locator('svg.map').evaluate((e) => e.getBoundingClientRect().height);
  expect(whole).toBeGreaterThan(strip);
});
