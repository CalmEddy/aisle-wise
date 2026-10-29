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
  await expect(row(page, 'Milk')).toContainText('×2');
  await expect(row(page, 'Flour')).toContainText('big bag');
  // The first stop is marked NEXT, and the page doesn't scroll sideways.
  await expect(page.locator('main .route-list')).toContainText(/next/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  ok();
});

test('checks off by tapping the name, with progress and undoable removal', async ({ page }) => {
  await addItems(page, 'apples, pasta, milk');
  await tick(page, 'Pasta');
  await expect(page.locator('.progress')).toHaveText(/1\s*\/\s*3/);
  await row(page, 'Milk').getByRole('button', { name: /More options/ }).click();
  await page.getByRole('button', { name: 'Remove from list' }).click();
  await expect(page.locator('.toast')).toContainText('Removed Milk');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Milk')).toBeVisible();
});

test('the item menu changes the amount and note, and pins it on the map', async ({ page }) => {
  await addItems(page, 'milk');
  await row(page, 'Milk').getByRole('button', { name: /More options/ }).click();
  await page.getByRole('button', { name: 'One more' }).click();
  await page.getByLabel('Note for Milk').fill('skim');
  await page.getByRole('button', { name: '◎ Show on the map' }).click();
  await expect(row(page, 'Milk')).toContainText('×2');
  await expect(row(page, 'Milk')).toContainText('skim');
  await expect(page.locator('.map-pin')).toHaveCount(1);
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

test('the toggle strip fits on one line, and the map can be shown whole', async ({ page }) => {
  await addItems(page, 'apples, bread, milk');
  expect(await page.locator('.toggles').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  const strip = await page.locator('svg.map').evaluate((e) => e.getBoundingClientRect().height);
  await page.getByRole('button', { name: 'Show the whole map' }).click();
  const whole = await page.locator('svg.map').evaluate((e) => e.getBoundingClientRect().height);
  expect(whole).toBeGreaterThan(strip);
});
