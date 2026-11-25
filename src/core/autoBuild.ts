import type { Catalog } from './catalog';
import { spotPoint } from './geometry';
import { orderOf } from './taxonomy';
import type { Trip } from './trips';
import type { Area, AutoBuildState, Category, Place, Point, Product, StoreLayout } from './types';

/**
 * Building a workable store map of category areas from the order items are
 * checked off. Assumes the shopper starts at the lower right (entrance),
 * snakes up and down aisle lanes leftward, and ends near the lower left
 * (checkout). Not shelf-accurate — areas arranged by selection order, refined
 * with every trip.
 */

/** Stable id for an auto-built category area. */
export const autoPlaceId = (categoryId: string) => `ab-${categoryId}`;

/** Whether a place was created by auto-build. */
export const isAutoPlace = (id: string) => id.startsWith('ab-');

/** Area size on the grid (walkable). */
export const CELL_W = 4;
export const CELL_H = 4;
/** Gap between areas (walkway). */
export const GAP = 1;
/** Margin from store edges. */
export const MARGIN = 1;
/** How many areas stack in one aisle lane before starting the next (to the left). */
export const LANE_CAPACITY = 4;

export interface AutoBuildResult {
  layout: StoreLayout;
  products: Product[];
  /** Place ids added or moved this rebuild (for map outlines). */
  changed: string[];
  /** Where the latest pick sits, if it has a category on the map. */
  at?: Point;
}

/** Ordered unique top-level categories from a trip's picks (first visit wins). */
export function categorySequence(
  picks: { productId?: string; name: string }[],
  catalog: Catalog,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const product = (p.productId && catalog.productById.get(p.productId)) || catalog.match(p.name);
    const cat = product?.categoryId;
    if (!cat) continue;
    const top = catalog.topOf(cat);
    if (seen.has(top)) continue;
    seen.add(top);
    out.push(top);
  }
  return out;
}

/**
 * Merge trip sequences into category ranks. Each sequence contributes path
 * indices 0..n-1; ranks are count-weighted averages across trips.
 */
export function mergeRanks(
  prev: AutoBuildState['ranks'],
  sequences: string[][],
): AutoBuildState['ranks'] {
  const next: AutoBuildState['ranks'] = { ...prev };
  for (const seq of sequences) {
    if (!seq.length) continue;
    seq.forEach((cat, i) => {
      const cur = next[cat];
      if (!cur) {
        next[cat] = { at: i, n: 1 };
        return;
      }
      const n = cur.n + 1;
      next[cat] = { at: (cur.at * cur.n + i) / n, n };
    });
  }
  return next;
}

/** Categories sorted by rank (then taxonomy order for ties). */
export function rankedCategories(ranks: AutoBuildState['ranks']): string[] {
  return Object.keys(ranks).sort((a, b) => ranks[a]!.at - ranks[b]!.at || orderOf(a) - orderOf(b) || a.localeCompare(b));
}

/** Grid slot for path index `i`: lane from the right, slot along the lane. */
export function serpentineSlot(i: number): { lane: number; slot: number; upward: boolean } {
  const lane = Math.floor(i / LANE_CAPACITY);
  const slot = i % LANE_CAPACITY;
  const upward = lane % 2 === 0; // first lane (rightmost): bottom → top
  return { lane, slot, upward };
}

/** Top-left of the area for path index `i` on a store of the given size. */
export function areaOrigin(i: number, width: number, height: number): Point {
  const { lane, slot, upward } = serpentineSlot(i);
  const x = width - MARGIN - (lane + 1) * CELL_W - lane * GAP;
  const yAlong = upward ? height - MARGIN - (slot + 1) * CELL_H - slot * GAP : MARGIN + slot * (CELL_H + GAP);
  return { x, y: yAlong };
}

/** Store size that fits `n` areas along the serpentine path. */
export function sizeForCount(n: number): { width: number; height: number } {
  const lanes = Math.max(1, Math.ceil(n / LANE_CAPACITY));
  const slots = Math.min(LANE_CAPACITY, Math.max(1, n));
  const width = MARGIN * 2 + lanes * CELL_W + (lanes - 1) * GAP + 2; // +2 front walk strip
  const height = MARGIN * 2 + slots * CELL_H + (slots - 1) * GAP + 2;
  return { width: Math.max(16, width), height: Math.max(14, height) };
}

/** Build auto areas from ranks; keep any non-auto places the shopper added. */
export function layoutFromRanks(
  layout: StoreLayout,
  ranks: AutoBuildState['ranks'],
  categories: ReadonlyMap<string, Category>,
): { layout: StoreLayout; placeByCategory: Record<string, string>; changed: string[] } {
  const ordered = rankedCategories(ranks);
  const { width, height } = sizeForCount(ordered.length || 1);
  const kept = layout.places.filter((p) => !isAutoPlace(p.id));
  const before = new Map(layout.places.filter((p) => isAutoPlace(p.id)).map((p) => [p.id, p]));
  const placeByCategory: Record<string, string> = {};
  const areas: Area[] = ordered.map((cat, i) => {
    const id = autoPlaceId(cat);
    const origin = areaOrigin(i, width, height);
    const name = categories.get(cat)?.name ?? cat;
    const confirmed = (ranks[cat]?.n ?? 0) >= 2;
    const area: Area = {
      kind: 'area',
      id,
      label: name,
      x: origin.x,
      y: origin.y,
      w: CELL_W,
      h: CELL_H,
      categories: [cat],
      ...(!confirmed && { guess: true }),
    };
    placeByCategory[cat] = id;
    return area;
  });

  const changed: string[] = [];
  for (const a of areas) {
    const was = before.get(a.id);
    const same = was?.kind === 'area'
      && was.x === a.x && was.y === a.y && was.w === a.w && was.h === a.h && was.label === a.label;
    if (!same) changed.push(a.id);
  }
  for (const id of before.keys()) {
    if (!areas.some((a) => a.id === id)) changed.push(id);
  }

  const entrance: Point = { x: width - MARGIN - 1, y: height - 1 };
  const checkout: Point = { x: MARGIN, y: height - 1 };
  const places: Place[] = [...kept, ...areas];
  const auto: AutoBuildState = { enabled: layout.auto?.enabled ?? true, ranks };
  // Drop blank/door setup once areas exist so the map is free for shopping.
  let gen = layout.gen;
  if (gen?.setup && areas.length) {
    const { setup: _, ...rest } = gen;
    gen = rest;
  }

  return {
    layout: {
      ...layout,
      width,
      height,
      places,
      entrance,
      checkout,
      auto,
      gen,
    },
    placeByCategory,
    changed,
  };
}

/**
 * Assign product locations to auto areas when unset or previously auto-assigned.
 * Does not overwrite exact hand placements (`placeId@u,v`) or non-auto place ids.
 */
export function placeProductsOnAreas(
  products: Product[],
  layoutId: string,
  placeByCategory: Record<string, string>,
  catalog: Catalog,
): Product[] {
  return products.map((p) => {
    if (!p.categoryId) return p;
    const top = catalog.topOf(p.categoryId);
    const placeId = placeByCategory[top];
    if (!placeId) return p;
    const saved = p.locations?.[layoutId];
    if (saved) {
      // Keep hand exact spots and non-auto places.
      if (saved.includes('@') || !isAutoPlace(saved.split(':')[0]!)) return p;
      if (saved === placeId || saved.startsWith(`${placeId}:`)) {
        // Already on this (or previous) auto area — refresh to bare place id.
        if (saved === placeId) return p;
      }
    }
    // Clue answers win over auto placement.
    if (p.clues?.[layoutId]) return p;
    if (p.clearedAt?.includes(layoutId)) return p;
    return { ...p, locations: { ...p.locations, [layoutId]: placeId } };
  });
}

/**
 * One-shot: merge trips for this store into ranks, rebuild areas, place products.
 * Returns undefined when auto-build is off or there is nothing to apply yet.
 */
export function applyAutoBuild(
  layout: StoreLayout,
  products: Product[],
  trips: Trip[],
  catalog: Catalog,
): AutoBuildResult | undefined {
  if (!layout.auto?.enabled) return undefined;

  const mine = trips.filter((t) => t.layoutId === layout.id && t.picks.length > 0);
  const sequences = mine.map((t) => categorySequence(t.picks, catalog)).filter((s) => s.length > 0);
  if (!sequences.length && !Object.keys(layout.auto.ranks).length) return undefined;

  // Rebuild from all trips each time so repeat applies stay idempotent (no double-counting).
  const ranks = sequences.length ? mergeRanks({}, sequences) : layout.auto.ranks;
  if (!Object.keys(ranks).length) return undefined;

  const cats = catalog.categoryById;
  const built = layoutFromRanks(layout, ranks, cats);
  const nextProducts = placeProductsOnAreas(products, layout.id, built.placeByCategory, catalog);

  // Latest pick → standing point.
  const lastTrip = mine[mine.length - 1];
  const lastPick = lastTrip?.picks[lastTrip.picks.length - 1];
  let at: Point | undefined;
  if (lastPick) {
    const product = (lastPick.productId && catalog.productById.get(lastPick.productId)) || catalog.match(lastPick.name);
    const top = product?.categoryId ? catalog.topOf(product.categoryId) : undefined;
    const placeId = top && built.placeByCategory[top];
    const place = placeId && built.layout.places.find((p) => p.id === placeId);
    if (place) at = spotPoint(place);
  }

  const sameLayout = built.layout.width === layout.width
    && built.layout.height === layout.height
    && JSON.stringify(built.layout.auto?.ranks) === JSON.stringify(layout.auto.ranks)
    && JSON.stringify(built.layout.places.filter((p) => isAutoPlace(p.id))) === JSON.stringify(layout.places.filter((p) => isAutoPlace(p.id)));
  const sameProducts = nextProducts === products
    || nextProducts.every((p, i) => p.locations?.[layout.id] === products[i]?.locations?.[layout.id]);

  if (sameLayout && sameProducts) {
    return { layout, products, changed: [], at };
  }

  return {
    layout: built.layout,
    products: nextProducts,
    changed: built.changed,
    at,
  };
}

/** Turn off live auto-build (shopper edited the map by hand). */
export function disableAuto(layout: StoreLayout): StoreLayout {
  if (!layout.auto?.enabled) return layout;
  return { ...layout, auto: { ...layout.auto, enabled: false } };
}

/** True when `after` gained or changed non-auto geometry relative to `before`. */
export function handEditedAuto(before: StoreLayout, after: StoreLayout): boolean {
  if (!before.auto?.enabled) return false;
  const beforeHand = before.places.filter((p) => !isAutoPlace(p.id));
  const afterHand = after.places.filter((p) => !isAutoPlace(p.id));
  if (afterHand.length > beforeHand.length) return true;
  if (afterHand.some((p) => {
    const was = beforeHand.find((b) => b.id === p.id);
    return !was || was.x !== p.x || was.y !== p.y
      || (was.kind === 'area' && p.kind === 'area' && (was.w !== p.w || was.h !== p.h))
      || (was.kind === 'shelf' && p.kind === 'shelf' && was.length !== p.length);
  })) return true;
  // Deleted an auto area by hand (not a rebuild that still has auto places for same ranks).
  const beforeAuto = before.places.filter((p) => isAutoPlace(p.id)).map((p) => p.id).sort();
  const afterAuto = after.places.filter((p) => isAutoPlace(p.id)).map((p) => p.id).sort();
  if (beforeAuto.some((id) => !afterAuto.includes(id)) && after.auto?.enabled) {
    // Deleting auto places while ranks still list them is a hand edit.
    const ranked = new Set(Object.keys(before.auto.ranks).map(autoPlaceId));
    if (beforeAuto.some((id) => ranked.has(id) && !afterAuto.includes(id))) return true;
  }
  return false;
}
