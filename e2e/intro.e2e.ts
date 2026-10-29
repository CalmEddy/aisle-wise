import { expect, test } from '@playwright/test';

test('first visit: a short intro, straight into picking a store; not shown again', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const intro = page.getByRole('dialog', { name: 'How Aisle Wise works' });
  await expect(intro).toContainText('Add what you need');
  await expect(intro).toContainText('Pick your store');
  await intro.getByRole('button', { name: 'I’m at a store now' }).click();
  await expect(page.locator('.store-sheet')).toBeVisible();
  await page.locator('.store-sheet').getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(intro).toHaveCount(0);
  // ⓘ shows it again.
  await page.getByRole('button', { name: 'How this works' }).click();
  await expect(intro).toBeVisible();
  await intro.getByRole('button', { name: 'Start my list' }).click();
  await expect(intro).toHaveCount(0);
});

test('people who already use the app don’t get the intro', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('aw.items', JSON.stringify([{ id: 'a', name: 'Milk', done: false }])); });
  await page.reload();
  await expect(page.locator('main .name').first()).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'How Aisle Wise works' })).toHaveCount(0);
});
