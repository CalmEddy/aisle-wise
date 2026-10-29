import { expect, test } from '@playwright/test';
import { fresh, saved } from './helpers';

test('several lists: make, switch, combine into one (with undo), rename, delete', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await fresh(page, { items: [{ id: 'a', name: 'Apples', done: false }] });
  const names = async () => (await page.locator('main .name').allInnerTexts()).map((t) => t.split('\n')[0].trim()).sort();
  const addTo = async (...ns: string[]) => {
    for (const n of ns) {
      await page.getByRole('button', { name: 'Add items' }).first().click();
      await page.getByLabel('Item to add').fill(n);
      await page.getByLabel('Item to add').press('Enter');
      await page.locator('.add-sheet').getByRole('button', { name: 'Done' }).click();
    }
  };
  const newList = async (n: string) => {
    await page.locator('.list-bar').click();
    await page.getByLabel('New list name').fill(n);
    await page.getByRole('button', { name: '+ New' }).click();
  };
  await expect(page.locator('.list-bar-name')).toHaveText('Shopping list');
  await newList('Weekly staples');
  await addTo('Milk', 'Eggs');
  await newList('Taco night');
  await addTo('Tortillas', 'Eggs');
  expect(await names()).toEqual(['Eggs', 'Tortillas']);

  await page.locator('.list-bar').click();
  await page.locator('.list-pick', { hasText: 'Shopping list' }).click();
  expect(await names()).toEqual(['Apples']);
  await page.locator('.list-bar').click();
  await page.locator('.lists-sheet .check', { hasText: 'Weekly staples' }).locator('input').check();
  await page.locator('.lists-sheet .check', { hasText: 'Taco night' }).locator('input').check();
  await page.locator('.combine .btn.primary').click();
  expect(await names()).toEqual(['Apples', 'Eggs', 'Milk', 'Tortillas']);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  expect(await names()).toEqual(['Apples']);

  await page.locator('.list-bar').click();
  await page.getByRole('button', { name: 'Rename Taco night' }).click();
  await page.getByLabel('List name', { exact: true }).fill('Taco Tuesday');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Delete Weekly staples' }).click();
  await expect(page.locator('.lists-sheet .list-pick .name')).toHaveText(['Shopping list', 'Taco Tuesday']);
  await expect(page.getByRole('button', { name: 'Delete Shopping list' })).toHaveCount(0);
  const lists = await saved<{ name: string }[]>(page, 'lists');
  expect(lists.map((l) => l.name)).toContain('Taco Tuesday');
});

test('things with no place and things not sold here can be removed from the list', async ({ page }) => {
  await fresh(page, { display: { noAskStores: ['demo'] } });
  await page.getByRole('button', { name: 'Add items' }).first().click();
  await page.getByLabel('Item to add').fill('Zorblax, Quuxberries, Apples');
  await page.getByLabel('Item to add').press('Enter');
  await page.locator('.add-sheet').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.off-route .name')).toHaveText(['Zorblax', 'Quuxberries']);
  await page.getByRole('button', { name: 'Remove Zorblax' }).click();
  await expect(page.locator('.off-route .name')).toHaveText(['Quuxberries']);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await page.locator('.off-route .off-head', { hasText: 'No location yet' }).getByRole('button', { name: 'Remove all' }).click();
  await expect(page.locator('.off-route')).toHaveCount(0);
});
