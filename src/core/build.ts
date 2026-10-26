import type { Catalog } from './catalog';
import { contains, exactKey, exactSpotAt, footprint, parseExactKey } from './geometry';
import { resolveSpot } from './locate';
import type { Area, Category, ListItem, Orientation, Place, Point, Product, Shelf, StoreLayout } from './types';

/**
 * Build mode: grow a store's map from where the shopper is standing as they
 * pick things up. Everything here is pure: it returns the new layout and
 * the spot to save the item at, and the app applies it.
 */

/** How far past a shelf's end (in squares) still counts as "at the end of it". */
export const REACH = 3;
/** Length of a newly created shelf. */
export const NEW_SHELF_LENGTH = 3;

export type BuildAction = 'onShelf' | 'inArea' | 'extend' | 'create' | 'extendArea' | 'createArea' | 'blocked';

/** What picking up on open floor builds. */
export type BuildTarget = 'shelf' | 'area';

/** Size of a new area (squares). */
export const NEW_AREA_SIZE = 3;

export interface BuildPlan {
  action: BuildAction;
  /** The layout after the change (unchanged for onShelf/inArea, apart from adding the category). */
  layout: StoreLayout;
  /** Where to save the item. */
  spotKey?: string;
  placeId?: string;
  /** Shelf/area label, for messages. */
  label: string;
  /**
   * When a shelf grew, saved spots on it must be recalculated so items stay
   * where they physically are. Maps an old spot key to the new one.
   */
  rekey?: (key: string) => string;
}

const newId = () => Math.random().toString(36).slice(2, 10);

/** The next free number for a new shelf or area label ("Shelf 4", "Area 2"). */
export function nextLabel(l: StoreLayout, kind: Place['kind']): string {
  const word = kind === 'shelf' ? 'Shelf' : 'Area';
  const used = new Set(l.places.filter((p) => p.kind === kind)
    .map((p) => new RegExp(`^${word} (\\d+)$`).exec(p.label.trim())?.[1]).filter(Boolean).map(Number));
  let n = 1;
  while (used.has(n)) n++;
  return `${word} ${n}`;
}
const inBounds = (l: StoreLayout, p: Point) => p.x >= 0 && p.y >= 0 && p.x < l.width && p.y < l.height;

/** Is a square free for a new shelf/area: inside the store and not part of another place? */
function free(l: StoreLayout, p: Point, exceptId?: string): boolean {
  return inBounds(l, p) && !l.places.some((pl) => pl.id !== exceptId && contains(footprint(pl), p));
}

/** Where along a shelf a square is, 0..1 (centre of the square). */
function alongShelf(s: Shelf, p: Point): number {
  return s.orientation === 'vertical' ? exactSpotAt(s, s.x + 0.5, p.y + 0.5).u : exactSpotAt(s, p.x + 0.5, s.y + 0.5).u;
}

/** Shelves you're on or standing right beside (not off the end). */
function shelfBeside(l: StoreLayout, p: Point): Shelf | undefined {
  let best: Shelf | undefined;
  let bestD = 2;
  for (const pl of l.places) {
    if (pl.kind !== 'shelf') continue;
    const f = footprint(pl);
    const v = pl.orientation === 'vertical';
    const alongOk = v ? p.y >= f.y && p.y < f.y + f.h : p.x >= f.x && p.x < f.x + f.w;
    const d = v ? Math.abs(p.x - f.x) : Math.abs(p.y - f.y);
    if (alongOk && d <= 1 && d < bestD) {
      best = pl;
      bestD = d;
    }
  }
  return best;
}

function replacePlace(l: StoreLayout, place: Place): StoreLayout {
  return { ...l, places: l.places.map((p) => (p.id === place.id ? place : p)) };
}

/** Adds a category to a place if it's missing, at roughly position `u` along it. */
function withCategory<T extends Place>(place: T, cat: string | undefined, u: number | 'start' | 'end'): T {
  if (!cat || place.categories.includes(cat)) return place;
  const list = [...place.categories];
  const at = u === 'start' ? 0 : u === 'end' ? list.length : Math.max(0, Math.min(list.length, Math.round(u * list.length)));
  list.splice(at, 0, cat);
  return { ...place, categories: list };
}

/** Spot keys on a shelf that changed size: keep each item at the same physical square. */
export function rekeyResized(before: Shelf, after: Shelf) {
  const v = before.orientation === 'vertical';
  const oldStart = v ? before.y : before.x;
  const newStart = v ? after.y : after.x;
  return (key: string) => {
    const exact = parseExactKey(key);
    if (!exact || exact.placeId !== before.id) return key;
    const at = oldStart + exact.spot.u * before.length;
    return exactKey(after.id, { u: Math.max(0, Math.min(1, (at - newStart) / after.length)), v: exact.spot.v });
  };
}

/**
 * Cells for a new shelf of up to `length` squares through `p`, in the given
 * direction, centred where possible and trimmed/shifted to avoid other places
 * and the walls.
 */
function fitShelf(l: StoreLayout, p: Point, orientation: Orientation, length: number, exceptId?: string): { start: number; length: number } | undefined {
  const along = orientation === 'vertical' ? p.y : p.x;
  const cell = (i: number) => (orientation === 'vertical' ? { x: p.x, y: i } : { x: i, y: p.y });
  for (let len = length; len >= 1; len--) {
    // Centred first, then shifted either way.
    const centred = along - Math.floor((len - 1) / 2);
    const starts = [centred];
    for (let k = 1; k < len; k++) starts.push(centred - k, centred + k);
    for (const start of starts) {
      if (start > along || start + len - 1 < along) continue;
      let ok = true;
      for (let i = start; i < start + len && ok; i++) ok = free(l, cell(i), exceptId);
      if (ok) return { start, length: len };
    }
  }
  return undefined;
}

/**
 * What happens when the shopper picks up an item at `p` in build mode:
 * on/beside a shelf → that shelf; in an open area → that area; up to REACH
 * squares past a shelf's end (lined up with it) → extend it; otherwise →
 * a new shelf through `p`.
 */
export function planBuild(
  l: StoreLayout, p: Point, category?: Category, orientation: Orientation = 'vertical', target: BuildTarget = 'shelf',
): BuildPlan {
  const cat = category?.id;

  // 1. On or beside a shelf.
  const beside = shelfBeside(l, p);
  if (beside) {
    const u = alongShelf(beside, p);
    const shelf = withCategory(beside, cat, u);
    return { action: 'onShelf', layout: replacePlace(l, shelf), spotKey: exactKey(shelf.id, { u, v: 0.5 }), placeId: shelf.id, label: shelf.label };
  }

  // 2. Inside an open area.
  const area = [...l.places].reverse().find((pl): pl is Area => pl.kind === 'area' && contains(footprint(pl), p));
  if (area) {
    const spot = exactSpotAt(area, p.x + 0.5, p.y + 0.5);
    const updated = withCategory(area, cat, 'end');
    return { action: 'inArea', layout: replacePlace(l, updated), spotKey: exactKey(area.id, spot), placeId: area.id, label: area.label };
  }

  if (target === 'area') return planArea(l, p, category);

  // 3. Just past the end of a shelf, lined up with it.
  const near = extendCandidates(l, p).filter((c) => c.gap <= REACH).sort((a, b) => a.gap - b.gap)[0];
  if (near) return extendTo(l, near, p, cat);

  // 4. A new shelf through where you're standing.
  const fit = fitShelf(l, p, orientation, NEW_SHELF_LENGTH);
  if (!fit) return { action: 'blocked', layout: l, label: '' };
  const shelf: Shelf = {
    kind: 'shelf',
    id: `s-${newId()}`,
    label: nextLabel(l, 'shelf'),
    orientation,
    length: fit.length,
    x: orientation === 'vertical' ? p.x : fit.start,
    y: orientation === 'vertical' ? fit.start : p.y,
    categories: cat ? [cat] : [],
  };
  return {
    action: 'create',
    layout: { ...l, places: [...l.places, shelf] },
    spotKey: exactKey(shelf.id, { u: alongShelf(shelf, p), v: 0.5 }),
    placeId: shelf.id,
    label: shelf.label,
  };
}

/** A shelf that can be extended in a straight line to reach `p`. */
export interface ExtendCandidate {
  shelfId: string;
  label: string;
  /** Squares between the shelf's end and you. */
  gap: number;
  /** Which way the shelf would grow to reach you. */
  direction: 'up' | 'down' | 'left' | 'right';
  /** The shelf's new start and end along its line. */
  start: number;
  end: number;
  atStart: boolean;
}

/**
 * Shelves lined up with `p` – vertical shelves above or below, horizontal
 * ones to the left or right, within one square sideways – whose line can
 * grow to reach `p` over free floor. Only the nearest in each direction.
 */
export function extendCandidates(l: StoreLayout, p: Point): ExtendCandidate[] {
  const best = new Map<string, ExtendCandidate>();
  for (const pl of l.places) {
    if (pl.kind !== 'shelf') continue;
    const v = pl.orientation === 'vertical';
    if ((v ? Math.abs(p.x - pl.x) : Math.abs(p.y - pl.y)) > 1) continue;
    const s0 = v ? pl.y : pl.x;
    const s1 = s0 + pl.length - 1;
    const a = v ? p.y : p.x;
    const atStart = a < s0;
    const gap = atStart ? s0 - a : a - s1;
    if (gap < 1) continue;
    let ok = true;
    for (let i = atStart ? a : s1 + 1; i <= (atStart ? s0 - 1 : a) && ok; i++) {
      ok = free(l, v ? { x: pl.x, y: i } : { x: i, y: pl.y }, pl.id);
    }
    if (!ok) continue;
    const direction = v ? (atStart ? 'up' : 'down') : (atStart ? 'left' : 'right');
    const c: ExtendCandidate = {
      shelfId: pl.id, label: pl.label, gap, direction, atStart, start: atStart ? a : s0, end: atStart ? s1 : a,
    };
    const prev = best.get(direction);
    if (!prev || gap < prev.gap) best.set(direction, c);
  }
  return [...best.values()].sort((a, b) => a.gap - b.gap);
}

/** Extends a candidate shelf to reach `p`, saving the item at `p`. */
function extendTo(l: StoreLayout, c: ExtendCandidate, p: Point, cat?: string): BuildPlan {
  const shelf = l.places.find((pl): pl is Shelf => pl.id === c.shelfId && pl.kind === 'shelf')!;
  const v = shelf.orientation === 'vertical';
  let grown: Shelf = { ...shelf, length: c.end - c.start + 1, ...(v ? { y: c.start } : { x: c.start }) };
  grown = withCategory(grown, cat, c.atStart ? 'start' : 'end');
  return {
    action: 'extend',
    layout: replacePlace(l, grown),
    spotKey: exactKey(grown.id, { u: alongShelf(grown, p), v: 0.5 }),
    placeId: grown.id,
    label: grown.label,
    rekey: rekeyResized(shelf, grown),
  };
}

/** What the shopper chose when picking up on open floor. */
export type BuildChoice = { extend: string } | 'shelf' | 'area';

/** The plan for a chosen way of placing an item picked up at `p`. */
export function planChoice(l: StoreLayout, p: Point, category: Category | undefined, choice: BuildChoice): BuildPlan {
  if (typeof choice === 'object') {
    const c = extendCandidates(l, p).find((x) => x.shelfId === choice.extend);
    return c ? extendTo(l, c, p, category?.id) : { action: 'blocked', layout: l, label: '' };
  }
  return planBuild(l, p, category, 'vertical', choice);
}

/**
 * Turns a shelf the other way round the square nearest `p`, keeping its
 * length (trimmed if something is in the way). Returns undefined if it
 * can't fit at all.
 */
export function turnShelf(l: StoreLayout, shelfId: string, p: Point): { layout: StoreLayout; rekey: (key: string) => string } | undefined {
  const s = l.places.find((pl): pl is Shelf => pl.id === shelfId && pl.kind === 'shelf');
  if (!s) return undefined;
  const v = s.orientation === 'vertical';
  // Pivot: the shelf square level with the shopper.
  const along = Math.max(v ? s.y : s.x, Math.min((v ? s.y : s.x) + s.length - 1, v ? p.y : p.x));
  const pivot = v ? { x: s.x, y: along } : { x: along, y: s.y };
  const before = along - (v ? s.y : s.x);
  const to: Orientation = v ? 'horizontal' : 'vertical';
  // Prefer keeping the pivot at the same distance from the start.
  const wanted = (to === 'vertical' ? pivot.y : pivot.x) - before;
  const cell = (i: number) => (to === 'vertical' ? { x: pivot.x, y: i } : { x: i, y: pivot.y });
  const fits = (start: number, len: number) => {
    for (let i = start; i < start + len; i++) if (!free(l, cell(i), s.id)) return false;
    return true;
  };
  let start = wanted;
  let length = s.length;
  if (!fits(start, length)) {
    const fit = fitShelf(l, pivot, to, s.length, s.id);
    if (!fit) return undefined;
    start = fit.start;
    length = fit.length;
  }
  const turned: Shelf = { ...s, orientation: to, length, x: to === 'vertical' ? pivot.x : start, y: to === 'vertical' ? start : pivot.y };
  // Spots are "how far along"; keep each the same distance from the pivot.
  const pivotOld = (before + 0.5) / s.length;
  const pivotNew = ((to === 'vertical' ? pivot.y : pivot.x) - start + 0.5) / length;
  const rekey = (key: string) => {
    const exact = parseExactKey(key);
    if (!exact || exact.placeId !== s.id) return key;
    const squares = (exact.spot.u - pivotOld) * s.length;
    return exactKey(s.id, { u: Math.max(0, Math.min(1, pivotNew + squares / length)), v: exact.spot.v });
  };
  return { layout: replacePlace(l, turned), rekey };
}

/** An open area around `p`: as big as fits, up to 6 × 4. */
export function areaHere(l: StoreLayout, p: Point, label = nextLabel(l, 'area')): { layout: StoreLayout; area: Area } | undefined {
  if (!free(l, p)) return undefined;
  for (const [w, h] of [[6, 4], [4, 4], [4, 3], [3, 3], [3, 2], [2, 2], [1, 1]]) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = p.x - Math.floor(w / 2) + (dx % 2 ? Math.ceil(dx / 2) : -Math.ceil(dx / 2));
        const y = p.y - Math.floor(h / 2) + (dy % 2 ? Math.ceil(dy / 2) : -Math.ceil(dy / 2));
        if (p.x < x || p.x >= x + w || p.y < y || p.y >= y + h) continue;
        let ok = true;
        for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w && ok; xx++) ok = free(l, { x: xx, y: yy });
        if (ok) {
          const area: Area = { kind: 'area', id: `ar-${newId()}`, label, x, y, w, h, categories: [] };
          return { layout: { ...l, places: [...l.places, area] }, area };
        }
      }
    }
  }
  return undefined;
}

export type Direction = 'left' | 'right' | 'up' | 'down';

/**
 * Makes the store bigger on one side. Growing left or up shifts everything
 * (places, entrance, checkout) so it stays put; returns that shift so the
 * shopper's position can move with it.
 */
export function growStore(l: StoreLayout, dir: Direction, by = 5): { layout: StoreLayout; shift: Point } {
  const shift = { x: dir === 'left' ? by : 0, y: dir === 'up' ? by : 0 };
  const move = (p: Point) => ({ x: p.x + shift.x, y: p.y + shift.y });
  return {
    shift,
    layout: {
      ...l,
      width: l.width + (dir === 'left' || dir === 'right' ? by : 0),
      height: l.height + (dir === 'up' || dir === 'down' ? by : 0),
      entrance: move(l.entrance),
      checkout: move(l.checkout),
      places: l.places.map((p) => ({ ...p, ...move(p) })),
    },
  };
}

/** Moves one square, growing the store if that steps past its edge. */
export function step(l: StoreLayout, p: Point, dir: Direction): { layout: StoreLayout; position: Point } {
  const next = {
    x: p.x + (dir === 'left' ? -1 : dir === 'right' ? 1 : 0),
    y: p.y + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0),
  };
  if (inBounds(l, next)) return { layout: l, position: next };
  const grown = growStore(l, dir);
  return { layout: grown.layout, position: { x: next.x + grown.shift.x, y: next.y + grown.shift.y } };
}

/** A blank store to build as you shop. */
export function blankStore(name = 'New store'): StoreLayout {
  return {
    id: `l-${newId()}`, name, width: 30, height: 24, places: [],
    entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
  };
}

/** Spot keys in an area that changed size: keep each item at the same physical square. */
export function rekeyResizedArea(before: Area, after: Area) {
  return (key: string) => {
    const exact = parseExactKey(key);
    if (!exact || exact.placeId !== before.id) return key;
    const x = before.x + exact.spot.u * before.w;
    const y = before.y + exact.spot.v * before.h;
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    return exactKey(after.id, { u: clamp((x - after.x) / after.w), v: clamp((y - after.y) / after.h) });
  };
}

/**
 * Area building, for open floor (no shelf or area at `p`): within REACH
 * squares outside an area → stretch it to include `p`; otherwise → a new
 * 3 × 3 area centred on `p`, trimmed to fit.
 */
function planArea(l: StoreLayout, p: Point, category?: Category): BuildPlan {
  const cat = category?.id;

  // Stretch the nearest area within reach, if the new squares are free.
  let best: { area: Area; grown: Area; d: number } | undefined;
  for (const pl of l.places) {
    if (pl.kind !== 'area') continue;
    const dx = Math.max(pl.x - p.x, 0, p.x - (pl.x + pl.w - 1));
    const dy = Math.max(pl.y - p.y, 0, p.y - (pl.y + pl.h - 1));
    const d = Math.max(dx, dy);
    if (d < 1 || d > REACH) continue;
    const x0 = Math.min(pl.x, p.x);
    const y0 = Math.min(pl.y, p.y);
    const x1 = Math.max(pl.x + pl.w - 1, p.x);
    const y1 = Math.max(pl.y + pl.h - 1, p.y);
    let ok = true;
    for (let y = y0; y <= y1 && ok; y++) for (let x = x0; x <= x1 && ok; x++) ok = free(l, { x, y }, pl.id);
    if (ok && (!best || d < best.d)) {
      best = { area: pl, grown: { ...pl, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, d };
    }
  }
  if (best) {
    const grown = withCategory(best.grown, cat, 'end');
    return {
      action: 'extendArea',
      layout: replacePlace(l, grown),
      spotKey: exactKey(grown.id, exactSpotAt(grown, p.x + 0.5, p.y + 0.5)),
      placeId: grown.id,
      label: grown.label,
      rekey: rekeyResizedArea(best.area, grown),
    };
  }

  // A new area around you: 3 × 3 if it fits, otherwise smaller.
  for (const [w, h] of [[3, 3], [3, 2], [2, 3], [2, 2], [2, 1], [1, 2], [1, 1]]) {
    // Centred first, then shifted so `p` is still inside.
    const xs = [p.x - Math.floor((w - 1) / 2), ...Array.from({ length: w }, (_, i) => p.x - i)];
    const ys = [p.y - Math.floor((h - 1) / 2), ...Array.from({ length: h }, (_, i) => p.y - i)];
    for (const y of ys) {
      for (const x of xs) {
        let ok = true;
        for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w && ok; xx++) ok = free(l, { x: xx, y: yy });
        if (!ok) continue;
        const area: Area = {
          kind: 'area', id: `ar-${newId()}`, label: nextLabel(l, 'area'), x, y, w, h, categories: cat ? [cat] : [],
        };
        return {
          action: 'createArea',
          layout: { ...l, places: [...l.places, area] },
          spotKey: exactKey(area.id, exactSpotAt(area, p.x + 0.5, p.y + 0.5)),
          placeId: area.id,
          label: area.label,
        };
      }
    }
  }
  return { action: 'blocked', layout: l, label: '' };
}

// ---------------------------------------------------------------------------
// Picking an item up in build mode

export type PickUpOutcome =
  | { kind: 'built'; action: BuildAction; placeId: string; label: string; itemName: string; productId: string }
  | { kind: 'conflict'; productId: string; itemName: string; savedKey: string }
  /** Picked up on open floor with shelves that could be extended: ask which (or new shelf/area). */
  | { kind: 'choose'; productId: string; itemName: string; at: Point; options: ExtendCandidate[] }
  | { kind: 'blocked'; itemName: string; productId: string };

export interface PickUpResult {
  layout: StoreLayout;
  products: Product[];
  items: ListItem[];
  outcome: PickUpOutcome;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Applies a plan's re-keying (a shelf/area grew) to every saved location in this store. */
function rekeyAll(products: Product[], layoutId: string, rekey?: (k: string) => string): Product[] {
  if (!rekey) return products;
  return products.map((p) => {
    const k = p.locations?.[layoutId];
    const nk = k ? rekey(k) : k;
    return nk && nk !== k ? { ...p, locations: { ...p.locations, [layoutId]: nk } } : p;
  });
}

/**
 * The shopper picked up an item (checked it off, or into the cart) at `at`
 * in build mode. Builds the map around them and saves the item's spot.
 *
 * - The item's master-list entry is the list item's own, an exact name
 *   match, or a new one (with the category a similar item has).
 * - Saved in a different place in this store → nothing moves; the caller
 *   asks first (`conflict`). Saved in the same place → updated to this spot.
 * - The list entry is ticked, or added already ticked.
 */
export function pickUp(
  state: { items: ListItem[]; products: Product[]; layout: StoreLayout; catalog: Catalog },
  name: string, itemId: string | undefined, at: Point, target: BuildTarget = 'shelf',
): PickUpResult {
  const { items, catalog, layout } = state;
  let products = state.products;
  const listItem = itemId ? items.find((i) => i.id === itemId) : undefined;
  let product = (listItem?.productId && catalog.productById.get(listItem.productId)) || catalog.exact(listItem?.name ?? name);
  if (!product) {
    // New to the master list: keep the name as typed, borrow a similar item's category.
    const similar = catalog.match(listItem?.name ?? name);
    product = { id: `p-${newId()}`, name: capitalize((listItem?.name ?? name).trim()), ...(similar?.categoryId && { categoryId: similar.categoryId }) };
    products = [...products, product];
  }
  const pid = product.id;
  const itemName = product.name;
  const category = product.categoryId ? catalog.categoryById.get(product.categoryId) : undefined;
  const plan = planBuild(layout, at, category, 'vertical', target);

  const savedKey = product.locations?.[layout.id];
  const saved = savedKey ? resolveSpot(savedKey, layout, catalog) : undefined;
  const conflict = !!saved && saved.placeId !== plan.placeId;
  // On open floor with shelves lined up further away: let the shopper choose.
  const options = !conflict && (plan.action === 'create' || plan.action === 'createArea') ? extendCandidates(layout, at) : [];

  let next = layout;
  if (!conflict && !options.length && plan.action !== 'blocked') {
    next = plan.layout;
    products = rekeyAll(products, layout.id, plan.rekey).map((p) => (p.id === pid
      ? { ...p, locations: { ...p.locations, [layout.id]: plan.spotKey! }, notAt: p.notAt?.filter((id) => id !== layout.id) }
      : p));
  }

  const waiting = listItem ?? items.find((i) => !i.done && (i.productId === pid || catalog.exact(i.name)?.id === pid));
  const nextItems = waiting
    ? items.map((i) => (i.id === waiting.id ? { ...i, done: true, productId: pid } : i))
    : [...items, { id: newId(), name: itemName, done: true, productId: pid }];

  const outcome: PickUpOutcome = conflict
    ? { kind: 'conflict', productId: pid, itemName, savedKey: savedKey! }
    : options.length
      ? { kind: 'choose', productId: pid, itemName, at, options }
    : plan.action === 'blocked'
      ? { kind: 'blocked', itemName, productId: pid }
      : { kind: 'built', action: plan.action, placeId: plan.placeId!, label: plan.label, itemName, productId: pid };
  return { layout: next, products, items: nextItems, outcome };
}

/** Places an item picked up at `at` (after a conflict or a choice): build there and save its spot. */
export function moveHere(
  state: { products: Product[]; layout: StoreLayout; catalog: Catalog }, productId: string, at: Point,
  choice: BuildTarget | BuildChoice = 'shelf',
): { layout: StoreLayout; products: Product[]; plan: BuildPlan } | undefined {
  const product = state.catalog.productById.get(productId);
  if (!product) return undefined;
  const category = product.categoryId ? state.catalog.categoryById.get(product.categoryId) : undefined;
  const plan = planChoice(state.layout, at, category, choice);
  if (plan.action === 'blocked') return { layout: state.layout, products: state.products, plan };
  const lid = state.layout.id;
  const products = rekeyAll(state.products, lid, plan.rekey).map((p) => (p.id === productId
    ? { ...p, locations: { ...p.locations, [lid]: plan.spotKey! } }
    : p));
  return { layout: plan.layout, products, plan };
}
