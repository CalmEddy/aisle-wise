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

/** The category a subcategory is in (undefined for a category, or one the shopper made). Seed default only. */
export const parentOf = (id: string): string | undefined => PARENT.get(id);

/** The category an id belongs to: itself if it's a category. Seed default only. */
export const topOf = (id: string): string => PARENT.get(id) ?? id;

/** Whether an id is a subcategory of the taxonomy. Seed default only. */
export const isSub = (id: string): boolean => PARENT.has(id);

/**
 * Live parent from the household's category list. When the category is saved
 * there, `parent` is authoritative (missing = top-level) — so moving a
 * subcategory under another parent (or promoting it) sticks. Unknown ids fall
 * back to the seed taxonomy.
 */
export function liveParent(byId: ReadonlyMap<string, { parent?: string }>, id: string): string | undefined {
  if (byId.has(id)) return byId.get(id)!.parent;
  return PARENT.get(id);
}

/** Live top category: follow `liveParent`, else the id itself. */
export function liveTop(byId: ReadonlyMap<string, { parent?: string }>, id: string): string {
  return liveParent(byId, id) ?? id;
}

/** Whether this id is currently a subcategory in the live list (or seed if unknown). */
export function liveIsSub(byId: ReadonlyMap<string, { parent?: string }>, id: string): boolean {
  return liveParent(byId, id) !== undefined;
}

/** Walking order (categories in store order, subcategories within them); shopper-made ones come last. */
export const orderOf = (id: string): number => ORDER.get(id) ?? 10_000;

/** Resolves a subcategory's parent; pass `catalog.parentOf` so live edits stick. */
export type ParentFn = (id: string) => string | undefined;

/**
 * Whether a place stocking `stocked` (a shelf's category list) has an item of `kind`: the same id, or the
 * item's top category when the place only knows the category ("Canned goods" has the soup).
 */
export function stocks(stocked: readonly string[], kind: string, parentOfKind: ParentFn = parentOf): boolean {
  const parent = parentOfKind(kind);
  return stocked.includes(kind) || (!!parent && stocked.includes(parent));
}

/** Where a kind of thing lives: places stocking it, not tables or stands (those are only offered, never assumed). */
export function homesOf<T extends { categories: readonly string[]; holds?: Record<string, number>; display?: boolean; own?: readonly string[] }>(
  places: readonly T[],
  kind: string,
  parentOfKind: ParentFn = parentOf,
): T[] {
  return stocking(places, kind, parentOfKind).filter((p) => !p.display);
}

/**
 * The places where a kind of thing lives, likeliest first. Places naming it (Fish & Seafood) count fully, places
 * stocking only its category (Meat & Seafood) half. A main home (set by hand, built from answers, or holding two
 * or more of it) beats one odd item put somewhere and beats tables and stands, which hold this week's display;
 * those count only when there's nowhere better.
 *
 * Pass `parentOfKind` (e.g. `catalog.parentOf`) so a subcategory moved under Condiments finds the Condiments shelf.
 */
export function stocking<T extends { categories: readonly string[]; holds?: Record<string, number>; display?: boolean; own?: readonly string[] }>(
  places: readonly T[],
  kind: string,
  parentOfKind: ParentFn = parentOf,
): T[] {
  const parent = parentOfKind(kind);
  const weight = (p: T, k: string) => p.holds?.[k] ?? (p.categories.includes(k) ? 1 : 0);
  // Its own kind counts fully; a place stocking only its category, half.
  let found = places.map((p) => ({ p, w: weight(p, kind) || (parent ? weight(p, parent) / 2 : 0) })).filter((c) => c.w > 0);
  if (!found.length) return [];
  // Where the kind lives: a main home (set by hand, built from answers, or two or more of it there) wins over one
  // odd item and over tables and stands; failing that, anywhere but a table or stand; failing that, a table or stand.
  // A home: set there by hand (the kind or its category), or more than one item of it put there.
  const setHere = (p: T) => !!p.own?.some((c) => (c === kind || c === parent) && p.categories.includes(c));
  const homes = found.filter((c) => !c.p.display && (c.w >= 2 || setHere(c.p)));
  const shelves = found.filter((c) => !c.p.display);
  found = homes.length ? homes : shelves.length ? shelves : found;
  return found.sort((a, b) => b.w - a.w).map((c) => c.p);
}

/**
 * Places with another kind of thing from the same category (oatmeal: the cereal shelf). Often right, sometimes
 * not (soda isn't always by the water), so only offered as a one-tap answer, never used to place things.
 */
export function nearbyKinds<T extends { categories: readonly string[] }>(
  places: readonly T[],
  kind: string,
  parentOfKind: ParentFn = parentOf,
): T[] {
  const parent = parentOfKind(kind);
  return parent
    ? places.filter((p) => p.categories.some((c) => c !== kind && parentOfKind(c) === parent))
    : [];
}

/** A place with no category assigned — not a department shelf on the map. */
export function isUncategorizedPlace(place: { categories: readonly string[] }): boolean {
  return place.categories.length === 0;
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
