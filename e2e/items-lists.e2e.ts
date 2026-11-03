import { expect, test } from '@playwright/test';
import { fresh, noPageErrors, saved } from './helpers';

test('Items tab: list bar, create list, named add toast, sort and group toggles', async ({ page }) => {
  const ok = noPageErrors(page);
  await fresh(page, {
    items: [{ id: 'a', name: 'Apples', done: false }],
  });

  await page.getByRole('tab', { name: 'Items' }).click();
  await expect(page.locator('.list-bar-name')).toHaveText('Shopping list');
  await expect(page.locator('.also-list')).toContainText('Add to “Shopping list”');

  // Create a list from Items without leaving the catalog.
  await page.locator('.list-bar').click();
  await page.getByLabel('New list name').fill('Party');
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByRole('button', { name: 'Shop this list' }).click();
  await expect(page.locator('.list-bar-name')).toHaveText('Party');
  await expect(page.locator('.also-list')).toContainText('Add to “Party”');
  await expect(page.getByRole('button', { name: 'Grocery items' })).toHaveClass(/active/);

  // Search and add Milk onto the active list; toast names the list.
  await page.getByPlaceholder(/Search or add/).fill('Milk');
  await page.getByRole('button', { name: 'Add Milk to “Party”' }).click();
  await expect(page.locator('.toast')).toContainText('Added Milk to “Party”');

  const lists = await saved<{ id: string; name: string }[]>(page, 'lists');
  const party = lists.find((l) => l.name === 'Party');
  expect(party).toBeTruthy();
  const items = await saved<{ name: string; listId?: string }[]>(page, 'items');
  expect(items.some((i) => i.name === 'Milk' && i.listId === party!.id)).toBe(true);

  // Sort cycle: category → A–Z.
  const sort = page.getByRole('button', { name: /Sort by category/ });
  await expect(sort).toBeVisible();
  await sort.click();
  await expect(page.getByRole('button', { name: /Sort alphabetically/ })).toBeVisible();

  // Group toggle: off → flat list (no category group heads).
  const group = page.getByRole('button', { name: 'Group by category' });
  await expect(group).toHaveAttribute('aria-pressed', 'true');
  await group.click();
  await expect(group).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.group-head')).toHaveCount(0);

  const display = await saved<{ itemsSort?: string; itemsGroupByCategory?: boolean }>(page, 'display');
  expect(display.itemsSort).toBe('alpha');
  expect(display.itemsGroupByCategory).toBe(false);
  ok();
});
