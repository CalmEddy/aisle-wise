import { expect, test, type Page } from '@playwright/test';
import { fresh, noPageErrors, saved } from './helpers';

/** Install a fake SpeechRecognition before the app boots; instances land on window.__awSpeech. */
async function mockSpeech(page: Page) {
  await page.addInitScript(() => {
    type Rec = {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((ev: unknown) => void) | null;
      onerror: ((ev: { error: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
      abort: () => void;
    };
    const instances: Rec[] = [];
    (window as unknown as { __awSpeech: Rec[] }).__awSpeech = instances;
    class FakeRec implements Rec {
      lang = '';
      continuous = false;
      interimResults = false;
      onresult: Rec['onresult'] = null;
      onerror: Rec['onerror'] = null;
      onend: Rec['onend'] = null;
      start() {}
      stop() {}
      abort() {}
      constructor() {
        instances.push(this);
      }
    }
    const w = window as unknown as {
      SpeechRecognition: typeof FakeRec;
      webkitSpeechRecognition: typeof FakeRec;
    };
    w.SpeechRecognition = FakeRec;
    w.webkitSpeechRecognition = FakeRec;
  });
}

async function fireFinal(page: Page, transcript: string) {
  await page.evaluate((t) => {
    const rec = (window as unknown as { __awSpeech: Array<{ onresult: ((ev: unknown) => void) | null }> }).__awSpeech.at(-1);
    rec?.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript: t } }],
    });
  }, transcript);
}

test('voice mic fills the box for review; suggestions show matches already on the list', async ({ page }) => {
  const ok = noPageErrors(page);
  await mockSpeech(page);
  await fresh(page, {
    products: [
      { id: 'milk', name: 'Milk', categoryId: 'dairy_eggs' },
      { id: 'eggs', name: 'Eggs', categoryId: 'dairy_eggs' },
    ],
    items: [{ id: 'i1', name: 'Milk', done: false, productId: 'milk' }],
  });

  await page.getByRole('button', { name: 'Add items' }).first().click();
  const mic = page.getByRole('button', { name: 'Add by voice' });
  await expect(mic).toBeVisible();
  await mic.click();
  await expect(page.getByRole('button', { name: 'Stop listening' })).toHaveAttribute('aria-pressed', 'true');

  await fireFinal(page, 'Milk');

  // Fills for review; listening stops so you can pick a match.
  await expect(page.getByLabel('Item to add')).toHaveValue('Milk');
  await expect(page.getByRole('button', { name: 'Add by voice' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Suggestions' })).toContainText('Milk');
  await expect(page.getByRole('list', { name: 'Suggestions' })).toContainText('On your list');

  // Review: add Eggs by speaking again, then confirm with + List.
  await page.getByRole('button', { name: 'Add by voice' }).click();
  await fireFinal(page, 'Eggs');
  await expect(page.getByLabel('Item to add')).toHaveValue('Eggs');
  await page.getByRole('button', { name: '+ List' }).first().click();
  await expect(page.locator('.added-strip')).toContainText('Eggs');

  const items = await saved<{ name: string }[]>(page, 'items');
  expect(items.map((i) => i.name).sort()).toEqual(['Eggs', 'Milk']);
  ok();
});

test('Items tab mic fills search for review instead of auto-adding', async ({ page }) => {
  const ok = noPageErrors(page);
  await mockSpeech(page);
  await fresh(page, {
    products: [{ id: 'butter', name: 'Butter', categoryId: 'dairy_eggs' }],
    lists: [{ id: 'main', name: 'Shopping list' }, { id: 'aldi', name: 'Aldi' }],
    activeList: 'aldi',
  });

  await page.getByRole('tab', { name: 'Items' }).click();
  await page.getByRole('button', { name: 'Add by voice' }).click();
  await fireFinal(page, 'Butter');

  await expect(page.getByLabel('Search or add grocery items')).toHaveValue('Butter');
  await expect(page.locator('.item-entry .name')).toContainText('Butter');
  await expect(page.locator('.toast')).toHaveCount(0);

  // Confirm add onto the active list via the row + control.
  await page.getByRole('button', { name: 'Add Butter to “Aldi”' }).click();
  await expect(page.locator('.toast')).toContainText('Aldi');
  const items = await saved<{ name: string; listId?: string }[]>(page, 'items');
  expect(items.some((i) => i.name === 'Butter' && i.listId === 'aldi')).toBe(true);
  ok();
});

test('mic stays visible when speech is unavailable and explains why', async ({ page }) => {
  const ok = noPageErrors(page);
  await page.addInitScript(() => {
    const w = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    w.SpeechRecognition = undefined;
    w.webkitSpeechRecognition = undefined;
  });
  await fresh(page);
  await page.getByRole('button', { name: 'Add items' }).first().click();
  const mic = page.getByRole('button', { name: 'Add by voice' });
  await expect(mic).toBeVisible();
  await mic.click();
  await expect(page.locator('.add-sheet-hint')).toContainText('Voice isn’t available');
  ok();
});
