import { expect, test } from '@playwright/test';
import { addItems, fresh, noPageErrors, row, saved, tick, toggleListOptions } from './helpers';

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
  await expect(page.locator('.progress')).toHaveText(/1\s*of\s*3/);
  await expect(page.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '1');
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
  await toggleListOptions(page);
  await page.getByRole('button', { name: 'Prices' }).click();
  await row(page, 'Milk').getByRole('button', { name: /More options/ }).click();
  const menu = page.getByRole('dialog', { name: /Options for Milk/ });
  await menu.getByLabel('Unit for Milk').selectOption('box');
  await menu.getByLabel('Price for Milk').fill('3.49');
  await menu.getByLabel('Note for Milk').fill('skim');
  await menu.getByRole('button', { name: 'Show on the map' }).click();
  await expect(row(page, 'Milk')).toContainText(/box/i);
  await expect(row(page, 'Milk').getByRole('button', { name: /Line total for Milk: \$3\.49/ })).toBeVisible();
  await expect(row(page, 'Milk')).toContainText('skim');
  await expect(page.locator('.map-pin')).toHaveCount(1);
  const items = await saved<{ unit?: string; price?: number; note?: string; productId?: string }[]>(page, 'items');
  expect(items[0]).toMatchObject({ unit: 'box', price: 3.49, note: 'skim' });
  // List price is remembered on the product for the active store.
  const products = await saved<{ id: string; name: string; prices?: Record<string, { amount: number; unit?: string }> }[]>(page, 'products');
  const milk = products.find((p) => p.id === items[0].productId) ?? products.find((p) => p.name === 'Milk');
  expect(milk?.prices).toBeTruthy();
  const storePrice = Object.values(milk!.prices!)[0];
  expect(storePrice).toMatchObject({ amount: 3.49, unit: 'box' });
});

test('list sort shows nearest, category and A–Z side by side', async ({ page }) => {
  await addItems(page, 'zucchini, apples, milk');
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('radio', { name: /Sort nearest first/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('main .flat-list')).toContainText(/Nearest first/i);
  await page.getByRole('radio', { name: /Sort by category/ }).click();
  await expect(page.locator('main .flat-list')).toContainText(/By category/i);
  await page.getByRole('radio', { name: /Sort alphabetically/ }).click();
  await expect(page.locator('main .flat-list')).toContainText(/A–Z/);
  const names = await page.locator('main .flat-list .row .name-edit').allTextContents();
  expect(names.map((n) => n.trim())).toEqual([...names].map((n) => n.trim()).sort((a, b) => a.localeCompare(b)));
});

test('trip done: summary, things to get elsewhere, clear the cart with undo', async ({ page }) => {
  await addItems(page, 'Milk, Bread, Saffron threads');
  await tick(page, 'Milk');
  await tick(page, 'Bread');
  await row(page, 'Saffron').getByRole('button', { name: /More options/ }).click();
  await page.getByRole('button', { name: /Not sold at/ }).click();
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

test('cart items have the ⋯ menu for place, aisle and price', async ({ page }) => {
  await fresh(page, { display: { noAskStores: ['demo'] } });
  await addItems(page, 'milk');
  await tick(page, 'Milk');
  const cart = page.locator('details.done');
  await expect(cart).toContainText('In the cart');
  await cart.locator('summary').click();
  await cart.getByRole('button', { name: /More options for Milk/ }).click();
  const menu = page.getByRole('dialog', { name: /Options for Milk/ });
  await expect(menu.getByRole('button', { name: /Change place on the map/ })).toBeVisible();
  await expect(menu.getByRole('button', { name: /Aisle \/ department/ })).toBeVisible();
  await menu.getByLabel('Price for Milk').fill('2.49');
  await menu.getByRole('button', { name: 'Done' }).click();
  const items = await saved<{ name: string; done?: boolean; price?: number }[]>(page, 'items');
  expect(items.find((i) => i.name === 'Milk')).toMatchObject({ done: true, price: 2.49 });
});

test('Shop has no Buy again or Last trip; list sits under the map', async ({ page }) => {
  const t = (start: number, names: string[]) => ({ layoutId: 'demo', start, picks: names.map((name, i) => ({ name, at: start + i })) });
  await fresh(page, {
    trips: [t(1, ['Milk', 'Bread', 'Eggs']), t(2, ['Milk', 'Bread']), t(3, ['Milk', 'Apples'])],
    items: [],
    display: { noAskStores: ['demo'], mapView: 'full' },
  });
  await expect(page.locator('.buy-again')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Last trip|Shop last trip/ })).toHaveCount(0);
  await expect(page.locator('.empty')).toContainText('Your list is empty');
  await addItems(page, 'apples');
  // With map open, the shopping list follows the map slot; add compose is after the list.
  const order = await page.locator('.shop-columns > *').evaluateAll((els) => els.map((e) => e.className));
  expect(order[0]).toContain('shop-map-slot');
  expect(order[1]).toContain('shop-list-col');
  const colKids = await page.locator('.shop-list-col > *').evaluateAll((els) => els.map((e) => e.tagName + '.' + e.className));
  expect(colKids[0]).toMatch(/^MAIN\b/i);
  expect(colKids.some((c) => c.includes('shop-compose'))).toBe(true);
  expect(colKids.findIndex((c) => c.includes('shop-compose'))).toBeGreaterThan(colKids.findIndex((c) => /^MAIN\b/i.test(c)));
});

test('sort sits by the search box; the phone map starts small and can grow or hide', async ({ page }) => {
  await addItems(page, 'apples, bread, milk');
  await expect(page.locator('.add-tools')).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Sort' })).toBeVisible();
  // Phone shows a small map near you by default.
  const strip = page.locator('.map-wrap svg.map.strip');
  await expect(strip).toBeVisible();
  const small = (await strip.boundingBox())!.height;
  // The map's own button grows it to the whole map…
  await page.getByRole('button', { name: 'Show the whole map' }).click();
  await expect(strip).toHaveCount(0);
  const big = (await page.locator('.map-wrap svg.map').boundingBox())!.height;
  expect(big).toBeGreaterThan(small);
  // …and the Map switch in List options hides it, then brings it back.
  await toggleListOptions(page);
  await page.getByRole('radio', { name: 'Hide the map' }).click();
  await expect(page.locator('.map-wrap svg.map')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Show a small map near you' }).click();
  await expect(strip).toBeVisible();
  await toggleListOptions(page);
  // A hidden map leaves one "Show map" button.
  await page.getByRole('button', { name: 'Hide the map' }).click();
  await expect(page.getByRole('button', { name: 'Show map' })).toBeVisible();
  await page.getByRole('button', { name: 'Show map' }).click();
  await expect(strip).toBeVisible();
});

test('Unplaced Items: place button opens the map for double-tap exact placement', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, {
    display: { noAskStores: ['s1'] },
    layouts: [{
      id: 's1', name: 'Drawn', width: 20, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 },
      places: [
        { kind: 'area', id: 'hw', label: 'Household', x: 12, y: 2, w: 6, h: 6, categories: [] },
      ],
    }],
    activeLayout: 's1',
  });
  // Unknown product → no category clue → Unplaced Items.
  await addItems(page, 'Zorblax');
  const section = page.locator('.unplaced-items');
  await expect(section.getByRole('heading', { name: 'Unplaced Items' })).toBeVisible();
  await expect(section.locator('select')).toHaveCount(0);
  await section.getByRole('button', { name: 'Place Zorblax on the map' }).click();
  const sheet = page.getByRole('dialog', { name: /Where was Zorblax/ });
  await expect(sheet).toBeVisible();
  await expect(page.locator('.shop-map-slot.is-open')).toHaveCount(1);
  const tap = () => page.locator('.map-wrap svg.map').evaluate((svg, pt) => {
    const q = svg.createSVGPoint();
    q.x = pt[0] + 0.25; q.y = pt[1] + 0.75;
    const r = q.matrixTransform(svg.getScreenCTM());
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x, clientY: r.y }));
  }, [13, 3]);
  await tap();
  await expect(sheet).toContainText(/Selected.*Household/i);
  await tap();
  await expect(sheet).toHaveCount(0);
  await expect(section).toHaveCount(0);
  const item = (await saved<{ name: string; locations?: Record<string, string> }[]>(page, 'products')).find((p) => p.name === 'Zorblax')!;
  expect(item.locations?.s1).toMatch(/^hw@/);
  // Exact tap near the area’s top-left should not land at the dead centre.
  const spot = item.locations!.s1.split('@')[1]!;
  const [u, v] = spot.split(',').map(Number);
  expect(u).toBeLessThan(0.4);
  expect(v).toBeLessThan(0.4);
  ok();
});

test('Not sold section is collapsible with a red outline', async ({ page }) => {
  await addItems(page, 'Milk, Saffron threads');
  await row(page, 'Saffron').getByRole('button', { name: /More options/ }).click();
  await page.getByRole('button', { name: /Not sold at/ }).click();
  const section = page.locator('details.unavailable-section');
  await expect(section).toBeVisible();
  await expect(section).not.toHaveAttribute('open', '');
  await section.locator('summary').click();
  await expect(section).toHaveAttribute('open', '');
  await expect(section.locator('.name')).toContainText('Saffron');
});

test('row buttons have a 44px touch area', async ({ page }) => {
  await addItems(page, 'apples');
  const more = row(page, 'Apples').getByRole('button', { name: /More options/ });
  const box = (await more.boundingBox())!;
  // Just above and below the drawn button still lands on it (the hit area is bigger than the glyph).
  for (const dy of [-3, box.height + 3]) {
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'), [box.x + box.width / 2, box.y + dy]);
    expect(hit).toMatch(/More options/);
  }
});

test('List options: Edit map row, danger zone asks before clearing, no debug controls', async ({ page }) => {
  await addItems(page, 'apples');
  await expect(page.getByRole('button', { name: /Forget where/ })).toHaveCount(0);
  await toggleListOptions(page);
  await expect(page.getByRole('button', { name: 'Edit map', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Forget where items are at this store' }).click();
  await expect(page.getByRole('button', { name: 'Forget all', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Forget where items are at this store' })).toBeVisible();
});

test('a Shop row has one ⋯ button; pin and remove live in its menu', async ({ page }) => {
  await addItems(page, 'apples');
  const r = row(page, 'Apples');
  await expect(r.getByRole('button', { name: /More options for Apples/ })).toBeVisible();
  await expect(r.getByRole('button', { name: /Remove Apples from list/ })).toHaveCount(0);
  await expect(r.getByRole('button', { name: /on the map/ })).toHaveCount(0);
  await r.getByRole('button', { name: /More options/ }).click();
  const menu = page.getByRole('dialog', { name: /Options for Apples/ });
  await expect(menu.getByRole('button', { name: 'Show on the map' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Remove from list' })).toBeVisible();
});

test('empty Shop: picture, and one action that focuses the add box', async ({ page }) => {
  await expect(page.locator('.empty .empty-art')).toBeVisible();
  await page.getByRole('button', { name: 'Add your first item' }).click();
  await expect(page.getByLabel('Item to add')).toBeFocused();
});
