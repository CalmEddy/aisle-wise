import { test } from '@playwright/test';
import { addItems, fresh, newStore, tick } from './helpers';
test('shot', async ({ page }) => {
  const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message));
  await fresh(page);
  await newStore(page, 'Corner');
  await addItems(page, 'Apples, Bread, Cereal, Milk');
  await tick(page, 'Apples'); await page.locator('.where-bar').getByRole('button', { name: 'Right wall →' }).click();
  await tick(page, 'Cereal');
  await page.locator('.where-bar').getByRole('button', { name: '# Aisle…' }).click();
  await page.locator('.where-bar').getByRole('button', { name: '4', exact: true }).click();
  await page.locator('.where-bar').getByRole('button', { name: 'Save' }).click();
  await tick(page, 'Bread'); await page.locator('.where-bar .btn.primary').click(); // Bakery (department)
  await page.waitForTimeout(400);
  await page.screenshot({ path: process.env.SP + '/pl-1.png' });
  console.log('card:', await page.locator('.placement-card .where-bar-head').innerText(), '|', await page.locator('.placement-options .chip').allInnerTexts());
  await page.locator('.placement-options .chip', { hasText: 'behind Produce' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: process.env.SP + '/pl-2.png' });
  await page.getByRole('button', { name: 'Place here' }).click();
  console.log('after:', await page.locator('.toast').allInnerTexts(), 'card left:', await page.locator('.placement-card').count());
  console.log('errors', errs);
});
