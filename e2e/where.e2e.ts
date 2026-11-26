import { expect, test } from '@playwright/test';
import { addItems, describeAisle, describeDept, describeWall, enterBuildMode, fresh, newStore, noPageErrors, openDescribe, placeSheet, row, saved, tapMap, tick, toggleListOptions, enableDebug } from './helpers';

const clues = async (page: import('@playwright/test').Page) => {
  const products = await saved<{ name: string; clues?: Record<string, unknown> }[]>(page, 'products');
  return Object.fromEntries(products.filter((p) => p.clues).map((p) => [p.name, Object.values(p.clues!)[0]]));
};

test.beforeEach(async ({ page }) => {
  await fresh(page);
  await newStore(page, 'Corner');
});

test('the map sheet asks at check-off without a chip bar', async ({ page }) => {
  const ok = noPageErrors(page);
  await addItems(page, 'Apples, Bread, Milk, Pasta');
  await tick(page, 'Apples');
  const sheet = placeSheet(page, 'Apples');
  await expect(sheet).toBeVisible();
  await expect(page.locator('.where-panel')).toHaveCount(0);
  await expect(page.locator('.where-bar')).toHaveCount(0);
  await describeDept(page, /Produce/);
  // Ignoring the sheet (checking the next thing off) moves it to "ask later".
  await tick(page, 'Bread');
  // The place dock (with its own map) covers the lower list — click the checkbox directly.
  await row(page, 'Pasta').getByRole('checkbox').evaluate((el) => (el as HTMLInputElement).click());
  await expect(placeSheet(page, 'Pasta')).toBeVisible();
  await expect(page.locator('.later-chip')).toContainText('1 to place');
  expect((await clues(page)).Apples).toEqual({ kind: 'dept', dept: 'produce' });
  ok();
});

test('Describe…: Aisle, Wall and Open answers, with fridge/freezer', async ({ page }) => {
  await addItems(page, 'Milk, Bread, Peas');
  await tick(page, 'Milk');
  await describeAisle(page, '12', { side: 'R' }); // Milk starts as Fridge from category
  await tick(page, 'Bread');
  await describeWall(page, 'Right', 'Back');
  await tick(page, 'Peas');
  await openDescribe(page);
  const panel = page.locator('.where-panel');
  await panel.getByRole('tab', { name: 'Open' }).click();
  await panel.getByRole('button', { name: 'Case' }).click();
  await panel.getByRole('button', { name: 'Near the door' }).click();
  await panel.getByRole('button', { name: 'Freezer', exact: true }).click();
  await panel.getByRole('button', { name: /^Save · Freezer, case near the door/ }).click();
  expect(await clues(page)).toMatchObject({
    Milk: { kind: 'aisle', aisle: '12', side: 'R', temp: 'chilled' },
    Bread: { kind: 'wall', wall: 'right', part: 'back' },
    'Frozen peas': { kind: 'open', near: 'entrance', fixture: 'case', temp: 'frozen' },
  });
  const layout = (await saved<any[]>(page, 'layouts')).find((l) => l.name === 'Corner');
  expect(layout.places.map((p: any) => p.label)).toEqual(expect.arrayContaining(['Bakery', 'Freezer case']));
});

test('ask later, then review before you go', async ({ page }) => {
  await addItems(page, 'Bread, Jam');
  await tick(page, 'Bread');
  await placeSheet(page, 'Bread').getByRole('button', { name: 'Later' }).click();
  await tick(page, 'Jam');
  await placeSheet(page, 'Jam').getByRole('button', { name: 'Later' }).click();
  await page.locator('.trip-done-card').getByRole('button', { name: /Say where 2 things were/ }).click();
  const list = page.getByRole('dialog', { name: 'Where were these?' });
  await expect(list.locator('.place-on-map')).toHaveCount(1);
  await expect(list).toContainText('Bread');
  await list.getByRole('button', { name: 'Aisle / department…' }).click();
  await page.locator('.where-panel').getByRole('tab', { name: 'Department' }).click();
  await page.locator('.where-panel').getByRole('button', { name: /Bakery/ }).click();
  await expect(list.locator('.place-on-map')).toContainText('Jam');
  await list.getByRole('button', { name: 'Aisle / department…' }).click();
  await page.getByRole('tab', { name: 'End-cap' }).click();
  await page.getByLabel('Aisle number').fill('4');
  await page.getByRole('button', { name: 'Front end' }).click();
  await expect(list).toContainText('All placed');
});

test('learns which way round the store is from trips, and redraws the map', async ({ page }) => {
  const aisle = (name: string, n: string, c: string) => ({ id: name, name, categoryId: c, clues: { s1: { kind: 'aisle', aisle: n, pos: 'middle' } } });
  const products = [
    { id: 'Apples', name: 'Apples', categoryId: 'produce_fruits', clues: { s1: { kind: 'dept', dept: 'produce' } } },
    aisle('Cereal', '1', 'breakfast_cereal_sub'), aisle('Coffee', '2', 'beverages_coffee'), aisle('Flour', '3', 'baking_flour_sugar'),
    aisle('Pasta', '4', 'pasta_dry'), aisle('Soup', '5', 'canned_soup_broth'), aisle('Ketchup', '6', 'condiments_table'),
  ];
  const walk = ['Apples', 'Ketchup', 'Soup', 'Pasta', 'Flour', 'Coffee', 'Cereal'];
  const t0 = Date.now() - 3 * 864e5;
  const trip = (start: number) => ({ layoutId: 's1', start, picks: walk.map((n, i) => ({ productId: n, name: n, at: start + i * 60000 })) });
  await fresh(page, {
    products,
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
  expect(l.entrance).toEqual({ x: Math.floor(l.width / 2), y: l.height - 1 });
  await tick(page, 'Cereal');
  await expect(page.locator('.trip-done-card .layout-question:not(.door-card)')).toHaveCount(0);
});

test('the row shows where an answered item is', async ({ page }) => {
  await addItems(page, 'Jam');
  await tick(page, 'Jam');
  await describeAisle(page, '7');
  await page.locator('details.done summary').click();
  await tick(page, 'Jam');
  await expect(row(page, 'Jam')).toContainText('7');
});

test('answers change the map straight away, with no outlines', async ({ page }) => {
  await addItems(page, 'Apples, Cereal');
  await tick(page, 'Apples');
  await describeDept(page, /Produce/);
  await expect(page.locator('.map-wrap svg.map .place')).not.toHaveCount(0);
  await tick(page, 'Cereal');
  await describeAisle(page, '4');
  await expect(page.locator('svg.map .aisle-label', { hasText: /AISLE 4/i })).toHaveCount(1);
  await expect(page.locator('svg.map .change-frame')).toHaveCount(0);
  await expect(page.locator('svg.map .changed')).toHaveCount(0);
});

test('Describe… aisle and wall answers with fridge/freezer', async ({ page }) => {
  await addItems(page, 'Cereal, Pasta, Chips, Bread, Ice cream, Hummus');
  await tick(page, 'Cereal');
  await describeAisle(page, '3');
  await tick(page, 'Pasta');
  await describeAisle(page, '5');
  await tick(page, 'Chips');
  await describeAisle(page, '7');
  await tick(page, 'Bread');
  await describeWall(page, 'Right');
  await tick(page, 'Ice cream');
  await describeAisle(page, '9', { temp: 'frozen' });
  await tick(page, 'Hummus');
  await describeWall(page, 'Left', undefined, 'chilled');
  const products = await saved<any[]>(page, 'products');
  const clue = (n: string) => Object.values(products.find((p) => p.name === n).clues)[0];
  expect([clue('Cereal'), clue('Pasta'), clue('Potato chips'), clue('Bread'), clue('Ice cream'), clue('Hummus')]).toEqual([
    { kind: 'aisle', aisle: '3' }, { kind: 'aisle', aisle: '5' }, { kind: 'aisle', aisle: '7' },
    { kind: 'wall', wall: 'right' }, { kind: 'aisle', aisle: '9', temp: 'frozen' }, { kind: 'wall', wall: 'left', temp: 'chilled' },
  ]);
});

test('the map already has its kind: quiet-saves the spot; or all at checkout in one list', async ({ page }) => {
  await addItems(page, 'Bananas, Lettuce, Jam, Tea, Soap');
  await tick(page, 'Bananas');
  await describeDept(page, /Produce/);
  await tick(page, 'Lettuce');
  await expect(page.locator('.toast')).toContainText(/Lettuce: saved at Produce/i);
  await expect(placeSheet(page)).toHaveCount(0);
  await tick(page, 'Jam');
  await placeSheet(page, 'Jam').getByRole('button', { name: 'Ask me at checkout' }).click();
  await tick(page, 'Tea');
  await expect(placeSheet(page)).toHaveCount(0);
  await tick(page, 'Soap');
  const list = page.getByRole('dialog', { name: 'Where were these?' });
  await page.locator('.trip-done-card').getByRole('button', { name: /Say where 3 things were/ }).click();
  await expect(list.locator('.place-on-map')).toHaveCount(1);
  await expect(list).toContainText('Jam');
  await list.getByRole('button', { name: 'Aisle / department…' }).click();
  await page.locator('.where-panel').getByRole('tab', { name: 'Aisle' }).click();
  await page.getByLabel('Aisle number').fill('6');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(list.locator('.place-on-map')).toContainText('Tea');
  await list.getByRole('button', { name: 'Aisle / department…' }).click();
  await page.locator('.where-panel').getByRole('tab', { name: 'Aisle' }).click();
  await page.getByLabel('Aisle number').fill('7');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect(list.locator('.place-on-map')).toContainText('Soap');
  await expect(list.getByRole('checkbox')).toBeChecked();
});

test('the map knows its kind, but it was on a display; the front wall is an answer too', async ({ page }) => {
  const ok = noPageErrors(page);
  await addItems(page, 'Bananas, Melon, Cards');
  await tick(page, 'Bananas');
  await describeDept(page, /Produce/);
  await tick(page, 'Melon');
  await expect(page.locator('.toast')).toContainText(/Melon: saved at Produce/i);
  await page.locator('.toast').getByRole('button', { name: 'Change' }).click();
  await openDescribe(page, 'Melon');
  await page.getByRole('tab', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Stand / display' }).click();
  await page.getByRole('button', { name: 'Near the door' }).click();
  await page.getByRole('button', { name: /^Save · / }).click();
  expect((await clues(page)).Melon).toMatchObject({ kind: 'open', fixture: 'stand', near: 'entrance' });
  await page.getByRole('group', { name: 'Where’s Produce stand?' }).getByRole('button', { name: /Not sure/ }).click();
  await tick(page, 'Cards');
  await openDescribe(page);
  await page.getByRole('tab', { name: 'Wall' }).click();
  await page.getByRole('button', { name: '↓ Front' }).click();
  await page.getByRole('button', { name: 'Left of the door' }).click();
  await page.getByRole('button', { name: 'Save · Front wall · left of the door' }).click();
  const corner = async () => (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
  await expect.poll(async () => (await corner()).places.some((p: any) => p.id === 'g-wall-front-left-shelf')).toBe(true);
  const l = await corner();
  const run = l.places.find((p: any) => p.id === 'g-wall-front-left-shelf');
  expect(run.y).toBe(l.height - 1);
  expect(run.x + run.length).toBeLessThan(l.entrance.x);
  expect(l.places.some((p: any) => p.kind === 'area' && /stand/i.test(p.label))).toBe(true);
  ok();
});

test('a second table said like the first: "Another one" keeps them apart', async ({ page }) => {
  const ok = noPageErrors(page);
  await addItems(page, 'Grapes, Pineapple');
  const onTable = async (name: string) => {
    await tick(page, name);
    await openDescribe(page);
    const panel = page.locator('.where-panel');
    await panel.getByRole('tab', { name: 'Open' }).click();
    await panel.getByRole('button', { name: 'Table', exact: true }).click();
    await panel.getByRole('button', { name: 'Near the door', exact: true }).click();
    await panel.getByRole('button', { name: /^Save · / }).click();
  };
  await onTable('Grapes');
  await page.getByRole('group', { name: 'Where’s Produce table?' }).getByRole('button', { name: /Not sure/ }).click();
  await onTable('Pineapple');
  const toast = page.locator('.toast', { hasText: 'same one as Grapes' });
  await toast.getByRole('button', { name: 'Another one' }).click();
  await page.getByRole('group', { name: 'Where’s Produce table 2?' }).getByRole('button', { name: /Not sure/ }).click();
  expect((await clues(page)).Pineapple).toMatchObject({ kind: 'open', fixture: 'table', near: 'entrance', n: 2 });
  expect((await clues(page)).Grapes).not.toHaveProperty('n');
  const corner = (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
  expect(corner.places.filter((p: any) => p.id.startsWith('g-open-'))).toHaveLength(2);
  ok();
});

test('(testing) forget where one item is, or every item on the list, with Undo', async ({ page }) => {
  const ok = noPageErrors(page);
  await enableDebug(page);
  await addItems(page, 'Cereal, Pasta, Chips, Granola');
  for (const [name, n] of [['Cereal', '1'], ['Pasta', '2']] as const) {
    await tick(page, name);
    await describeAisle(page, n);
  }
  expect(Object.keys(await clues(page)).sort()).toEqual(['Cereal', 'Pasta']);
  await page.locator('details.done summary').click();
  const answered = async () => Object.entries(await clues(page)).filter(([, c]) => c).map(([n]) => n).sort();
  await page.getByRole('button', { name: 'Forget where Cereal is' }).click();
  await expect.poll(answered).toEqual(['Pasta']);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(answered).toEqual(['Cereal', 'Pasta']);
  await page.getByRole('button', { name: 'Forget where Granola is' }).click();
  await expect(page.getByRole('button', { name: 'Forget where Granola is' })).toHaveCount(0);
  await tick(page, 'Granola');
  const granolaPlaced = page.locator('.toast').filter({ hasText: /Granola: saved at/i })
    .or(placeSheet(page, 'Granola'));
  await expect(granolaPlaced.first()).toBeVisible();
  if (await placeSheet(page).count()) {
    await placeSheet(page).getByRole('button', { name: 'Later', exact: true }).click();
  } else {
    await page.locator('.toast .icon').click().catch(() => {});
  }
  const places = async () => JSON.stringify((await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner').places);
  const before = await places();
  await toggleListOptions(page);
  await page.getByRole('button', { name: 'Forget where items are at this store' }).click();
  await page.getByRole('button', { name: 'Forget all', exact: true }).click();
  await expect(page.locator('.toast.top')).toContainText('Forgot where');
  await expect.poll(answered).toEqual([]);
  await page.waitForTimeout(300);
  expect(await places()).toBe(before);
  await page.locator('details.done').getByRole('checkbox', { name: /Uncheck Cereal/ }).click({ force: true });
  await expect(row(page, 'Cereal').getByRole('checkbox')).not.toBeChecked();
  await tick(page, 'Cereal');
  await expect(placeSheet(page, 'Cereal')).toBeVisible();
  ok();
});

test('put straight in the cart with no place here: clear map match auto-saves (Change to edit)', async ({ page }) => {
  const ok = noPageErrors(page);
  await addItems(page, 'Cereal');
  await tick(page, 'Cereal');
  await describeAisle(page, '3');
  await page.getByLabel('Item to add').fill('Oatmeal');
  await page.locator('.suggestions .suggestion', { hasText: 'Oatmeal' }).first().locator('.s-btn.cart').click();
  await expect(page.locator('.toast')).toContainText(/Oatmeal: saved at/i);
  await expect(placeSheet(page)).toHaveCount(0);
  await expect.poll(async () => (await clues(page)).Oatmeal).toEqual({ kind: 'aisle', aisle: '3' });
  ok();
});

test('a shelf holds the category of what’s saved on it: named for it, and more of that kind go there', async ({ page }) => {
  await fresh(page, {
    layouts: [{ id: 's1', name: 'Mine', width: 20, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 },
      places: [{ kind: 'shelf', id: 'sh1', label: 'Shelf 1', orientation: 'vertical', x: 5, y: 2, length: 8, categories: [] }] }],
    activeLayout: 's1',
    products: [{ id: 'pasta', name: 'Pasta', categoryId: 'pasta_dry', locations: { s1: 'sh1@0.5,0.5' } }],
  });
  await addItems(page, 'Penne pasta');
  await expect(row(page, 'Penne pasta')).toContainText('Shelf 1');
  await expect(page.locator('svg text', { hasText: 'Shelf 1 - Pasta, Rice & Grains' }).first()).toBeAttached();
  expect((await saved<any[]>(page, 'layouts'))[0].places[0].categories).toEqual([]);
  await enterBuildMode(page);
  await tapMap(page, 5, 5);
  await page.getByRole('button', { name: 'Bigger' }).click();
  const panel = page.locator('.build-sheet-body');
  await expect(panel.getByLabel(/Shelf label/)).toHaveValue('Shelf 1');
  await expect(panel.locator('.holds')).toContainText('Pasta');
  await panel.getByRole('button', { name: /^Keep Pasta/ }).click();
  await expect.poll(async () => (await saved<any[]>(page, 'layouts'))[0].places[0].categories).toEqual(['pasta_dry']);
  await expect(panel.locator('.holds')).toHaveCount(0);
  await panel.getByRole('button', { name: /^Remove Pasta/ }).click();
  await expect.poll(async () => (await saved<any[]>(page, 'layouts'))[0].places[0]).toMatchObject({ categories: [], hides: ['pasta_dry'] });
  await expect(panel.locator('.holds')).toHaveCount(0);
});

test('answered "Aisle 1" in a store drawn by hand: the shelf there holds the item’s kind, and more of it go there', async ({ page }) => {
  await fresh(page, {
    layouts: [{ id: 's1', name: 'Drawn', width: 20, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 },
      places: [
        { kind: 'shelf', id: 'a', label: 'Shelf A', orientation: 'vertical', x: 5, y: 2, length: 8, categories: [] },
        { kind: 'shelf', id: 'b', label: 'Shelf B', orientation: 'vertical', x: 8, y: 2, length: 8, categories: [] },
      ],
      aisles: [{ id: 'a1', label: 'Aisle 1', x: 6, y: 2, w: 2, h: 8 }] }],
    activeLayout: 's1',
  });
  await addItems(page, 'Spaghetti');
  await tick(page, 'Spaghetti');
  await describeAisle(page, '1');
  await addItems(page, 'Penne pasta');
  await expect(row(page, 'Penne pasta')).toContainText(/Shelf [AB]/);
  expect((await saved<any[]>(page, 'layouts'))[0].places.map((p: any) => p.categories)).toEqual([[], []]);
});

test('tap a shelf on the map to place an item', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, {
    layouts: [{ id: 's1', name: 'Drawn', width: 20, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 },
      places: [
        { kind: 'shelf', id: 'dairy', label: 'Dairy', orientation: 'horizontal', x: 2, y: 2, length: 8, categories: [] },
        { kind: 'area', id: 'hw', label: 'Household', x: 12, y: 2, w: 6, h: 6, categories: [] },
      ] }],
    activeLayout: 's1',
  });
  await addItems(page, 'Batteries');
  await tick(page, 'Batteries');
  const sheet = placeSheet(page, 'Batteries');
  await expect(sheet).toBeVisible();
  // Uses the large shopping map (same as 🗺), not a nested mini-map.
  await expect(sheet.locator('.place-on-map-map')).toHaveCount(0);
  await expect(page.locator('.map-wrap svg.map')).toBeVisible();
  const tapHousehold = () => page.locator('.map-wrap svg.map').evaluate((svg, pt) => {
    const q = svg.createSVGPoint();
    q.x = pt[0] + 0.5; q.y = pt[1] + 0.5;
    const r = q.matrixTransform(svg.getScreenCTM());
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x, clientY: r.y }));
  }, [15, 5]);
  // First tap selects (pulsing red); second confirms and stocks the area’s category.
  await tapHousehold();
  await expect(sheet).toContainText(/Selected.*Household/i);
  await expect(page.locator('.map-wrap .place.place-pending')).toHaveCount(1);
  await tapHousehold();
  await expect(sheet).toHaveCount(0);
  const batteries = (await saved<{ name: string; locations?: Record<string, string>; categoryId?: string }[]>(page, 'products')).find((p) => p.name === 'Batteries')!;
  expect(batteries.locations?.s1).toMatch(/^hw(@|$)/);
  const hw = (await saved<any[]>(page, 'layouts'))[0].places.find((p: any) => p.id === 'hw');
  expect(batteries.categoryId).toBeTruthy();
  expect(hw.categories).toEqual([batteries.categoryId]);
  // A second kind on the same area is included alongside the first.
  await addItems(page, 'Milk');
  await tick(page, 'Milk');
  const milkSheet = placeSheet(page, 'Milk');
  await expect(milkSheet).toBeVisible();
  const tapDairy = () => page.locator('.map-wrap svg.map').evaluate((svg, pt) => {
    const q = svg.createSVGPoint();
    q.x = pt[0] + 0.5; q.y = pt[1] + 0.5;
    const r = q.matrixTransform(svg.getScreenCTM());
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x, clientY: r.y }));
  }, [15, 5]);
  await tapDairy();
  await tapDairy();
  await expect(milkSheet).toHaveCount(0);
  const milk = (await saved<{ name: string; categoryId?: string }[]>(page, 'products')).find((p) => p.name === 'Milk')!;
  const hw2 = (await saved<any[]>(page, 'layouts'))[0].places.find((p: any) => p.id === 'hw');
  expect(hw2.categories).toEqual(expect.arrayContaining([batteries.categoryId, milk.categoryId]));
  ok();
});

test('tap open floor on the map to place an item there', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, {
    layouts: [{ id: 's1', name: 'Drawn', width: 20, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 },
      places: [
        { kind: 'shelf', id: 'dairy', label: 'Dairy', orientation: 'horizontal', x: 2, y: 2, length: 8, categories: [] },
      ] }],
    activeLayout: 's1',
  });
  await addItems(page, 'Crackers');
  await tick(page, 'Crackers');
  const sheet = placeSheet(page, 'Crackers');
  await expect(sheet).toBeVisible();
  const tapFloor = () => page.locator('.map-wrap svg.map').evaluate((svg, pt) => {
    const q = svg.createSVGPoint();
    q.x = pt[0] + 0.5; q.y = pt[1] + 0.5;
    const r = q.matrixTransform(svg.getScreenCTM());
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x, clientY: r.y }));
  }, [10, 10]);
  await tapFloor();
  // You move to the tapped cell; pulsing red selects the open square.
  await expect(sheet).toContainText(/Selected this spot/i);
  await expect(page.locator('.map-wrap .floor-pending')).toHaveCount(1);
  const you = await page.locator('.map-wrap .map-you').boundingBox();
  expect(you).toBeTruthy();
  await tapFloor();
  await expect(sheet).toHaveCount(0);
  const crackers = (await saved<{ name: string; locations?: Record<string, string> }[]>(page, 'products')).find((p) => p.name === 'Crackers')!;
  expect(crackers.locations?.s1).toBeTruthy();
  // A place was built or extended so the item has a home on the map.
  const places = (await saved<any[]>(page, 'layouts'))[0].places;
  expect(places.length).toBeGreaterThan(1);
  ok();
});

test('departments set out along the walls: drag one, tap-to-place another', async ({ page }) => {
  const ok = noPageErrors(page);
  await addItems(page, 'Apples, Bread');
  await tick(page, 'Apples');
  await describeWall(page, 'Right');
  await tick(page, 'Bread');
  await describeDept(page, /Bakery/);
  await expect(page.getByRole('group', { name: 'Where’s Bakery?' })).toHaveCount(0);
  await page.getByRole('button', { name: /Fine-tune departments on the map/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Departments on the walls' });
  const left = sheet.getByRole('group', { name: 'Left wall' });
  const back = sheet.getByRole('group', { name: 'Back wall' });
  const bakery = sheet.getByRole('button', { name: 'Bakery', exact: true });
  const from = (await bakery.boundingBox())!;
  const to = (await left.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 10, { steps: 6 });
  await page.mouse.up();
  await expect(left.getByRole('button', { name: 'Bakery' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Meat', exact: true }).click();
  await back.click({ position: { x: 4, y: 4 } });
  await expect(back.getByRole('button', { name: 'Meat' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
  const corner = async () => (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
  await expect.poll(async () => (await corner()).places.find((x: any) => x.id === 'g-dept-bakery')?.x ?? 99).toBeLessThan(5);
  const l = await corner();
  expect(l.gen.wallOrder).toEqual({ left: ['bakery'], back: ['meat'], right: ['produce'] });
  expect(l.gen.wallsOffered).toBe(true);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await corner()).gen.wallOrder).toBeUndefined();
  ok();
});

test('shelf labels like B12: set up by example via Describe…', async ({ page }) => {
  await addItems(page, 'Cereal, Oats, Chips');
  await tick(page, 'Cereal');
  await openDescribe(page);
  const panel = page.locator('.where-panel');
  await panel.getByRole('tab', { name: 'Aisle' }).click();
  await panel.getByLabel('Aisle number').fill('B12');
  await panel.getByRole('button', { name: /Labels like/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Shelf labels' });
  await expect(sheet.getByLabel('Example label')).toHaveValue('B12');
  await expect(sheet).toContainText('Read as section B, shelf 12');
  await sheet.getByRole('radio', { name: /Facing pairs/ }).click();
  await sheet.getByRole('button', { name: 'Save' }).click();
  await tick(page, 'Oats');
  await openDescribe(page);
  await page.locator('.where-panel').getByRole('tab', { name: 'Aisle' }).click();
  await page.getByLabel('Aisle number').fill('B13');
  await page.getByRole('button', { name: /^Save · Shelf B13/ }).click();
  await tick(page, 'Chips');
  await openDescribe(page);
  await page.locator('.where-panel').getByRole('tab', { name: 'Aisle' }).click();
  await page.getByLabel('Aisle number').fill('C4');
  await page.getByRole('button', { name: /^Save · Shelf C4/ }).click();
  await expect(page.getByRole('group', { name: 'Where’s Section C?' })).toHaveCount(0);
  const corner0 = async () => (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
  await expect.poll(async () => { const c = await corner0(); const f = (lb: string) => c.places.find((x: any) => x.label === lb); return f('C1') && f('B1') ? f('B1').x - f('C1').x : -1; }).toBeGreaterThan(0);
  await enterBuildMode(page);
  await page.locator('.build-sheet').getByRole('tab', { name: /^Store/ }).click();
  await page.locator('.store-settings summary').click();
  await page.locator('.gen-choice', { hasText: 'Section C' }).getByRole('button', { name: 'Place…' }).click();
  const card = page.getByRole('group', { name: 'Where’s Section C?' });
  await card.locator('.placement-options .chip', { hasText: 'In front of section B' }).click();
  await card.getByRole('button', { name: 'Place here' }).click();
  const corner = async () => (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
  const below = async () => { const c = await corner(); const f = (lb: string) => c.places.find((x: any) => x.label === lb); return f('C1') && f('B1') ? f('C1').y - f('B1').y : -1; };
  await expect.poll(below).toBeGreaterThan(9);
  const l = await corner();
  expect(l.labels).toMatchObject({ example: 'B12', roles: ['section', 'shelf'], pairing: 'facing' });
  const labels = l.places.filter((p: any) => p.id.startsWith('g-sec-')).map((p: any) => p.label);
  expect(labels).toEqual(expect.arrayContaining(['B1', 'B12', 'B13', 'C1', 'C4']));
  const products = await saved<any[]>(page, 'products');
  expect(Object.values(products.find((x) => x.name === 'Oatmeal').clues)[0]).toEqual({ kind: 'shelf', code: 'B13', section: 'B', shelf: 13 });
});

test('a stand across aisles 2–3 at the front: the map puts it there and the shelves make way', async ({ page }) => {
  await addItems(page, 'Cereal, Promo crisps');
  await tick(page, 'Cereal');
  await describeAisle(page, '4');
  await tick(page, 'Promo crisps');
  await openDescribe(page);
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
  await expect(page.getByRole('group', { name: /Where’s/ })).toHaveCount(0);
});

test('where’s the door? applied quietly at the end of a trip from trip starts', async ({ page }) => {
  await addItems(page, 'Apples, Cereal, Milk');
  await tick(page, 'Apples');
  await describeWall(page, 'Right');
  await tick(page, 'Cereal');
  await describeAisle(page, '3');
  await tick(page, 'Milk');
  await describeWall(page, 'Left');
  await expect(page.getByRole('group', { name: 'Where’s the door?' })).toHaveCount(0);
  await expect.poll(async () => {
    const l = (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner');
    return l.gen?.sure?.includes('entrance');
  }).toBe(true);
});

test('across aisles picked on the mini-map, with a preview of where it goes', async ({ page }) => {
  await addItems(page, 'Cereal, Promo crisps');
  await tick(page, 'Cereal');
  await describeAisle(page, '4');
  await tick(page, 'Promo crisps');
  await openDescribe(page);
  await page.getByRole('tab', { name: 'Open' }).click();
  await page.getByRole('button', { name: 'Across aisles…' }).click();
  const map = page.locator('.where-panel .across-map svg.map');
  await map.locator('.aisle-label', { hasText: /AISLE 2/i }).locator('text').click({ force: true });
  await map.locator('.aisle-label', { hasText: /AISLE 3/i }).locator('text').click({ force: true });
  await expect(page.getByLabel('From aisle or section')).toHaveValue('2');
  await expect(page.getByLabel('To aisle or section')).toHaveValue('3');
  await expect(map.locator('.map-ghost.preview')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /^Save · Out in the open across aisles 2–3 \(back\)/ }).click();
  await expect.poll(async () => (await saved<any[]>(page, 'layouts')).find((x) => x.name === 'Corner').places.some((p: any) => p.id.startsWith('g-open-x2-3-back'))).toBe(true);
});

test('things put just past a shelf’s end: the shelf is offered longer at the end of the trip', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, {
    layouts: [{ id: 's1', name: 'Mine', width: 20, height: 20, entrance: { x: 1, y: 19 }, checkout: { x: 10, y: 19 },
      places: [{ kind: 'shelf', id: 'sh1', label: 'Cereal', orientation: 'vertical', x: 5, y: 6, length: 8, categories: [] }] }],
    activeLayout: 's1',
    products: [{ id: 'jam', name: 'Jam', categoryId: 'breakfast_spreads', locations: { s1: 'sh1@0.5,0.5' } }],
  });
  await addItems(page, 'Zorbo, Quibble');
  await toggleListOptions(page);
  await page.getByRole('button', { name: 'Whole map' }).click();
  await toggleListOptions(page);
  const dropPast = async (name: string, gy: number) => {
    const handle = page.getByLabel(new RegExp(`^Drag ${name}`)).first();
    // Trip chrome can push rows below the fold; the drag must start on-screen.
    await handle.scrollIntoViewIfNeeded();
    const from = (await handle.boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y - 40, { steps: 4 });
    const to = await page.evaluate(([x, y]) => {
      const maps = [...document.querySelectorAll('svg.map')] as SVGSVGElement[];
      // Prefer the drag preview overlay map when present (fixed at the top).
      const overlay = document.querySelector('.drop-overlay svg.map') as SVGSVGElement | null;
      const svg = overlay
        ?? maps.find((m) => { const r = m.getBoundingClientRect(); return m.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })
        ?? maps[0];
      const q = svg.createSVGPoint();
      q.x = x + 0.5; q.y = y + 0.5;
      const r = q.matrixTransform(svg.getScreenCTM()!);
      return { x: r.x, y: r.y };
    }, [5, gy]);
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  await dropPast('Zorbo', 4);
  await dropPast('Quibble', 5);
  const layout = async () => (await saved<any[]>(page, 'layouts'))[0];
  await expect.poll(async () => (await layout()).reach?.length ?? 0).toBe(2);
  const products = await saved<any[]>(page, 'products');
  expect(products.find((p) => p.name === 'Zorbo').locations.s1).toBe('sh1@0,0.5');
  await tick(page, 'Zorbo');
  await tick(page, 'Quibble');
  await expect(page.locator('.toast')).toContainText(/Cereal.*extended/i);
  await expect.poll(async () => (await layout()).places[0]).toMatchObject({ y: 4, length: 10 });
  const after = await saved<any[]>(page, 'products');
  expect(after.find((p) => p.name === 'Jam').locations.s1).toBe('sh1@0.6,0.5');
  await expect(page.getByRole('group', { name: 'Is Cereal longer?' })).toHaveCount(0);
  ok();
});

test('a map broken by an older version (a changed shelf in the way of a new aisle) is repaired when it loads', async ({ page }) => {
  const shelf = (id: string, x: number, label = id.replace(/^g-shelf-/, '').replace('-', '')) =>
    ({ kind: 'shelf', id, label, orientation: 'vertical', x, y: 3, length: 10, categories: [] });
  const clue = (aisle: string) => ({ s1: { kind: 'aisle', aisle } });
  await fresh(page, {
    layouts: [{ id: 's1', name: 'Built', width: 20, height: 16, entrance: { x: 9, y: 15 }, checkout: { x: 9, y: 15 },
      places: [shelf('g-shelf-4-R', 4), shelf('g-shelf-3-L', 5), shelf('g-shelf-3-R', 8), { ...shelf('g-shelf-1-L', 9), label: '1L' }, shelf('g-shelf-2-R', 12)],
      aisles: [{ id: 'g-aisle-4', label: 'Aisle 4', x: 2, y: 3, w: 2, h: 10 }, { id: 'g-aisle-3', label: 'Aisle 3', x: 6, y: 3, w: 2, h: 10 }, { id: 'g-aisle-1', label: 'Aisle 1', x: 10, y: 3, w: 2, h: 10 }],
      gen: { enabled: true, entrance: 'left', locked: ['g-shelf-1-L'], key: 'from an older version' } }],
    activeLayout: 's1',
    products: [
      { id: 'c', name: 'Cereal', categoryId: 'breakfast_cereal', clues: clue('1') },
      { id: 'p', name: 'Pasta', categoryId: 'pasta_dry', clues: clue('3') },
      { id: 's', name: 'Soup', categoryId: 'canned_soup_broth', clues: clue('4') },
    ],
  });
  const ids = async () => (await saved<any[]>(page, 'layouts'))[0].places.map((p: any) => p.id).filter((id: string) => id.startsWith('g-shelf-')).sort();
  await expect.poll(ids).toContain('g-shelf-2-L');
  const l = (await saved<any[]>(page, 'layouts'))[0];
  expect(l.aisles.map((a: any) => a.label).sort()).toEqual(['Aisle 1', 'Aisle 2', 'Aisle 3', 'Aisle 4']);
  const x = (id: string) => l.places.find((p: any) => p.id === id).x;
  expect(x('g-shelf-1-L')).toBeGreaterThan(x('g-shelf-2-L'));
});

test('“Where I’m standing” keeps the pin and moves the item to where you are', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page);
  await addItems(page, 'milk');
  await toggleListOptions(page);
  await page.getByRole('button', { name: 'Whole map' }).click();
  await toggleListOptions(page);
  await tapMap(page, 6, 20);
  const before = await saved<{ layoutId: string; point: { x: number; y: number } }>(page, 'position.v2');
  expect(before.point).toEqual({ x: 6, y: 20 });
  await tick(page, 'Milk');
  const afterTick = await saved<{ point: { x: number; y: number } }>(page, 'position.v2');
  expect(afterTick.point).toEqual({ x: 6, y: 20 });
  await expect(page.locator('.toast')).toContainText(/Milk: saved at/i);
  await page.locator('.toast').getByRole('button', { name: 'Change' }).click();
  const sheet = placeSheet(page, 'Milk');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Where I’m standing' }).click();
  await sheet.locator('[aria-label="Where I’m standing"] .btn').first().click();
  const milk = (await saved<{ name: string; locations?: Record<string, string> }[]>(page, 'products')).find((p) => p.name === 'Milk')!;
  expect(milk.locations?.demo).toBeTruthy();
  expect(milk.locations!.demo.startsWith('dairy')).toBe(false);
  const still = await saved<{ point: { x: number; y: number } }>(page, 'position.v2');
  expect(still.point).toEqual({ x: 6, y: 20 });
  ok();
});

test('“Where I’m standing”: below aisle 3 past the walkway, the aisle carries on there in one tap', async ({ page }) => {
  const ok = noPageErrors(page);
  const v = (id: string, label: string, x: number) => ({ kind: 'shelf', id, label, orientation: 'vertical', x, y: 2, length: 10, categories: [] });
  await fresh(page, {
    layouts: [{ id: 's1', name: 'Mine', width: 20, height: 22, entrance: { x: 1, y: 21 }, checkout: { x: 15, y: 21 },
      places: [v('l', '3L', 5), v('r', '3R', 8)], aisles: [{ id: 'a3', label: 'Aisle 3', x: 6, y: 2, w: 2, h: 10 }] }],
    activeLayout: 's1',
  });
  await addItems(page, 'Pickles');
  await toggleListOptions(page);
  await page.getByRole('button', { name: 'Whole map' }).click();
  await toggleListOptions(page);
  await tapMap(page, 8, 15);
  await tick(page, 'Pickles');
  const sheet = placeSheet(page, 'Pickles');
  await sheet.getByRole('button', { name: 'Where I’m standing' }).click();
  await sheet.getByRole('button', { name: 'Aisle 3 carries on here · 3R' }).click();
  const places = async () => (await saved<any[]>(page, 'layouts'))[0].places;
  await expect.poll(async () => (await places()).map((p: any) => `${p.label}@${p.x},${p.y}+${p.length}`)).toEqual(['3L@5,2+10', '3R@8,2+10', '3L@5,14+3', '3R@8,14+3']);
  const pickles = (await saved<any[]>(page, 'products')).find((p) => p.name === 'Pickles');
  expect(pickles.locations.s1.split('@')[0]).toBe((await places())[3].id);
  await expect(page.locator('.toast')).toContainText('Aisle 3 carries on here');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await places()).length).toBe(2);
  ok();
});

test('phone shows a small map; placing opens the whole map; aisle tap is not open floor', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, {
    layouts: [{ id: 's1', name: 'Drawn', width: 20, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 },
      places: [
        { kind: 'shelf', id: 'a', label: '3L', orientation: 'vertical', x: 3, y: 4, length: 10, categories: [] },
        { kind: 'shelf', id: 'b', label: '3R', orientation: 'vertical', x: 6, y: 4, length: 10, categories: [] },
      ],
      aisles: [{ id: 'aisle3', label: 'Aisle 3', x: 4, y: 4, w: 2, h: 10 }],
    }],
    activeLayout: 's1',
  });
  await addItems(page, 'Crackers');
  // Browsing: a small map strip on phone.
  await expect(page.locator('.map-wrap svg.map.strip')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Add to the map here' })).toHaveCount(0);
  // The row has one ⋯ button; Remove from list lives in its menu (and on swipe).
  await expect(page.getByRole('button', { name: 'Remove Crackers from list' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More options for Crackers' })).toBeVisible();

  await tick(page, 'Crackers');
  const sheet = placeSheet(page, 'Crackers');
  await expect(sheet).toBeVisible();
  await expect(page.locator('.map-wrap svg.map.strip')).toHaveCount(0);
  await expect(page.locator('.map-wrap svg.map')).toBeVisible();
  // Tap the labeled aisle walkway: move only — no open-floor pending pulse.
  const tapAisle = () => page.locator('.map-wrap svg.map').evaluate((svg, pt) => {
    const q = svg.createSVGPoint();
    q.x = pt[0] + 0.5; q.y = pt[1] + 0.5;
    const r = q.matrixTransform(svg.getScreenCTM());
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x, clientY: r.y }));
  }, [4, 8]);
  await tapAisle();
  await expect(sheet).not.toContainText(/Selected this spot/i);
  await expect(page.locator('.map-wrap .floor-pending')).toHaveCount(0);
  await expect(sheet).toBeVisible();
  ok();
});
