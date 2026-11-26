import { expect, test } from '@playwright/test';

test('first visit: a short intro, straight into picking a store; not shown again', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const intro = page.getByRole('dialog', { name: 'How Aisle Wise works' });
  await expect(intro).toContainText('Add what you need');
  await expect(intro).toContainText('Add your store');
  await intro.getByRole('button', { name: 'I’m at a store now' }).click();
  await expect(page.locator('.store-sheet')).toBeVisible();
  await page.locator('.store-sheet').getByRole('button', { name: 'Close' }).click();
  await page.reload();
  await expect(intro).toHaveCount(0);
  // "How this works" lives in the ⋯ More menu on Lists / Items / Stores (and in List options on Shop).
  await page.getByRole('tab', { name: 'Lists', exact: true }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
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

test('four bottom tabs reach every screen in one tap', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('aw.welcomed', '1'); });
  await page.reload();
  const tabs = page.getByRole('tablist', { name: 'Main' });
  await expect(tabs.getByRole('tab')).toHaveText(['Shop', 'Lists', 'Items', 'Stores']);
  await expect(tabs.getByRole('tab', { name: 'Shop' })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['Lists', 'Items', 'Shop']) {
    await tabs.getByRole('tab', { name }).click();
    await expect(tabs.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
  }
  // Setup is gone.
  await expect(page.getByRole('tab', { name: 'Setup' })).toHaveCount(0);
  // The bar stays at the bottom edge and is at least 56px tall.
  const box = (await tabs.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(Math.round(box.y + box.height)).toBe(vh);
  expect(box.height).toBeGreaterThanOrEqual(56);
});
