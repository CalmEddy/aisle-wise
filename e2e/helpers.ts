import { expect, type Page } from '@playwright/test';

/** Starts from a clean phone: nothing saved, the Shop tab, plus anything in `data` (localStorage keys without "aw."). */
export async function fresh(page: Page, data: Record<string, unknown> = {}) {
  await page.goto('/');
  await page.evaluate((d) => {
    localStorage.clear();
    localStorage.setItem('aw.view', JSON.stringify('list'));
    localStorage.setItem('aw.welcomed', '1');
    localStorage.setItem('aw.swipeHintSeen', 'true');
    for (const [k, v] of Object.entries(d)) localStorage.setItem(`aw.${k}`, JSON.stringify(v));
  }, data);
  await page.reload();
}

/** Opens the ⚙ List options menu on Shop (toggle: call again to close it). */
export async function toggleListOptions(page: Page) {
  await page.getByRole('button', { name: 'List options' }).click();
}

/** Opens a main section by tab name ("Setup" and its sub-tabs for now). */
export async function goSetup(page: Page, sub?: 'Lists' | 'Items & Categories' | 'Stores') {
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  if (sub) await page.getByRole('tab', { name: sub, exact: true }).click();
}

/** Turns on developer-only controls (e.g. the per-item "Clear where" button). */
export async function enableDebug(page: Page) {
  await page.evaluate(() => localStorage.setItem('aw.debug', 'true'));
  await page.reload();
}

/** What the app has saved under a key (without "aw."). */
export function saved<T = any>(page: Page, key: string): Promise<T> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(`aw.${k}`) ?? 'null'), key);
}

/** Adds items via the on-screen search (Shop) or add sheet (Setup / other lists). */
export async function addItems(page: Page, text: string) {
  const input = page.getByLabel('Item to add').first();
  if (!(await input.isVisible())) {
    await page.getByRole('button', { name: /Add items/ }).first().click();
  }
  await page.getByLabel('Item to add').first().fill(text);
  await page.getByLabel('Item to add').first().press('Enter');
  const done = page.locator('.add-sheet').getByRole('button', { name: 'Done' });
  if (await done.count()) await done.click();
}

/** A list row by item name. */
export const row = (page: Page, name: string) => page.locator('main .row', { hasText: name }).first();

/** Checks an item off by tapping its checkbox (name is for rename). */
export async function tick(page: Page, name: string) {
  await row(page, name).getByRole('checkbox').click();
}

/** Opens Edit map via Setup → Stores (map editing lives there). */
export async function enterBuildMode(page: Page) {
  await page.getByRole('tab', { name: 'Setup', exact: true }).click();
  await page.getByRole('tab', { name: 'Stores', exact: true }).click();
  const region = page.getByRole('region', { name: 'Edit map' });
  if (await region.count()) return;
  const direct = page.getByRole('button', { name: 'Edit map', exact: true });
  if (await direct.count()) {
    await direct.click();
    return;
  }
  await page.getByRole('button', { name: 'View settings' }).click();
  await page.getByRole('button', { name: 'Build mode' }).click();
}

/**
 * Starts a new blank store right here.
 * By default turns off check-off auto-build and drops `gen`, so "Where was it?"
 * answers can grow the map (where.e2e). Pass `{ autoBuild: true }` to keep the
 * live category-area builder.
 */
export async function newStore(page: Page, name: string, opts?: { autoBuild?: boolean }) {
  await page.getByRole('button', { name: /Change store/ }).click();
  await page.getByLabel('New store name').fill(name);
  await page.getByRole('button', { name: '＋ Here' }).click();
  await page.getByRole('button', { name: 'More layouts or blank…' }).click();
  await page.getByRole('radio', { name: /Blank/ }).click();
  await page.getByRole('button', { name: 'Create store' }).click();
  // Skip first-time door/blank setup so later steps start on a clean map.
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.count()) await skip.click();
  if (opts?.autoBuild) return;
  // Blank stores enable auto-build by default; strip it (and inert gen) so aisle
  // answers regenerate the map the way where.e2e expects.
  await page.evaluate((storeName) => {
    const layouts = JSON.parse(localStorage.getItem('aw.layouts') ?? '[]') as { name: string; auto?: unknown; gen?: unknown }[];
    localStorage.setItem('aw.layouts', JSON.stringify(layouts.map((l) => {
      if (l.name !== storeName) return l;
      const { auto: _a, gen: _g, ...rest } = l;
      return rest;
    })));
  }, name);
  await page.reload();
}

/** The text of the toasts showing. */
export async function toastText(page: Page) {
  return (await page.locator('.toast').allInnerTexts()).join(' | ').replace(/\s+/g, ' ');
}

/** Screen point of the middle of grid square (gx, gy) on the map. */
export async function gridPoint(page: Page, gx: number, gy: number) {
  return page.evaluate(([x, y]) => {
    const svg = document.querySelector('svg.map') as SVGSVGElement;
    const q = svg.createSVGPoint();
    q.x = x + 0.5;
    q.y = y + 0.5;
    const r = q.matrixTransform(svg.getScreenCTM()!);
    return { x: r.x, y: r.y };
  }, [gx, gy]);
}

/** Taps grid square (gx, gy) on the map. */
export async function tapMap(page: Page, gx: number, gy: number) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const p = await gridPoint(page, gx, gy);
  await page.mouse.click(p.x, p.y);
}

/** Drags on the map from one grid square to another. */
export async function dragMap(page: Page, from: [number, number], to: [number, number]) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const a = await gridPoint(page, ...from);
  const b = await gridPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

/** Fails the test on any uncaught page error. */
export function noPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return () => expect(errors).toEqual([]);
}

/** The map-first "Where was it?" sheet for an item. */
export const placeSheet = (page: Page, name?: string) =>
  page.getByRole('dialog', { name: name ? `Where was ${name}?` : /Where was / });

/** Opens Describe… on the current place sheet (WherePanel). */
export async function openDescribe(page: Page, itemName?: string) {
  await placeSheet(page, itemName).getByRole('button', { name: 'Describe…' }).click();
}

/** Answer via Describe… → Aisle tab (number + optional side/temp). */
export async function describeAisle(page: Page, aisle: string, opts: { side?: 'L' | 'R'; temp?: 'chilled' | 'frozen' | 'shelf'; pos?: 'front' | 'middle' | 'back' } = {}) {
  await openDescribe(page);
  const panel = page.locator('.where-panel');
  await panel.getByRole('tab', { name: 'Aisle' }).click();
  if (opts.temp === 'frozen') await panel.getByRole('button', { name: '❄ Freezer' }).click();
  else if (opts.temp === 'chilled') await panel.getByRole('button', { name: '🧊 Fridge' }).click();
  else if (opts.temp === 'shelf') await panel.getByRole('button', { name: 'Shelf', exact: true }).click();
  await panel.getByLabel('Aisle number').fill(aisle);
  if (opts.side === 'R') await panel.getByRole('button', { name: 'Right →' }).click();
  if (opts.side === 'L') await panel.getByRole('button', { name: '← Left' }).click();
  if (opts.pos) await panel.getByRole('button', { name: opts.pos[0].toUpperCase() + opts.pos.slice(1), exact: true }).click();
  await panel.getByRole('button', { name: /^Save/ }).click();
}

/** Answer via Describe… → Department. */
export async function describeDept(page: Page, dept: string | RegExp) {
  await openDescribe(page);
  const panel = page.locator('.where-panel');
  await panel.getByRole('tab', { name: 'Department' }).click();
  await panel.getByRole('button', { name: dept }).click();
}

/** Answer via Describe… → Wall. */
export async function describeWall(page: Page, wall: 'Left' | 'Back' | 'Right' | 'Front', part?: string, temp?: 'chilled' | 'frozen') {
  await openDescribe(page);
  const panel = page.locator('.where-panel');
  await panel.getByRole('tab', { name: 'Wall' }).click();
  const wallLabel = wall === 'Left' ? '← Left' : wall === 'Back' ? '↑ Back' : wall === 'Right' ? 'Right →' : '↓ Front';
  await panel.getByRole('button', { name: wallLabel }).click();
  if (part) await panel.getByRole('button', { name: part, exact: true }).click();
  if (temp === 'frozen') await panel.getByRole('button', { name: '❄ Freezer' }).click();
  if (temp === 'chilled') await panel.getByRole('button', { name: '🧊 Fridge' }).click();
  await panel.getByRole('button', { name: /^Save/ }).click();
}

/** A store built only from "Where was it?" answers: the example corner store (entrance front right). */
export function cornerStore() {
  const c = (name: string, categoryId: string | undefined, clue: object) => ({ id: name, name, ...(categoryId && { categoryId }), clues: { s1: clue } });
  const products = [
    c('Apples', 'produce_fruits', { kind: 'wall', wall: 'right', part: 'front' }),
    c('Bread', 'bakery_bread', { kind: 'wall', wall: 'right', part: 'back' }),
    c('Steak', 'meat_seafood', { kind: 'wall', wall: 'back', part: 'left' }),
    c('Juice', 'beverages_juice', { kind: 'wall', wall: 'back', part: 'right', temp: 'chilled' }),
    c('Hummus', undefined, { kind: 'wall', wall: 'left', part: 'back', temp: 'chilled' }),
    c('Pizza', 'frozen_pizza_appetizers', { kind: 'wall', wall: 'left', part: 'front', temp: 'frozen' }),
    c('Melon', 'produce_fruits', { kind: 'open', near: 'entrance', fixture: 'table' }),
    c('Ice cream', 'frozen_desserts_ice', { kind: 'open', near: 'middle', fixture: 'case', temp: 'frozen' }),
    c('Cereal', 'breakfast_cereal_sub', { kind: 'aisle', aisle: '5' }),
    c('Pasta', 'pasta_dry', { kind: 'aisle', aisle: '3', side: 'R' }),
  ];
  return {
    products,
    layouts: [{ id: 's1', name: 'Corner Market', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 }, gen: { enabled: true, entrance: 'right', locked: [] } }],
    activeLayout: 's1',
    items: products.map((p, i) => ({ id: `i${i}`, name: p.name, productId: p.id, done: false })),
    display: { mapFull: true },
  };
}
