import { expect, test, type Page } from '@playwright/test';
import { cornerStore, dragMap, fresh, noPageErrors, saved, tapMap } from './helpers';

const layout = async (page: Page, name?: string) => {
  const all = await saved<any[]>(page, 'layouts');
  return name ? all.find((l) => l.name.startsWith(name)) : all[0];
};

async function blankStore(page: Page) {
  await fresh(page);
  await page.getByRole('button', { name: 'Build mode' }).click();
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
  await page.getByRole('button', { name: '❄ Freezer' }).click();
  await expect(page.locator('svg.map g.place.shelf.frozen')).toHaveCount(1);
  expect((await layout(page)).places.filter((p: any) => p.temp === 'frozen')).toHaveLength(1);
});

test('aisle labels: tap to edit, rename, remove with undo', async ({ page }) => {
  await fresh(page, cornerStore());
  await page.getByRole('button', { name: 'Build mode' }).click();
  await page.locator('svg.map .aisle-label', { hasText: /AISLE 3/i }).locator('text').first().click({ force: true });
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
  await page.getByRole('button', { name: 'Move aisle up' }).click();
  let l = await layout(page);
  expect(l.places.map((p: any) => [p.id, p.y])).toEqual([['L', 7], ['R', 7], ['X', 8]]);
  await page.getByRole('button', { name: /Side to side/ }).click();
  l = await layout(page);
  expect(l.aisles[0]).toMatchObject({ w: 10, h: 2 });
  expect(l.places.filter((p: any) => p.id !== 'X').every((p: any) => p.orientation === 'horizontal')).toBe(true);
  // Moving right runs into the shelf "Next": refused.
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Move aisle right' }).click();
  await expect(page.locator('.toast')).toContainText('Can’t move it that way');
});

test('cut aisles: a cross aisle with new numbers, then renumber', async ({ page }) => {
  await fresh(page, cornerStore());
  await page.getByRole('button', { name: 'Build mode' }).click();
  // The main four tools show first; the rest are under "More tools" (remembered).
  await expect(page.locator('.tool-icons .chip:not(.more-tools)')).toHaveCount(4);
  await page.getByRole('button', { name: 'More tools' }).click();
  await expect(page.locator('.tool-icons .chip:not(.more-tools)')).toHaveCount(9);
  expect((await saved<any>(page, 'display')).buildMoreTools).toBe(true);
  await page.getByRole('button', { name: 'Cut aisles' }).click();
  const l0 = await layout(page);
  await dragMap(page, [5, 12], [l0.width - 7, 13]);
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
