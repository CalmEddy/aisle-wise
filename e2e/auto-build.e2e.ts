import { expect, test } from '@playwright/test';
import { addItems, fresh, newStore, saved, tick } from './helpers';

// Blank store: category areas appear from check-off order (serpentine auto-build).
test('blank store builds category areas as items are checked off', async ({ page }) => {
  await fresh(page);
  await newStore(page, 'Order Market', { autoBuild: true });

  const store = async () => (await saved<any[]>(page, 'layouts')).find((l) => l.name === 'Order Market');
  await expect.poll(async () => (await store())?.auto?.enabled).toBe(true);
  expect((await store())?.places ?? []).toHaveLength(0);

  await addItems(page, 'apples, milk, pasta');
  await tick(page, 'Apples');
  await expect.poll(async () => (await store())?.places?.length).toBe(1);
  await expect.poll(async () => (await store())?.places?.[0]?.categories).toEqual(['produce']);

  await tick(page, 'Milk');
  await expect.poll(async () => (await store())?.places?.length).toBe(2);
  await expect.poll(async () => (await store())?.places?.map((p: any) => p.categories[0])).toEqual(['produce', 'dairy_eggs']);

  await tick(page, 'Pasta');
  await expect.poll(async () => (await store())?.places?.map((p: any) => p.categories[0]))
    .toEqual(['produce', 'dairy_eggs', 'pasta_rice_grains']);

  const layout = await store();
  expect(layout.entrance.x).toBeGreaterThan(layout.checkout.x);
  // First category area sits toward the lower right (entrance side).
  const produce = layout.places.find((p: any) => p.categories[0] === 'produce');
  const pasta = layout.places.find((p: any) => p.categories[0] === 'pasta_rice_grains');
  expect(produce.x).toBeGreaterThanOrEqual(pasta.x);

  // Products got auto locations on those areas.
  const products = await saved<any[]>(page, 'products');
  const milk = products.find((p: any) => p.name === 'Milk');
  expect(milk.locations[layout.id]).toMatch(/^ab-dairy_eggs/);

  // Map shows the three areas once opened.
  await page.getByRole('button', { name: 'List options' }).click();
  const showMap = page.getByRole('button', { name: 'Whole map' });
  if (await showMap.count()) await showMap.click();
  await page.getByRole('button', { name: 'List options' }).click();
  await expect(page.locator('svg.map .place')).toHaveCount(3);
});
