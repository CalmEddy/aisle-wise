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

test('voice mic auto-adds spoken items on pause (and commas)', async ({ page }) => {
  const ok = noPageErrors(page);
  await mockSpeech(page);
  await fresh(page);

  await page.getByRole('button', { name: 'Add items' }).first().click();
  const mic = page.getByRole('button', { name: 'Add by voice' });
  await expect(mic).toBeVisible();
  await mic.click();
  await expect(page.getByRole('button', { name: 'Stop listening' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.add-sheet-hint')).toContainText('Listening');

  await fireFinal(page, 'Milk, Eggs');

  await expect(page.locator('.added-strip')).toContainText('Added Milk, Eggs');
  await expect(page.locator('main .name')).toContainText(['Milk', 'Eggs']);

  const items = await saved<{ name: string; done: boolean }[]>(page, 'items');
  expect(items.map((i) => i.name).sort()).toEqual(['Eggs', 'Milk']);
  expect(items.every((i) => !i.done)).toBe(true);

  await page.getByRole('button', { name: 'Stop listening' }).click();
  await expect(page.getByRole('button', { name: 'Add by voice' })).toBeVisible();
  ok();
});

test('Items tab mic is always visible and adds spoken names to the list', async ({ page }) => {
  const ok = noPageErrors(page);
  await mockSpeech(page);
  await fresh(page, {
    lists: [{ id: 'main', name: 'Shopping list' }, { id: 'aldi', name: 'Aldi' }],
    activeList: 'aldi',
  });

  await page.getByRole('tab', { name: 'Items' }).click();
  const mic = page.getByRole('button', { name: 'Add by voice' });
  await expect(mic).toBeVisible();
  await mic.click();
  await fireFinal(page, 'Butter');

  await expect(page.locator('.toast')).toContainText('On “Aldi” now');
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
