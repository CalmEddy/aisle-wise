import { expect, test } from '@playwright/test';
import { addItems, fresh, newStore, noPageErrors, row, saved, tick } from './helpers';

const clues = async (page: import('@playwright/test').Page) => {
  const products = await saved<{ name: string; clues?: Record<string, unknown> }[]>(page, 'products');
  return Object.fromEntries(products.filter((p) => p.clues).map((p) => [p.name, Object.values(p.clues!)[0]]));
};

test.beforeEach(async ({ page }) => {
  await fresh(page);
  await newStore(page, 'Corner');
});

test('the quick bar asks at check-off without blocking the list', async ({ page }) => {
  const ok = noPageErrors(page);
  await addItems(page, 'Apples, Bread, Milk, Pasta');
  await tick(page, 'Apples');
  const bar = page.locator('.where-bar');
  await expect(bar).toContainText('Where was Apples?');
  await expect(page.locator('.where-panel')).toHaveCount(0);
  await bar.locator('.btn.primary').click(); // Produce, guessed from the category
  // Ignoring the bar (checking the next thing off) moves it to "ask later".
  await tick(page, 'Bread');
  await tick(page, 'Pasta');
  await expect(bar).toContainText('Where was Pasta?');
  await expect(page.locator('.later-chip')).toContainText('1 to place');
  expect((await clues(page)).Apples).toEqual({ kind: 'dept', dept: 'produce' });
  ok();
});

test('Aisle, Wall and Open answers, with the fridge/freezer switch', async ({ page }) => {
  await addItems(page, 'Milk, Bread, Peas');
  const other = async (name: string) => {
    await tick(page, name);
    await page.locator('.where-bar').getByRole('button', { name: /Other|Aisle \/ department/ }).click();
  };
  await other('Milk');
  // Milk starts as Fridge (from its category).
  await page.getByRole('tab', { name: 'Aisle' }).click();
  await page.getByLabel('Aisle number').fill('12');
  await page.getByRole('button', { name: 'Right →' }).click();
  await page.getByRole('button', { name: /^Save · Fridge, aisle 12/ }).click();
  await other('Bread');
  await page.getByRole('tab', { name: 'Wall' }).click();
  await page.getByRole('button', { name: 'Right →' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /^Save · Right wall · back/ }).click();
  await other('Peas');
  await page.getByRole('tab', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Case' }).click();
  await page.getByRole('button', { name: 'Near the door' }).click();
  await page.getByRole('button', { name: '❄ Freezer' }).click();
  await page.getByRole('button', { name: /^Save · Freezer, case near the door/ }).click();
  expect(await clues(page)).toMatchObject({
    Milk: { kind: 'aisle', aisle: '12', side: 'R', temp: 'chilled' },
    Bread: { kind: 'wall', wall: 'right', part: 'back' },
    Peas: { kind: 'open', near: 'entrance', fixture: 'case', temp: 'frozen' },
  });
  // The answers build the map: a freezer case out in the open, Bakery on the right wall.
  const layout = (await saved<any[]>(page, 'layouts')).find((l) => l.name === 'Corner');
  expect(layout.places.map((p: any) => p.label)).toEqual(expect.arrayContaining(['Bakery', 'Freezer case']));
});

test('ask later, then review before you go', async ({ page }) => {
  await addItems(page, 'Bread, Jam');
  await tick(page, 'Bread');
  await page.locator('.where-bar').getByRole('button', { name: 'Later' }).click();
  await tick(page, 'Jam');
  await page.locator('.where-bar').getByRole('button', { name: 'Later' }).click();
  const review = page.locator('.trip-done-card').getByRole('button', { name: /Say where 2 things were/ });
  await review.click();
  await expect(page.locator('.where-panel')).toContainText('Where was Bread?');
  await page.getByRole('tab', { name: 'Department' }).click();
  await page.getByRole('button', { name: /Bakery/ }).click();
  await expect(page.locator('.where-panel')).toContainText('Where was Jam?');
});

test('learns which way round the store is from trips, then asks one question', async ({ page }) => {
  const aisle = (name: string, n: string, c: string) => ({ id: name, name, categoryId: c, clues: { s1: { kind: 'aisle', aisle: n, pos: 'middle' } } });
  const products = [
    { id: 'Apples', name: 'Apples', categoryId: 'fruit', clues: { s1: { kind: 'dept', dept: 'produce' } } },
    aisle('Cereal', '1', 'breakfast'), aisle('Coffee', '2', 'coffee'), aisle('Flour', '3', 'baking'),
    aisle('Pasta', '4', 'pasta'), aisle('Soup', '5', 'canned'), aisle('Ketchup', '6', 'condiments'),
  ];
  const walk = ['Apples', 'Ketchup', 'Soup', 'Pasta', 'Flour', 'Coffee', 'Cereal'];
  const t0 = Date.now() - 3 * 864e5;
  const trip = (start: number) => ({ layoutId: 's1', start, picks: walk.map((n, i) => ({ productId: n, name: n, at: start + i * 60000 })) });
  await fresh(page, {
    products,
    layouts: [{ id: 's1', name: 'Test Mart', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 }, gen: { enabled: true, entrance: 'left', locked: [] } }],
    activeLayout: 's1',
    trips: [trip(t0), trip(t0 + 864e5)],
    items: [{ id: 'i1', name: 'Cereal', productId: 'Cereal', done: false }],
  });
  await expect(page.locator('.toast')).toContainText('aisle 1 is the farthest from the door');
  const gen = (await saved<any[]>(page, 'layouts'))[0];
  expect(gen.gen.aisleOne).toBe('far');
  await tick(page, 'Cereal');
  const q = page.locator('.trip-done-card .layout-question');
  await expect(q).toContainText('are the aisles to your left or your right?');
  await q.getByRole('button', { name: 'To my right' }).click();
  expect((await saved<any[]>(page, 'layouts'))[0].gen).toMatchObject({ entrance: 'left', sure: ['entrance'] });
});

test('the row shows where an answered item is', async ({ page }) => {
  await addItems(page, 'Jam');
  await tick(page, 'Jam');
  await page.locator('.where-bar').getByRole('button', { name: /Other|Aisle \/ department/ }).click();
  await page.getByLabel('Aisle number').fill('7');
  await page.getByRole('button', { name: /^Save · Aisle 7/ }).click();
  await page.locator('details.done summary').click();
  await tick(page, 'Jam'); // back on the list
  await expect(row(page, 'Jam')).toContainText('7');
});
