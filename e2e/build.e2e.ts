import { expect, test, type Page } from '@playwright/test';
import { cornerStore, dragMap, fresh, noPageErrors, saved, tapMap } from './helpers';

const layout = async (page: Page, name?: string) => {
  const all = await saved<any[]>(page, 'layouts');
  return name ? all.find((l) => l.name.startsWith(name)) : all[0];
};

/** Opens the editor's bottom sheet on a tab ('Store', 'List'), or on the current tool/selection. */
async function openSheet(page: Page, tab?: string) {
  if (tab) await page.locator('.build-sheet').getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
  else await page.locator('.build-sheet-peek').click();
}

async function blankStore(page: Page) {
  await fresh(page);
  await page.getByRole('button', { name: 'Build mode' }).click();
  await openSheet(page, 'Store');
  await page.locator('.store-settings summary').click();
  await page.getByRole('button', { name: 'New store' }).click();
  await page.locator('.toast .icon').click().catch(() => {});
}

test('aisle brush: paints both sides with categories and an aisle label, and backs up', async ({ page }) => {
  const ok = noPageErrors(page);
  await blankStore(page);
  await tapMap(page, 5, 20);
  await page.getByRole('button', { name: 'Aisle brush' }).click();
  const left = page.getByRole('combobox', { name: 'Category the left side stocks' });
  await left.click(); await left.fill('cere'); await left.press('Enter');
  await page.getByRole('button', { name: 'Aisle 1' }).click();
  const up = page.getByRole('button', { name: 'Paint and step 4 up' });
  await up.click(); await up.click(); await up.click();
  let l = await layout(page, 'New store');
  expect(l.places.length).toBeGreaterThanOrEqual(2);
  expect(l.places.some((p: any) => p.categories.includes('breakfast'))).toBe(true);
  await expect(page.locator('.aisle-label text')).toHaveText(['Aisle 1']);
  const before = l.places.map((p: any) => p.length).join();
  await page.getByRole('button', { name: '↶ Back up' }).click();
  l = await layout(page, 'New store');
  expect(l.places.map((p: any) => p.length).join()).not.toBe(before);
  ok();
});

test('a shelf can be a fridge or freezer, shown on the map', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: 'Build mode' }).click();
  await page.locator('svg.map g.place.shelf').nth(3).click({ force: true });
  await openSheet(page);
  await page.getByRole('button', { name: '❄ Freezer' }).click();
  await expect(page.locator('svg.map g.place.shelf.frozen')).toHaveCount(1);
  expect((await layout(page)).places.filter((p: any) => p.temp === 'frozen')).toHaveLength(1);
});

test('aisle labels: tap to edit, rename, remove with undo', async ({ page }) => {
  await fresh(page, cornerStore());
  await page.getByRole('button', { name: 'Build mode' }).click();
  await page.locator('svg.map .aisle-label', { hasText: /AISLE 3/i }).locator('text').first().click({ force: true });
  await openSheet(page);
  await expect(page.locator('.aisle-edit h3')).toHaveText('Aisle label');
  await page.locator('.aisle-edit input').fill('Breakfast aisle');
  await expect(page.locator('.aisle-label text', { hasText: 'Breakfast aisle' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove label' }).click();
  await expect(page.locator('.aisle-label text', { hasText: 'Breakfast aisle' })).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.aisle-label text', { hasText: 'Breakfast aisle' })).toHaveCount(1);
});

test('selecting an aisle selects its shelves; it moves as one, and turns when there is room', async ({ page }) => {
  await fresh(page, {
    layouts: [{
      id: 's1', name: 'Lone', width: 30, height: 30, entrance: { x: 1, y: 29 }, checkout: { x: 15, y: 29 },
      places: [
        { kind: 'shelf', id: 'L', label: 'Cereal', orientation: 'vertical', x: 12, y: 8, length: 10, categories: ['breakfast'] },
        { kind: 'shelf', id: 'R', label: 'Pasta', orientation: 'vertical', x: 15, y: 8, length: 10, categories: ['pasta'] },
        { kind: 'shelf', id: 'X', label: 'Next', orientation: 'vertical', x: 22, y: 8, length: 10, categories: [] },
      ],
      aisles: [{ id: 'a', label: 'Aisle 1', x: 13, y: 8, w: 2, h: 10 }],
    }],
    activeLayout: 's1',
  });
  await page.getByRole('button', { name: 'Build mode' }).click();
  await page.locator('svg.map .aisle-label text').first().click({ force: true });
  await expect(page.locator('svg.map g.place.selected')).toHaveCount(2);
  await expect(page.locator('.aisle-group-outline')).toHaveCount(1);
  await page.getByRole('toolbar', { name: 'Change Aisle 1' }).getByRole('button', { name: 'Move aisle up' }).click();
  let l = await layout(page);
  expect(l.places.map((p: any) => [p.id, p.y])).toEqual([['L', 7], ['R', 7], ['X', 8]]);
  // The controls sit on the map, next to the aisle.
  const tools = page.getByRole('toolbar', { name: 'Change Aisle 1' });
  await expect(tools).toBeVisible();
  await tools.getByRole('button', { name: 'Turn side to side' }).click();
  l = await layout(page);
  expect(l.aisles[0]).toMatchObject({ w: 10, h: 2 });
  expect(l.places.filter((p: any) => p.id !== 'X').every((p: any) => p.orientation === 'horizontal')).toBe(true);
  // Moving right runs into the shelf "Next": refused.
  for (let i = 0; i < 6; i++) await tools.getByRole('button', { name: 'Move aisle right' }).click();
  await expect(page.locator('.toast')).toContainText('Can’t move it that way');
});

test('cut aisles: a cross aisle with new numbers, then renumber', async ({ page }) => {
  await fresh(page, cornerStore());
  await page.getByRole('button', { name: 'Build mode' }).click();
  // The main five tools show first; the rest are under "More tools" (remembered).
  await expect(page.locator('.tool-icons .chip:not(.more-tools)')).toHaveCount(5);
  await page.getByRole('button', { name: 'More tools' }).click();
  await expect(page.locator('.tool-icons .chip:not(.more-tools)')).toHaveCount(10);
  expect((await saved<any>(page, 'display')).buildMoreTools).toBe(true);
  await page.getByRole('button', { name: 'Cut aisles' }).click();
  const l0 = await layout(page);
  await dragMap(page, [3, 12], [l0.width - 4, 13]); // across aisles 1–5, not the wall shelves
  await expect(page.locator('.cut-panel')).toContainText('10 shelves · 5 aisles');
  await page.getByRole('button', { name: /^New numbers \(6–10\)/ }).click();
  await page.locator('.cut-panel').getByRole('button', { name: /^Cut 10 shelves/ }).click();
  await expect(page.locator('.toast')).toContainText('Aisle 1 → Aisle 6');
  let l = await layout(page);
  expect(l.aisles.map((a: any) => a.label).sort()).toEqual(['Aisle 1', 'Aisle 10', 'Aisle 2', 'Aisle 3', 'Aisle 4', 'Aisle 5', 'Aisle 6', 'Aisle 7', 'Aisle 8', 'Aisle 9']);
  expect(l.places.filter((p: any) => p.id.startsWith('cut-'))).toHaveLength(5 * 2);
  // Rename one, then renumber all.
  await page.locator('svg.map .aisle-label', { hasText: /AISLE 7/i }).locator('text').first().click({ force: true });
  await page.locator('.aisle-edit input').fill('Aisle 42');
  await page.getByRole('button', { name: 'Renumber all aisles' }).click();
  l = await layout(page);
  expect(l.aisles.map((a: any) => a.label)).not.toContain('Aisle 42');
  expect(new Set(l.aisles.map((a: any) => a.label)).size).toBe(10);
});

/** Three aisles side by side (shelves back to back between them), with room around. */
const threeAisles = () => {
  const sh = (id: string, x: number) => ({ kind: 'shelf', id, label: id, orientation: 'vertical', x, y: 6, length: 10, categories: [] });
  return {
    layouts: [{
      id: 's1', name: 'Three', width: 34, height: 34, entrance: { x: 1, y: 33 }, checkout: { x: 15, y: 33 },
      places: [sh('a1', 10), sh('a2', 13), sh('b1', 14), sh('b2', 17), sh('c1', 18), sh('c2', 21)],
      aisles: [
        { id: 'A', label: 'Aisle 1', x: 11, y: 6, w: 2, h: 10 },
        { id: 'B', label: 'Aisle 2', x: 15, y: 6, w: 2, h: 10 },
        { id: 'C', label: 'Aisle 3', x: 19, y: 6, w: 2, h: 10 },
      ],
    }],
    activeLayout: 's1',
  };
};

test('select a group of aisles with a box, turn it as one block, then delete it with undo', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, threeAisles());
  await page.getByRole('button', { name: 'Build mode' }).click();
  await page.getByRole('button', { name: 'Select aisles' }).click();
  await dragMap(page, [12, 10], [19, 11]);
  const tools = page.getByRole('toolbar', { name: 'Change 3 aisles' });
  await expect(tools).toBeVisible();
  await expect(page.locator('svg.map g.place.selected')).toHaveCount(6);
  // A tap takes one out.
  await tapMap(page, 15, 12);
  await expect(page.getByRole('toolbar', { name: 'Change 2 aisles' })).toBeVisible();
  await tapMap(page, 15, 12);
  await tools.getByRole('button', { name: 'Turn side to side' }).click();
  let l = await layout(page);
  expect(l.aisles.every((a: any) => a.w === 10 && a.h === 2)).toBe(true);
  expect(l.places.every((p: any) => p.orientation === 'horizontal')).toBe(true);
  // Nothing overlaps.
  const rects = [...l.aisles, ...l.places.map((p: any) => ({ x: p.x, y: p.y, w: p.length, h: 1 }))];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i]; const b = rects[j];
    expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
  }
  await page.getByRole('toolbar', { name: 'Change 3 aisles' }).getByRole('button', { name: 'Delete aisles and shelves' }).click();
  l = await layout(page);
  expect([l.aisles.length, l.places.length]).toEqual([0, 0]);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  l = await layout(page);
  expect([l.aisles.length, l.places.length]).toEqual([3, 6]);
  ok();
});

test('bumping a shelf away from its aisle widens the aisle; it won’t go onto the next one', async ({ page }) => {
  await fresh(page, threeAisles());
  await page.getByRole('button', { name: 'Build mode' }).click();
  await page.locator('svg.map g.place.shelf').first().click({ force: true }); // a1, the left side of Aisle 1
  const tools = page.getByRole('toolbar', { name: 'Change a1' });
  await tools.getByRole('button', { name: 'Move shelf left' }).click();
  let l = await layout(page);
  expect(l.aisles.find((a: any) => a.id === 'A')).toMatchObject({ x: 10, w: 3 });
  // Offset it along the aisle: the aisle still runs the length of both sides.
  await tools.getByRole('button', { name: 'Move shelf up' }).click();
  l = await layout(page);
  expect(l.aisles.find((a: any) => a.id === 'A')).toMatchObject({ y: 5, h: 11 });
  // No "next shelf" suggestion is offered inside the widened walkway.
  const ghosts = await page.locator('.map-ghost.next rect:not(.hit)').evaluateAll((rs) => rs.map((r) => ({ x: +r.getAttribute('x')!, w: +r.getAttribute('width')! })));
  expect(ghosts.filter((g) => g.x < 13 && g.x + g.w > 10)).toEqual([]); // Aisle 1's walkway is x 10–12
  // a2 is back to back with b1: it can't move right onto it.
  await page.locator('svg.map g.place.shelf[data-drop="a2"]').click({ force: true });
  await page.getByRole('toolbar', { name: 'Change a2' }).getByRole('button', { name: 'Move shelf right' }).click();
  await expect(page.locator('.toast')).toContainText('Can’t move it that way');
  // Length on the map too.
  await page.getByRole('toolbar', { name: 'Change a2' }).getByRole('button', { name: 'Longer' }).click();
  l = await layout(page);
  expect(l.places.find((p: any) => p.id === 'a2').length).toBe(11);
});

test('the editor: map fills the screen, zoom, list in the sheet, undo in the top bar', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, threeAisles());
  await page.getByRole('button', { name: 'Build mode' }).click();
  // Map first: most of the screen, no page scrolling.
  const mapH = await page.locator('.build-map').evaluate((e) => e.getBoundingClientRect().height);
  expect(mapH / 760).toBeGreaterThan(0.6);
  expect(await page.evaluate(() => document.querySelector('.build-screen')!.scrollHeight <= window.innerHeight)).toBe(true);
  // Zoom in and out.
  const vb = () => page.locator('svg.map').getAttribute('viewBox');
  const whole = await vb();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(await vb()).not.toBe(whole);
  await page.getByRole('button', { name: 'Show the whole store' }).click();
  expect(await vb()).toBe(whole);
  // Move a shelf with the map bar, then Undo from the top bar.
  await page.locator('svg.map g.place.shelf').first().click({ force: true });
  await page.getByRole('toolbar', { name: 'Change a1' }).getByRole('button', { name: 'Delete shelf' }).click();
  expect((await layout(page)).places).toHaveLength(5);
  await page.locator('.build-top').getByRole('button', { name: 'Undo' }).click();
  expect((await layout(page)).places).toHaveLength(6);
  // The list is a tab of the sheet.
  await page.locator('.build-sheet').getByRole('tab', { name: /^List/ }).click();
  await expect(page.locator('.build-sheet-body main')).toBeVisible();
  // Done leaves the editor.
  await page.locator('.build-top').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.build-screen')).toHaveCount(0);
  ok();
});
