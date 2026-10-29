import { expect, type Page } from '@playwright/test';

/** Starts from a clean phone: nothing saved, the Shop tab, plus anything in `data` (localStorage keys without "aw."). */
export async function fresh(page: Page, data: Record<string, unknown> = {}) {
  await page.goto('/');
  await page.evaluate((d) => {
    localStorage.clear();
    localStorage.setItem('aw.view', JSON.stringify('list'));
    for (const [k, v] of Object.entries(d)) localStorage.setItem(`aw.${k}`, JSON.stringify(v));
  }, data);
  await page.reload();
}

/** What the app has saved under a key (without "aw."). */
export function saved<T = any>(page: Page, key: string): Promise<T> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(`aw.${k}`) ?? 'null'), key);
}

/** Adds items through the add window ("Milk, 2 eggs"). */
export async function addItems(page: Page, text: string) {
  await page.getByRole('button', { name: 'Add items' }).first().click();
  await page.getByLabel('Item to add').fill(text);
  await page.getByLabel('Item to add').press('Enter');
  await page.locator('.add-sheet').getByRole('button', { name: 'Done' }).click();
}

/** A list row by item name. */
export const row = (page: Page, name: string) => page.locator('main .row', { hasText: name }).first();

/** Checks an item off by tapping its name. */
export async function tick(page: Page, name: string) {
  await row(page, name).locator('.name').click();
}

/** Starts a new, empty store right here. */
export async function newStore(page: Page, name: string) {
  await page.getByRole('button', { name: /Change store/ }).click();
  await page.getByLabel('New store name').fill(name);
  await page.getByRole('button', { name: '＋ Here' }).click();
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

/** A store built only from "Where was it?" answers: the example corner store (entrance front right). */
export function cornerStore() {
  const c = (name: string, categoryId: string | undefined, clue: object) => ({ id: name, name, ...(categoryId && { categoryId }), clues: { s1: clue } });
  const products = [
    c('Apples', 'fruit', { kind: 'wall', wall: 'right', part: 'front' }),
    c('Bread', 'bakery', { kind: 'wall', wall: 'right', part: 'back' }),
    c('Steak', 'meat', { kind: 'wall', wall: 'back', part: 'left' }),
    c('Juice', 'water', { kind: 'wall', wall: 'back', part: 'right', temp: 'chilled' }),
    c('Hummus', undefined, { kind: 'wall', wall: 'left', part: 'back', temp: 'chilled' }),
    c('Pizza', 'frozen', { kind: 'wall', wall: 'left', part: 'front', temp: 'frozen' }),
    c('Melon', 'fruit', { kind: 'open', near: 'entrance', fixture: 'table' }),
    c('Ice cream', 'icecream', { kind: 'open', near: 'middle', fixture: 'case', temp: 'frozen' }),
    c('Cereal', 'breakfast', { kind: 'aisle', aisle: '5' }),
    c('Pasta', 'pasta', { kind: 'aisle', aisle: '3', side: 'R' }),
  ];
  return {
    products,
    layouts: [{ id: 's1', name: 'Corner Market', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 }, gen: { enabled: true, entrance: 'right', locked: [] } }],
    activeLayout: 's1',
    items: products.map((p, i) => ({ id: `i${i}`, name: p.name, productId: p.id, done: false })),
    display: { mapFull: true },
  };
}
