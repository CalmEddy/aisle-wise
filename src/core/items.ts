import { normalize, type Catalog } from './catalog';
import { locateProduct } from './locate';
import type { Product, StoreLayout } from './types';

const newId = () => Math.random().toString(36).slice(2, 10);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Typed names (comma-separated) for the master list: names already there are
 * returned as `existing`; the rest become new items with the category of a
 * similar item ("oat milk" → Milk's category), if there is one.
 */
export function quickAddItems(text: string, catalog: Catalog): { created: Product[]; existing: Product[] } {
  const created: Product[] = [];
  const existing: Product[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(',')) {
    const name = raw.trim().replace(/\s+/g, ' ');
    const key = normalize(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const found = catalog.exact(name);
    if (found) {
      existing.push(found);
      continue;
    }
    const guess = catalog.match(name)?.categoryId;
    created.push({
      id: `p-${newId()}`,
      name: capitalize(name),
      ...(guess && catalog.categoryById.has(guess) && { categoryId: guess }),
    });
  }
  return { created, existing };
}

/** Quick views of the master list. */
export type ItemFilter = 'all' | 'place' | 'nocat' | 'list' | 'notsold';

/** Whether an item shows under a quick view, for the current store. */
export function itemMatches(p: Product, filter: ItemFilter, layout: StoreLayout, catalog: Catalog, onList: Set<string>): boolean {
  switch (filter) {
    case 'all': return true;
    case 'place': { const k = locateProduct(p, layout, catalog).kind; return k === 'unknown' || k === 'guess'; }
    case 'nocat': return !p.categoryId || !catalog.categoryById.has(p.categoryId);
    case 'list': return onList.has(p.id);
    case 'notsold': return !!p.notAt?.includes(layout.id);
  }
}

/** How far (px) a row must be swiped before letting go triggers its action. */
export const SWIPE_TRIGGER = 72;
/** How wide the buttons revealed by a left swipe are (px). */
export const SWIPE_REVEAL = 168;

/**
 * Whether a finger movement is a sideways swipe (decided once it has moved
 * 10px): only if it went more sideways than up/down, so scrolling still works.
 */
export function swipeDirection(dx: number, dy: number): 'swipe' | 'scroll' | 'undecided' {
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return 'undecided';
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? 'swipe' : 'scroll';
}

/** What letting go of a swipe does: right → add to list; left → show the buttons; short → nothing. */
export function swipeRelease(offset: number): 'right' | 'reveal' | 'none' {
  if (offset >= SWIPE_TRIGGER) return 'right';
  if (offset <= -SWIPE_TRIGGER / 2) return 'reveal';
  return 'none';
}
