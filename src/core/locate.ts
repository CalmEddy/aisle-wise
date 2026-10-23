import type { Section, StoreLayout } from './types';

/** Lowercases, strips punctuation and quantities, and singularises each word. */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(' ');
}

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (/(ches|shes|xes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('ss')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Finds the section an item most likely lives in.
 *
 * `learned` holds placements the user taught the app, keyed by normalized
 * name, and wins over the store catalog. Otherwise the longest catalog
 * keyword found in the item name wins, so "almond milk" beats "milk".
 */
export function findSection(
  itemName: string,
  store: StoreLayout,
  learned: Record<string, string> = {},
): Section | undefined {
  const key = normalize(itemName);
  const byId = (id: string | undefined) => store.sections.find((s) => s.id === id);

  if (learned[key]) return byId(learned[key]);

  const padded = ` ${key} `;
  let bestId: string | undefined;
  let bestLen = 0;
  for (const [keyword, sectionId] of Object.entries(store.catalog)) {
    const k = normalize(keyword);
    if (k.length > bestLen && padded.includes(` ${k} `)) {
      bestId = sectionId;
      bestLen = k.length;
    }
  }
  return byId(bestId);
}
