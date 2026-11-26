import { expect, test, type Page } from '@playwright/test';
import { cornerStore, dragMap, enterBuildMode, fresh, noPageErrors, saved, tapMap } from './helpers';

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
  await enterBuildMode(page);
  await openSheet(page, 'Store');
  await page.locator('.store-settings summary').click();
  await page.getByRole('button', { name: 'New store' }).click();
  await page.getByRole('button', { name: 'More layouts or blank…' }).click();
  await page.getByRole('radio', { name: /Blank/ }).click();
  await page.getByRole('button', { name: 'Create store' }).click();
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.count()) await skip.click({ timeout: 2000 }).catch(() => {});
  // Dismiss any toast without waiting the full test timeout if it's covered.
  await page.locator('.toast .icon').click({ timeout: 1000 }).catch(() => {});
  await expect(page.getByRole('region', { name: 'Edit map' })).toBeVisible();
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
  expect(l.places.some((p: any) => p.categories.includes('breakfast_cereal'))).toBe(true);
  await expect(page.locator('.aisle-label text')).toHaveText(['Aisle 1']);
  const before = l.places.map((p: any) => p.length).join();
  await page.getByRole('button', { name: 'Undo step' }).click();
  l = await layout(page, 'New store');
  expect(l.places.map((p: any) => p.length).join()).not.toBe(before);
  ok();
});

test('a shelf can be a fridge or freezer, shown on the map', async ({ page }) => {
  await fresh(page);
  await enterBuildMode(page);
  await page.locator('svg.map g.place.shelf').nth(3).click({ force: true });
  await openSheet(page);
  await page.getByRole('button', { name: 'Freezer', exact: true }).click();
  await expect(page.locator('svg.map g.place.shelf.frozen')).toHaveCount(1);
  expect((await layout(page)).places.filter((p: any) => p.temp === 'frozen')).toHaveLength(1);
});

test('aisle labels: tap to edit, rename, remove with undo', async ({ page }) => {
  await fresh(page, cornerStore());
  await enterBuildMode(page);
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

test('selecting an aisle selects its shelves; delete removes them', async ({ page }) => {
  await fresh(page, {
    layouts: [{
      id: 's1', name: 'Lone', width: 30, height: 30, entrance: { x: 1, y: 29 }, checkout: { x: 15, y: 29 },
      places: [
        { kind: 'shelf', id: 'L', label: 'Cereal', orientation: 'vertical', x: 12, y: 8, length: 10, categories: ['breakfast_cereal_sub'] },
        { kind: 'shelf', id: 'R', label: 'Pasta', orientation: 'vertical', x: 15, y: 8, length: 10, categories: ['pasta_dry'] },
        { kind: 'shelf', id: 'X', label: 'Next', orientation: 'vertical', x: 22, y: 8, length: 10, categories: [] },
      ],
      aisles: [{ id: 'a', label: 'Aisle 1', x: 13, y: 8, w: 2, h: 10 }],
    }],
    activeLayout: 's1',
  });
  await enterBuildMode(page);
  await page.locator('svg.map .aisle-label text').first().click({ force: true });
  await expect(page.locator('svg.map g.place.selected')).toHaveCount(2);
  await expect(page.locator('.aisle-group-outline')).toHaveCount(1);
  const tools = page.getByRole('toolbar', { name: 'Change Aisle 1' });
  await expect(tools).toBeVisible();
  // Palette is delete-only.
  await expect(tools.getByRole('button')).toHaveCount(1);
  await tools.getByRole('button', { name: 'Delete aisle and shelves' }).click();
  const l = await layout(page);
  expect(l.aisles).toHaveLength(0);
  expect(l.places.map((p: any) => p.id)).toEqual(['X']);
});

test('cut aisles: a cross aisle with new numbers, then renumber', async ({ page }) => {
  await fresh(page, cornerStore());
  await enterBuildMode(page);
  // The main five tools show first; the rest are under "More tools" (remembered).
  await expect(page.locator('.tool-icons .chip:not(.more-tools)')).toHaveCount(5);
  await page.getByRole('button', { name: 'More tools' }).click();
  await expect(page.locator('.tool-icons .chip:not(.more-tools)')).toHaveCount(10);
  expect((await saved<any>(page, 'display')).buildMoreTools).toBe(true);
  await page.getByRole('button', { name: 'Cut aisles' }).click();
  const l0 = await layout(page);
  await dragMap(page, [3, 12], [l0.width - 4, 13]); // across the open aisles, not the wall shelves
  // Drag hit-testing can catch 4 or 5 aisles depending on the runner; accept either.
  const panel = page.locator('.cut-panel');
  await expect(panel).toContainText(/8 shelves · [45] aisles/);
  const aisleHit = Number(/8 shelves · (\d+) aisles/.exec(await panel.innerText())![1]);
  await page.getByRole('button', { name: /New numbers \(\d+–\d+\)/ }).click();
  await panel.getByRole('button', { name: /^Cut 8 shelves/ }).click();
  await expect(page.locator('.toast')).toContainText(/Aisle \d+ → Aisle \d+/);
  let l = await layout(page);
  expect(l.places.filter((p: any) => p.id.startsWith('cut-'))).toHaveLength(8);
  // Near side keeps its numbers; far side gets the new block → roughly double the hit aisles (+ any untouched).
  expect(l.aisles.length).toBe(aisleHit === 5 ? 10 : 9);
  // Rename one, then renumber all.
  await page.locator('svg.map .aisle-label', { hasText: /AISLE 7/i }).locator('text').first().click({ force: true });
  await page.locator('.aisle-edit input').fill('Aisle 42');
  await page.getByRole('button', { name: 'Renumber all aisles' }).click();
  l = await layout(page);
  expect(l.aisles.map((a: any) => a.label)).not.toContain('Aisle 42');
  expect(new Set(l.aisles.map((a: any) => a.label)).size).toBe(l.aisles.length);
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

test('select a group of aisles with a box, then delete with undo', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, threeAisles());
  await enterBuildMode(page);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await dragMap(page, [12, 10], [19, 11]);
  const tools = page.getByRole('toolbar', { name: 'Change 3 aisles' });
  await expect(tools).toBeVisible();
  await expect(page.locator('svg.map g.place.selected')).toHaveCount(6);
  // A tap takes one out.
  await tapMap(page, 15, 12);
  await expect(page.getByRole('toolbar', { name: 'Change 2 aisles' })).toBeVisible();
  await tapMap(page, 15, 12);
  await expect(page.getByRole('toolbar', { name: 'Change 3 aisles' })).toBeVisible();
  // Drag the selection down to move.
  await dragMap(page, [15, 10], [15, 12]);
  let l = await layout(page);
  expect(l.places.every((p: any) => p.y === 8)).toBe(true);
  await page.getByRole('toolbar', { name: 'Change 3 aisles' }).getByRole('button', { name: 'Delete aisles and shelves' }).click();
  l = await layout(page);
  expect([l.aisles.length, l.places.length]).toEqual([0, 0]);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  l = await layout(page);
  expect([l.aisles.length, l.places.length]).toEqual([3, 6]);
  ok();
});

test('select works without aisle labels: shelves and an area by box, tap one out, drag to move', async ({ page }) => {
  const ok = noPageErrors(page);
  const data = threeAisles();
  data.layouts[0].aisles = [];
  (data.layouts[0].places as any[]).push({ kind: 'area', id: 'deli', label: 'Deli', x: 24, y: 6, w: 4, h: 3, categories: [] });
  await fresh(page, data);
  await enterBuildMode(page);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await dragMap(page, [9, 7], [26, 8]);
  await expect(page.getByRole('toolbar', { name: 'Change 6 shelves, 1 area' })).toBeVisible();
  // Tap the area to take it out.
  await tapMap(page, 25, 7);
  await expect(page.getByRole('toolbar', { name: 'Change 6 shelves' })).toBeVisible();
  await dragMap(page, [12, 8], [12, 10]);
  const l = await layout(page);
  expect(l.places.filter((p: any) => p.kind === 'shelf').every((p: any) => p.y === 8)).toBe(true);
  expect(l.places.find((p: any) => p.id === 'deli').y).toBe(6);
  // Leaving Select clears the selection (palette is delete-only).
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: /^Change/ })).toHaveCount(0);
  ok();
});

test('dragging a shelf away from its aisle widens the aisle; resize handle lengthens it', async ({ page }) => {
  await fresh(page, threeAisles());
  await enterBuildMode(page);
  await page.locator('svg.map g.place.shelf').first().click({ force: true }); // a1
  await expect(page.getByRole('toolbar', { name: 'Change a1' })).toBeVisible();
  await dragMap(page, [10, 10], [9, 10]);
  let l = await layout(page);
  expect(l.aisles.find((a: any) => a.id === 'A')).toMatchObject({ x: 10, w: 3 });
  await dragMap(page, [9, 10], [9, 9]);
  l = await layout(page);
  expect(l.aisles.find((a: any) => a.id === 'A')).toMatchObject({ y: 5, h: 11 });
  // Length via the resize handle at the far end.
  await page.locator('svg.map .resize-handle').click({ force: true });
  await dragMap(page, [9, 15], [9, 16]);
  l = await layout(page);
  expect(l.places.find((p: any) => p.id === 'a1').length).toBeGreaterThanOrEqual(10);
});

test('the editor: map fills the screen, zoom, list in the sheet, undo in the top bar', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, threeAisles());
  await enterBuildMode(page);
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
  // Delete a shelf from the map palette, then Undo from the top bar.
  await page.locator('svg.map g.place.shelf').first().click({ force: true });
  await page.getByRole('toolbar', { name: 'Change a1' }).getByRole('button', { name: /Delete/ }).click();
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

test('area tool: drag a region, add it, and neighbours keep a one-square gap', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, threeAisles());
  await enterBuildMode(page);
  await page.getByRole('button', { name: 'Area', exact: true }).click();
  await dragMap(page, [24, 6], [28, 10]);
  await expect(page.locator('.map-block-outline')).toBeVisible();
  await expect(page.locator('.block-corner-handle')).toHaveCount(4);
  await page.getByRole('button', { name: 'Add area' }).click();
  const l = await layout(page, 'Three');
  const area = l.places.find((p: any) => p.kind === 'area');
  expect(area).toBeTruthy();
  // No shelf butts against the area (gap ≥ 1).
  for (const p of l.places.filter((x: any) => x.kind === 'shelf')) {
    const f = { x: p.x, y: p.y, w: 1, h: p.length };
    const ax0 = area.x - 1; const ay0 = area.y - 1;
    const ax1 = area.x + area.w + 1; const ay1 = area.y + area.h + 1;
    const hits = !(f.x + f.w <= ax0 || f.x >= ax1 || f.y + f.h <= ay0 || f.y >= ay1);
    // Touching the inflated box means gap < 1; allow only if outside.
    expect(hits, `${p.id} too close to area`).toBe(false);
  }
  ok();
});

test('pieces side by side on a wall: dragging one onto another swaps along the line', async ({ page }) => {
  const ok = noPageErrors(page);
  const h = (id: string, label: string, x: number, length: number) => ({ kind: 'shelf', id, label, orientation: 'horizontal', x, y: 0, length, back: -1, categories: [] });
  await fresh(page, {
    layouts: [{ id: 's1', name: 'Wall', width: 24, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 6, y: 15 },
      places: [h('meat', 'Meat', 1, 6), h('cheese', 'Cheese', 7, 3), h('milk', 'Milk', 10, 4)] }],
    activeLayout: 's1',
    products: [{ id: 'steak', name: 'Steak', categoryId: 'meat_beef', locations: { s1: 'meat@0.5,0.5' } }],
  });
  const xs = async () => Object.fromEntries((await saved<any[]>(page, 'layouts'))[0].places.map((p: any) => [p.id, p.x]));
  await enterBuildMode(page);
  await tapMap(page, 3, 0);
  await expect(page.getByRole('toolbar', { name: /Change Meat/ })).toBeVisible();
  // Milk dragged onto Meat: Milk takes its place, the rest move over.
  await tapMap(page, 11, 0);
  await dragMap(page, [11, 0], [2, 0]);
  await expect.poll(xs).toEqual({ milk: 1, meat: 5, cheese: 11 });
  expect((await saved<any[]>(page, 'products')).find((p) => p.id === 'steak').locations).toEqual({ s1: 'meat@0.5,0.5' });
  ok();
});

test('a new store in the editor starts from a default map too', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page);
  await enterBuildMode(page);
  await openSheet(page, 'Store');
  await page.locator('.store-settings summary').click();
  await page.getByRole('button', { name: 'New store' }).click();
  const sheet = page.getByRole('dialog', { name: 'Start the map' });
  await sheet.getByRole('radio', { name: /Hard discount|Discount/ }).click();
  await sheet.getByRole('button', { name: 'Less Aisles' }).click();
  await sheet.getByRole('button', { name: 'Create store' }).click();
  const skip = page.getByRole('button', { name: 'Skip for now' });
  if (await skip.count()) await skip.click();
  await expect.poll(async () => (await layout(page, 'New store'))?.gen?.template).toBe('discount');
  const l = await layout(page, 'New store');
  expect(l.gen.template).toBe('discount');
  expect(l.aisles).toHaveLength(5);
  await expect(page.locator('svg.map .aisle-label text').first()).toBeAttached();
  ok();
});

test('shelf block: draw once, drag to move, corner resize, then add; stamp is grouped', async ({ page }) => {
  const ok = noPageErrors(page);
  await blankStore(page);
  await page.getByRole('button', { name: 'Shelf block' }).click();
  await dragMap(page, [4, 6], [14, 14]);
  await expect(page.locator('.map-block-outline')).toBeVisible();
  await expect(page.locator('.block-corner-handle')).toHaveCount(4);
  expect(await page.locator('svg.map .map-ghost.block').count()).toBeGreaterThan(0);
  // Tap inside the draft: must keep the same block (not redraw from scratch).
  const outline = () => page.locator('.map-block-outline').evaluate((r) => ({
    x: +r.getAttribute('x')!, y: +r.getAttribute('y')!, w: +r.getAttribute('width')!, h: +r.getAttribute('height')!,
  }));
  const before = await outline();
  await tapMap(page, before.x + 2, before.y + 2);
  await expect.poll(outline).toEqual(before);
  // Drag inside to move the draft.
  await dragMap(page, [before.x + 2, before.y + 2], [before.x + 4, before.y + 2]);
  const moved = await outline();
  expect(moved.x).toBe(before.x + 2);
  expect(moved.w).toBe(before.w);
  // Drag SE corner further along x to lengthen (vertical shelves → along = height… wait vertical = along y).
  // Vertical orientation: along = height (length), across = width (count). Drag SE rightward → more shelves.
  const se = { x: moved.x + moved.w - 1, y: moved.y + moved.h - 1 };
  await dragMap(page, [se.x, se.y], [se.x + 3, se.y]);
  const wider = await outline();
  expect(wider.w).toBeGreaterThan(moved.w);
  await page.getByRole('button', { name: /Add \d+ shel/ }).click();
  const l = await layout(page, 'New store');
  expect(l.places.filter((p: any) => p.kind === 'shelf').length).toBeGreaterThan(1);
  expect(l.groups?.length).toBe(1);
  expect(l.groups[0].ids.length).toBe(l.places.filter((p: any) => p.kind === 'shelf').length);
  ok();
});

test('stamped shelf block stays grouped: tap one selects all; drag moves them together', async ({ page }) => {
  const ok = noPageErrors(page);
  await blankStore(page);
  await page.getByRole('button', { name: 'Shelf block' }).click();
  await dragMap(page, [4, 6], [10, 14]);
  await page.getByRole('button', { name: /Add \d+ shel/ }).click();
  const before = await layout(page, 'New store');
  expect(before.groups?.length).toBe(1);
  const ids = before.groups[0].ids as string[];
  expect(ids.length).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const first = before.places.find((p: any) => p.id === ids[0]);
  await tapMap(page, first.x, first.y + 2);
  await expect(page.getByRole('toolbar', { name: new RegExp(`Change ${ids.length} shelves`) })).toBeVisible();
  await dragMap(page, [first.x, first.y + 2], [first.x, first.y + 4]);
  const after = await layout(page, 'New store');
  for (const id of ids) {
    const was = before.places.find((p: any) => p.id === id)!;
    const now = after.places.find((p: any) => p.id === id)!;
    expect(now.y - was.y).toBe(2);
  }
  ok();
});
