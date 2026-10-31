import { isDisplay, resolveClue } from './clues';

export { isDisplay };
import { parseExactKey } from './geometry';
import { TAXONOMY_NAMES, topOf } from './taxonomy';
import type { Product, StoreLayout } from './types';

/**
 * What each shelf or area holds, worked out from the items put there (saved
 * there, or answered there: "Where was it?" → "Aisle 1"), so a place can hold
 * several categories ("International": tortillas, salsa, taco seasoning) and
 * keeps up as things move. Categories set by hand on a place always count;
 * ones taken off by hand ("hides") don't come back.
 *
 * Nothing here is saved: the app reads the store through `withHoldings`, and
 * the stored store keeps only what was set by hand (or built from answers).
 */

/** Weight of a category set by hand on a place drawn by hand, and of one the map built from answers. */
const SET_BY_HAND = 3;
const BUILT = 2;

/** "Shelf 3", "Area 12": a name the app gave, not the shopper. */
const DEFAULT_NAME = /^(Shelf|Area) \d+$/;

/** The place a spot key is on. */
export const placeIdOf = (key: string): string => parseExactKey(key)?.placeId ?? key.split(':')[0];

/** Kind → how many items of it are put there, per place. */
export function holdingsOf(layout: StoreLayout, products: readonly Product[]): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  const ids = new Set(layout.places.map((p) => p.id));
  for (const p of products) {
    if (!p.categoryId) continue;
    const clue = p.clues?.[layout.id];
    const key = p.locations?.[layout.id] ?? (clue ? resolveClue(clue, layout, p) : undefined);
    if (!key) continue;
    const id = placeIdOf(key);
    if (!ids.has(id)) continue;
    const rec = out.get(id) ?? {};
    rec[p.categoryId] = (rec[p.categoryId] ?? 0) + 1;
    out.set(id, rec);
  }
  return out;
}

/**
 * The store as the app reads it: each place's categories are those set on it (or built from answers) and then
 * those it holds, most first, with a weight for each (`holds`); tables and stands are marked (`display`); a name
 * the app gave gets the main category ("Shelf 3 - International").
 */
export function withHoldings(layout: StoreLayout, products: readonly Product[], names?: ReadonlyMap<string, string>): StoreLayout {
  const held = holdingsOf(layout, products);
  const nameOf = (id: string) => names?.get(id) ?? TAXONOMY_NAMES.get(id);
  return {
    ...layout,
    places: layout.places.map((place) => {
      const counts = held.get(place.id) ?? {};
      const hides = new Set(place.hides ?? []);
      const own = place.categories.filter((c) => !hides.has(c));
      const holds: Record<string, number> = {};
      const base = place.id.startsWith('g-') ? BUILT : SET_BY_HAND;
      for (const c of own) holds[c] = Math.max(base, counts[c] ?? 0);
      const learned = Object.entries(counts).filter(([k]) => !hides.has(k) && !own.includes(k)).sort((a, b) => b[1] - a[1]);
      for (const [k, n] of learned) holds[k] = n;
      const categories = [...own, ...learned.map(([k]) => k)];
      // The main category: the one with the most weight (as a category: "International", not "Asian").
      const main = Object.entries(holds).sort((a, b) => b[1] - a[1])[0]?.[0];
      const mainName = main ? nameOf(topOf(main)) : undefined;
      const label = DEFAULT_NAME.test(place.label) && mainName ? `${place.label} - ${mainName}` : place.label;
      return {
        ...place, categories, label, holds, own: place.categories,
        ...(label !== place.label && { baseLabel: place.label }),
        ...(isDisplay(place) && { display: true }),
      };
    }),
  };
}
