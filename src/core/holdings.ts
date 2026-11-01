import { isDisplay, resolveClue } from './clues';

export { isDisplay };
import { parseExactKey, runsAlongX } from './geometry';
import { TAXONOMY_NAMES, topOf } from './taxonomy';
import type { Place, Product, StoreLayout } from './types';

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

/** How far along each place (0–1) the things saved there exactly were found, by category. */
function foundAlong(layout: StoreLayout, products: readonly Product[]): Map<string, Map<string, number[]>> {
  const out = new Map<string, Map<string, number[]>>();
  const byId = new Map(layout.places.map((p) => [p.id, p]));
  for (const p of products) {
    const key = p.locations?.[layout.id];
    const exact = key && p.categoryId ? parseExactKey(key) : undefined;
    const place = exact && byId.get(exact.placeId);
    if (!exact || !place) continue;
    const t = place.kind === 'shelf' || runsAlongX(place) ? exact.spot.u : exact.spot.v;
    const m = out.get(place.id) ?? new Map<string, number[]>();
    m.set(p.categoryId!, [...(m.get(p.categoryId!) ?? []), t]);
    out.set(place.id, m);
  }
  return out;
}

const mean = (xs?: number[]) => (xs?.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Where sections without things found fall: spread evenly between the ones around them. */
function filled(known: (number | undefined)[]): number[] {
  const n = known.length;
  return known.map((c, i) => {
    if (c !== undefined) return c;
    let j = i - 1;
    while (j >= 0 && known[j] === undefined) j--;
    let k = i + 1;
    while (k < n && known[k] === undefined) k++;
    const cj = j >= 0 ? known[j]! : 0;
    const ck = k < n ? known[k]! : 1;
    const from = j >= 0 ? j : -0.5;
    const to = k < n ? k : n - 0.5;
    return cj + ((ck - cj) * (i - from)) / (to - from);
  });
}

/**
 * The order of a place's sections and how long each is, from where its things were found: the categories set by
 * hand in their order, ones it holds put where their things are. Undefined (equal shares, in order) if nothing was
 * found there exactly, or if where things were found doesn't fit the order set by hand.
 */
function sectionsOf(own: string[], learned: string[], found?: Map<string, number[]>): { order: string[]; sections?: Place['sections'] } {
  const order = [...own];
  const at = (k: string) => mean(found?.get(k));
  if (!found?.size) return { order: [...own, ...learned] };
  const ownAt = filled(own.map(at));
  const centre = new Map(own.map((k, i) => [k, ownAt[i]]));
  const unplaced: string[] = [];
  for (const k of learned) {
    const c = at(k);
    if (c === undefined) { unplaced.push(k); continue; }
    const i = order.findIndex((o) => (centre.get(o) ?? Infinity) > c);
    order.splice(i < 0 ? order.length : i, 0, k);
    centre.set(k, c);
  }
  order.push(...unplaced);
  if (order.length < 2) return { order };
  const c = filled(order.map(at));
  if (c.some((x, i) => i > 0 && x <= c[i - 1])) return { order };
  const edge = (i: number) => (i <= 0 ? 0 : i >= c.length ? 1 : (c[i - 1] + c[i]) / 2);
  return { order, sections: order.map((categoryId, i) => ({ categoryId, from: edge(i), to: edge(i + 1), at: Math.min(1, Math.max(0, c[i])) })) };
}

/**
 * The store as the app reads it: each place's categories are those set on it (or built from answers) and then
 * those it holds, most first, with a weight for each (`holds`); tables and stands are marked (`display`); a name
 * the app gave gets the main category ("Shelf 3 - International").
 */
export function withHoldings(layout: StoreLayout, products: readonly Product[], names?: ReadonlyMap<string, string>): StoreLayout {
  const held = holdingsOf(layout, products);
  const along = foundAlong(layout, products);
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
      const { order: categories, sections } = sectionsOf(own, learned.map(([k]) => k), along.get(place.id));
      // The main category: the one with the most weight (as a category: "International", not "Asian").
      const main = Object.entries(holds).sort((a, b) => b[1] - a[1])[0]?.[0];
      const mainName = main ? nameOf(topOf(main)) : undefined;
      const label = DEFAULT_NAME.test(place.label) && mainName ? `${place.label} - ${mainName}` : place.label;
      return {
        ...place, categories, label, holds, own: place.categories,
        ...(label !== place.label && { baseLabel: place.label }),
        ...(isDisplay(place) && { display: true }),
        ...(sections && { sections }),
      };
    }),
  };
}
