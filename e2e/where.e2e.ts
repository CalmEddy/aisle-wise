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
  // The store's first map: everything's new, so nothing is outlined.
  await expect(page.locator('.map-wrap svg.map .place')).not.toHaveCount(0);
  await expect(page.locator('svg.map .change-frame')).toHaveCount(0);
  const before = 0;
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

test('where’s the Bakery? tap a spot on the mini-map, see the preview, place it', async ({ page }) => {
  await addItems(page, 'Apples, Bread');
  await tick(page, 'Apples');
  await page.locator('.where-bar').getByRole('button', { name: 'Right wall →' }).click();
  await tick(page, 'Bread');
  await page.locator('.where-bar .btn.primary').click(); // Bakery: a department, but where?
  const card = page.getByRole('group', { name: 'Where’s Bakery?' });
  await expect(card).toBeVisible();
  // Tap the numbered spot on the mini-map for "behind Produce".
  const labels = await card.locator('.placement-options .chip').allInnerTexts();
  const n = labels.findIndex((t) => t.includes('behind Produce')) + 1;
  await card.locator('.map-ghost.next', { hasText: String(n) }).click();
  await expect(card).toContainText('Like this?');
  await expect(card.locator('svg.map .place.changed')).toHaveCount(1); // Bakery outlined in the preview
  await card.getByRole('button', { name: 'Place here' }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => {
    const c = (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
    const f = (id: string) => c.places.find((x: any) => x.id === id);
    return f('g-dept-bakery') && f('g-dept-produce') ? f('g-dept-produce').y - f('g-dept-bakery').y : -1;
  }).toBeGreaterThan(0);
  const l = (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
  expect(l.gen.placements).toEqual({ 'sec:bakery': { of: 'sec:produce', side: 'after' } });
  const p = (id: string) => l.places.find((x: any) => x.id === id);
  expect(p('g-dept-bakery').x).toBe(p('g-dept-produce').x);
  expect(p('g-dept-bakery').y).toBeLessThan(p('g-dept-produce').y);
  // Undo puts it back to the guess, and asks again.
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('group', { name: 'Where’s Bakery?' })).toBeVisible();
  await page.getByRole('button', { name: /Not sure/ }).click();
  await expect(page.getByRole('group', { name: 'Where’s Bakery?' })).toHaveCount(0);
});

test('a store that labels shelves like B12: set up by example, one-tap next shelves, place a new section', async ({ page }) => {
  await addItems(page, 'Cereal, Oats, Chips');
  const bar = page.locator('.where-bar');
  // Type "B12" on the bar's buttons.
  await tick(page, 'Cereal');
  await bar.getByRole('button', { name: '# Aisle…' }).click();
  await bar.getByRole('button', { name: 'ABC' }).click();
  await bar.getByRole('button', { name: 'B', exact: true }).click();
  await bar.getByRole('button', { name: '123' }).click();
  await bar.getByRole('button', { name: '1', exact: true }).click();
  await bar.getByRole('button', { name: '2', exact: true }).click();
  await bar.getByRole('button', { name: 'Save' }).click();
  // Not set up yet: teach it with this label.
  const sheet = page.getByRole('dialog', { name: 'Shelf labels' });
  await expect(sheet.getByLabel('Example label')).toHaveValue('B12');
  await expect(sheet).toContainText('Read as section B, shelf 12');
  await sheet.getByRole('radio', { name: /Facing pairs/ }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  // The next shelves are one tap.
  await tick(page, 'Oats');
  await bar.getByRole('button', { name: 'B13', exact: true }).click();
  // A new section: C.
  await tick(page, 'Chips');
  await bar.getByRole('button', { name: '# Shelf…' }).click();
  await bar.getByRole('button', { name: 'ABC' }).click();
  await bar.getByRole('button', { name: 'C', exact: true }).click();
  await bar.getByRole('button', { name: '123' }).click();
  await bar.getByRole('button', { name: '4', exact: true }).click();
  await bar.getByRole('button', { name: 'Save' }).click();
  const card = page.getByRole('group', { name: 'Where’s Section C?' });
  await card.locator('.placement-options .chip', { hasText: 'In front of section B' }).click();
  await card.getByRole('button', { name: 'Place here' }).click();
  // The map is rebuilt just after Place here: wait for it.
  const corner = async () => (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
  const below = async () => { const c = await corner(); const f = (lb: string) => c.places.find((x: any) => x.label === lb); return f('C1') && f('B1') ? f('C1').y - f('B1').y : -1; };
  await expect.poll(below).toBeGreaterThan(9);
  const l = await corner();
  expect(l.labels).toMatchObject({ example: 'B12', roles: ['section', 'shelf'], pairing: 'facing' });
  const labels = l.places.filter((p: any) => p.id.startsWith('g-sec-')).map((p: any) => p.label);
  expect(labels).toEqual(expect.arrayContaining(['B1', 'B12', 'B13', 'C1', 'C4']));
  const p = (label: string) => l.places.find((x: any) => x.label === label);
  expect(p('C1').y).toBeGreaterThan(p('B1').y + 9); // in front of B
  const products = await saved<any[]>(page, 'products');
  expect(Object.values(products.find((x) => x.name === 'Oats').clues)[0]).toEqual({ kind: 'shelf', code: 'B13', section: 'B', shelf: 13 });
});

test('a stand across aisles 2–3 at the front: the map puts it there and the shelves make way', async ({ page }) => {
  await addItems(page, 'Cereal, Promo crisps');
  const bar = page.locator('.where-bar');
  await tick(page, 'Cereal');
  await bar.getByRole('button', { name: '# Aisle…' }).click();
  await bar.getByRole('button', { name: '4', exact: true }).click();
  await bar.getByRole('button', { name: 'Save' }).click();
  await tick(page, 'Promo crisps');
  await bar.getByRole('button', { name: 'Other…' }).click();
  await page.getByRole('tab', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Stand / display' }).click();
  await page.getByRole('button', { name: 'Across aisles…' }).click();
  await page.getByLabel('From aisle or section').fill('2');
  await page.getByLabel('To aisle or section').fill('3');
  await page.getByRole('button', { name: 'Front', exact: true }).click();
  await page.getByRole('button', { name: /^Save · Stand across aisles 2–3 \(front\)/ }).click();
  await expect.poll(async () => (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner').places.some((p: any) => p.id.startsWith('g-open-x2-3'))).toBe(true);
  const l = (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
  const len = (id: string) => l.places.find((p: any) => p.id === id).length;
  expect(len('g-shelf-2-L')).toBeLessThan(14);
  expect(len('g-shelf-4-L')).toBe(14);
  await expect(page.getByRole('group', { name: /Where’s/ })).toHaveCount(0); // nothing to place: it's where it was said
});
