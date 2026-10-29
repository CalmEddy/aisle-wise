import { expect, test } from '@playwright/test';
import { cornerStore, fresh, noPageErrors, saved } from './helpers';

test('a store map built only from answers: wall shelves, fridges, freezers and tables in the open', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, cornerStore());
  await expect(page.locator('svg.map')).toBeVisible();
  const l = (await saved<any[]>(page, 'layouts'))[0];
  const byId = (id: string) => l.places.find((p: any) => p.id === id);
  // Right wall (entrance side): Produce at the front, Bakery behind it, both wall shelves.
  expect(byId('g-dept-produce')).toMatchObject({ kind: 'shelf', back: 1 });
  expect(byId('g-dept-bakery').y).toBeLessThan(byId('g-dept-produce').y);
  // Back wall: Meat then Refrigerated; left wall: Refrigerated then Freezer.
  expect(byId('g-dept-meat').x).toBeLessThan(byId('g-wall-back-chilled').x);
  expect(byId('g-wall-left-chilled').y).toBeLessThan(byId('g-wall-left-frozen').y);
  // Out in the open.
  expect(byId('g-open-entrance-table-room').label).toBe('Produce table');
  expect(byId('g-open-middle-case-frozen')).toMatchObject({ label: 'Freezer case', temp: 'frozen' });
  // Aisles 1–5, guesses dashed.
  await expect(page.locator('.aisle-label text')).toHaveCount(5);
  await expect(page.locator('svg.map .place.frozen')).not.toHaveCount(0);
  // The list follows the map.
  await expect(page.locator('main .route-list .row').first()).toBeVisible();
  ok();
});
