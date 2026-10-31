import { SEED_CATEGORIES, SEED_ITEMS } from '../data/grocery';

/**
 * The grocery taxonomy: 22 store-section categories in typical walking order
 * (Produce first … Pet Supplies last), each with subcategories ("Produce" →
 * "Fruits", "Vegetables"…). Items carry their subcategory's id when it's known
 * (finer: it tells the map more), else a category's id. A shelf stocking a
 * category stocks all of its subcategories.
 */

const PARENT = new Map<string, string>();
const ORDER = new Map<string, number>();
for (const c of SEED_CATEGORIES) {
  ORDER.set(c.id, c.order * 100);
  c.subs.forEach(([id], i) => { PARENT.set(id, c.id); ORDER.set(id, c.order * 100 + i + 1); });
}

/** The category a subcategory is in (undefined for a category, or one the shopper made). */
export const parentOf = (id: string): string | undefined => PARENT.get(id);

/** The category an id belongs to: itself if it's a category. */
export const topOf = (id: string): string => PARENT.get(id) ?? id;

/** Whether an id is a subcategory of the taxonomy. */
export const isSub = (id: string): boolean => PARENT.has(id);

/** Walking order (categories in store order, subcategories within them); shopper-made ones come last. */
export const orderOf = (id: string): number => ORDER.get(id) ?? 10_000;

/**
 * Whether a place stocking `stocked` (a shelf's category list) has an item of `kind`: the same id, or the
 * item's category when the place only knows the category ("Canned goods" has the soup).
 */
export function stocks(stocked: readonly string[], kind: string): boolean {
  return stocked.includes(kind) || (PARENT.has(kind) && stocked.includes(PARENT.get(kind)!));
}

/**
 * The places that stock a kind of thing: those naming it exactly (Fish & Seafood) first; only if none do, those
 * stocking its category (Meat & Seafood).
 */
export function stocking<T extends { categories: readonly string[] }>(places: readonly T[], kind: string): T[] {
  const exact = places.filter((p) => p.categories.includes(kind));
  if (exact.length) return exact;
  const parent = PARENT.get(kind);
  if (!parent) return [];
  return places.filter((p) => p.categories.includes(parent));
}

/**
 * Places with another kind of thing from the same category (oatmeal: the cereal shelf). Often right, sometimes
 * not (soda isn't always by the water), so only offered as a one-tap answer, never used to place things.
 */
export function nearbyKinds<T extends { categories: readonly string[] }>(places: readonly T[], kind: string): T[] {
  const parent = PARENT.get(kind);
  return parent ? places.filter((p) => p.categories.some((c) => c !== kind && PARENT.get(c) === parent)) : [];
}

/** Sorts categories into walking order: the taxonomy's first, then the shopper's own A–Z. */
export function inWalkingOrder<T extends { id: string; name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => orderOf(a.id) - orderOf(b.id) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Every category and subcategory id, in walking order. */
export const TAXONOMY_IDS: string[] = SEED_CATEGORIES.flatMap((c) => [c.id, ...c.subs.map(([id]) => id)]);

/** Names of categories and subcategories by id. */
export const TAXONOMY_NAMES = new Map<string, string>(SEED_CATEGORIES.flatMap((c) => [[c.id, c.name] as [string, string], ...c.subs.map(([id, name]) => [id, name] as [string, string])]));

export { SEED_CATEGORIES, SEED_ITEMS };
