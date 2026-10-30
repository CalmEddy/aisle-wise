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
  const list = page.getByRole('dialog', { name: 'Where were these?' });
  await expect(list.locator('.where-bar')).toHaveCount(2);
  await list.locator('.where-bar', { hasText: 'Bread' }).locator('.btn.primary').click(); // Bakery
  // Other… opens the full panel for that one, then comes back to the list.
  await list.locator('.where-bar', { hasText: 'Jam' }).getByRole('button', { name: 'Other…' }).click();
  await page.getByRole('tab', { name: 'End-cap' }).click();
  await page.getByLabel('Aisle number').fill('4');
  await page.getByRole('button', { name: 'Front end' }).click();
  await expect(list).toContainText('All placed');
});

test('learns which way round the store is from trips, and redraws the map', async ({ page }) => {
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
    // Produce is known to be on the right wall, so walking from it straight to aisle 6 says aisle 1 is on the left.
    layouts: [{ id: 's1', name: 'Test Mart', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 }, gen: { enabled: true, entrance: 'left', locked: [], sure: ['produce'] } }],
    activeLayout: 's1',
    trips: [trip(t0), trip(t0 + 864e5)],
    items: [{ id: 'i1', name: 'Cereal', productId: 'Cereal', done: false }],
  });
  await expect(page.locator('.toast')).toContainText('aisle 1 is on the left');
  const l = (await saved<any[]>(page, 'layouts'))[0];
  expect(l.gen.aisleOne).toBe('far');
  const x = (id: string) => l.places.find((p: any) => p.id === id).x;
  expect(x('g-shelf-1-L')).toBeLessThan(x('g-shelf-6-L'));
  // The entrance is in the middle of the front; nothing asks about it.
  expect(l.entrance).toEqual({ x: Math.floor(l.width / 2), y: l.height - 1 });
  await tick(page, 'Cereal');
  await expect(page.locator('.trip-done-card .layout-question')).toHaveCount(0);
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

test('answers change the map straight away, outlined until the next trip', async ({ page }) => {
  await addItems(page, 'Apples, Cereal');
  await tick(page, 'Apples');
  await page.locator('.where-bar .btn.primary').click(); // Produce
  await expect(page.locator('svg.map .place.changed')).not.toHaveCount(0);
  const before = await page.locator('svg.map .change-frame').count();
  await tick(page, 'Cereal');
  await page.locator('.where-bar').getByRole('button', { name: /Other|Aisle \/ department/ }).click();
  await page.getByLabel('Aisle number').fill('4');
  await page.getByRole('button', { name: /^Save · Aisle 4/ }).click();
  // Aisle 4 and its shelves are new: more outlined.
  await expect.poll(() => page.locator('svg.map .change-frame').count()).toBeGreaterThan(before);
  await expect(page.locator('svg.map .aisle-label.changed')).not.toHaveCount(0);
  await page.locator('.trip-done-card').getByRole('button', { name: 'Clear cart · start next trip' }).click();
  await expect(page.locator('svg.map .change-frame')).toHaveCount(0);
});

test('quick bar: next aisles in one tap, number buttons, walls, fridge/freezer', async ({ page }) => {
  await addItems(page, 'Cereal, Pasta, Chips, Bread, Ice cream, Hummus');
  const bar = page.locator('.where-bar');
  // A first aisle on the number buttons (no keyboard).
  await tick(page, 'Cereal');
  await bar.getByRole('button', { name: '# Aisle…' }).click();
  await bar.getByRole('button', { name: '1', exact: true }).click();
  await bar.getByRole('button', { name: 'Delete' }).click();
  await bar.getByRole('button', { name: '3', exact: true }).click();
  await bar.getByRole('button', { name: 'Save' }).click();
  // Then the next aisles are offered: one tap.
  await tick(page, 'Pasta');
  await expect(bar.locator('.btn').first()).toHaveText('Aisle 3');
  await bar.getByRole('button', { name: 'Aisle 5', exact: true }).click();
  await tick(page, 'Chips');
  await expect(bar.getByRole('button', { name: 'Aisle 7', exact: true })).toBeVisible(); // going up by 2
  await bar.getByRole('button', { name: 'Aisle 7', exact: true }).click();
  // A wall in one tap.
  await tick(page, 'Bread');
  await bar.getByRole('button', { name: 'Right wall →' }).click();
  // Freezer switched on by the category; the aisle chips carry it.
  await tick(page, 'Ice cream');
  await expect(bar.getByRole('button', { name: 'In a freezer' })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: '❄ Aisle 9', exact: true }).click();
  // Fridge chosen by hand, on a wall.
  await tick(page, 'Hummus');
  await bar.getByRole('button', { name: 'In a fridge' }).click();
  await bar.getByRole('button', { name: '🧊 ← Left wall' }).click();
  const products = await saved<any[]>(page, 'products');
  const clue = (n: string) => Object.values(products.find((p) => p.name === n).clues)[0];
  expect([clue('Cereal'), clue('Pasta'), clue('Chips'), clue('Bread'), clue('Ice cream'), clue('Hummus')]).toEqual([
    { kind: 'aisle', aisle: '3' }, { kind: 'aisle', aisle: '5' }, { kind: 'aisle', aisle: '7' },
    { kind: 'wall', wall: 'right' }, { kind: 'aisle', aisle: '9', temp: 'frozen' }, { kind: 'wall', wall: 'left', temp: 'chilled' },
  ]);
});

test('no question when the map already knows the category; or all at checkout in one list', async ({ page }) => {
  await addItems(page, 'Bananas, Lettuce, Jam, Tea, Soap');
  await tick(page, 'Bananas');
  await page.locator('.where-bar .btn.primary').click(); // Produce: the map now stocks fruit and veg there
  await tick(page, 'Lettuce');
  await expect(page.locator('.where-bar')).toHaveCount(0); // veg is only in Produce: not asked
  // Switch to asking at checkout.
  await tick(page, 'Jam');
  await page.locator('.where-bar').getByRole('button', { name: 'Ask me at checkout' }).click();
  await tick(page, 'Tea');
  await expect(page.locator('.where-bar')).toHaveCount(0);
  await tick(page, 'Soap');
  const list = page.getByRole('dialog', { name: 'Where were these?' });
  await page.locator('.trip-done-card').getByRole('button', { name: /Say where 3 things were/ }).click();
  await expect(list.locator('.where-bar')).toHaveCount(3);
  await list.locator('.where-bar', { hasText: 'Jam' }).getByRole('button', { name: '# Aisle…' }).click();
  await list.locator('.where-bar', { hasText: 'Jam' }).getByRole('button', { name: '6', exact: true }).click();
  await list.locator('.where-bar', { hasText: 'Jam' }).getByRole('button', { name: 'Save' }).click();
  await list.locator('.where-bar', { hasText: 'Tea' }).getByRole('button', { name: 'Aisle 7', exact: true }).click();
  await expect(list.locator('.where-bar')).toHaveCount(1);
  await expect(list.getByRole('checkbox')).toBeChecked();
});
