import { aisleNumber, DEPTS } from './clues';
import { footprint } from './geometry';
import type { AisleLabel, AislePos, Area, Arrangement, Clue, Dept, GeneratedMap, Place, Product, Rect, Shelf, StoreLayout } from './types';

/**
 * Building a store map from shoppers' "Where was it?" answers.
 *
 * 1. The answers become a model of the store: which aisles exist (all from 1
 *    up to the highest number heard), what's on each side of each aisle, and
 *    which departments there are.
 * 2. The model becomes a map in the shape of a typical supermarket: numbered
 *    aisles of back-to-back shelves across the middle (aisle 1 nearest the
 *    entrance), Produce along the entrance-side wall, Frozen along the far
 *    wall, the other departments along the back, checkout across the front.
 *
 * Generated parts have stable ids ("g-…"). Anything the shopper changes or
 * deletes is listed in `gen.locked` and never regenerated; places they add
 * themselves are left alone, and generated parts that would overlap them
 * are skipped.
 */

/** Squares along each aisle. */
export const AISLE_LENGTH = 14;
/** The other departments, in order along the back wall from the entrance side. */
export const BACK_WALL: Dept[] = ['bakery', 'deli', 'meat', 'seafood', 'dairy'];
const FRONT_CORNER_NEAR: Dept[] = ['floral'];
const FRONT_CORNER_FAR: Dept[] = ['pharmacy'];

interface AisleModel {
  /** As said ("7", "12B"). */
  label: string;
  /** Mentioned in an answer (otherwise it's a guess filling a gap). */
  seen: boolean;
  freezer: boolean;
  /** Fridges along it (and not freezers). */
  chilled?: boolean;
  /** Categories on each side, with how far along (for ordering). */
  sides: { L: { categoryId: string; pos: AislePos }[]; R: { categoryId: string; pos: AislePos }[] };
}

export interface StoreModel {
  aisles: AisleModel[];
  depts: Dept[];
  freezerWall: boolean;
  checkout: boolean;
}

const POS_ORDER: Record<AislePos, number> = { front: 0, middle: 1, back: 2 };

/** What the answers for one store say about it. */
export function buildModel(products: Product[], layoutId: string): StoreModel {
  const aisles = new Map<string, AisleModel>();
  const depts = new Set<Dept>();
  let freezerWall = false;
  let checkout = false;
  const aisle = (label: string) => {
    const key = label.trim().toUpperCase();
    let a = aisles.get(key);
    if (!a) aisles.set(key, (a = { label: key, seen: true, freezer: false, sides: { L: [], R: [] } }));
    return a;
  };
  for (const p of products) {
    const c: Clue | undefined = p.clues?.[layoutId];
    if (!c) continue;
    switch (c.kind) {
      case 'aisle':
      case 'freezer': {
        if (!c.aisle) {
          freezerWall = true;
          break;
        }
        const a = aisle(c.aisle);
        if (c.kind === 'freezer' || c.temp === 'frozen') a.freezer = true;
        else if (c.kind === 'aisle' && c.temp === 'chilled') a.chilled = true;
        if (p.categoryId) a.sides[c.side ?? 'L'].push({ categoryId: p.categoryId, pos: c.pos ?? 'middle' });
        break;
      }
      case 'endcap': aisle(c.aisle); break;
      case 'wall': if (c.temp === 'frozen') freezerWall = true; break;
      case 'display':
        if (c.aisle) aisle(c.aisle);
        if (c.dept) depts.add(c.dept);
        break;
      case 'dept': depts.add(c.dept); break;
      case 'checkout': checkout = true; break;
    }
  }
  // Every aisle from 1 to the highest heard; letters (12A, 12B) stand in for their number.
  const seen = [...aisles.values()];
  const max = Math.max(0, ...seen.map((a) => Math.floor(aisleNumber(a.label))).filter((n) => !Number.isNaN(n)));
  const all: AisleModel[] = [];
  for (let n = 1; n <= max; n++) {
    const these = seen.filter((a) => Math.floor(aisleNumber(a.label)) === n).sort((a, b) => aisleNumber(a.label) - aisleNumber(b.label));
    all.push(...(these.length ? these : [{ label: String(n), seen: false, freezer: false, sides: { L: [], R: [] } }]));
  }
  // Aisles with names that aren't numbers go after the numbered ones.
  all.push(...seen.filter((a) => Number.isNaN(aisleNumber(a.label))));
  if (freezerWall) depts.add('frozen');
  return { aisles: all, depts: [...depts], freezerWall, checkout };
}

/** What a map is generated with: the entrance corner and the arrangement. */
export type GenSettings = Arrangement & { entrance: GeneratedMap['entrance'] };

/** A short fingerprint of what a map would be generated from. */
export function modelKey(model: StoreModel, settings: GenSettings): string {
  return JSON.stringify({
    e: settings.entrance,
    // Only when not the usual, so maps made before these settings existed aren't rebuilt.
    ...(settings.aisleOne === 'far' && { a1: 'far' }),
    ...(settings.produce === 'far' && { p: 'far' }),
    ...(settings.backWall === 'reversed' && { b: 'rev' }),
    a: model.aisles.map((a) => [a.label, a.seen ? 1 : 0, a.freezer ? 1 : a.chilled ? 2 : 0, cats(a, 'L'), cats(a, 'R')]),
    d: [...model.depts].sort(),
    c: model.checkout,
  });
}

/** Categories on one side of an aisle, ordered top to bottom of the map (back of the store first). */
function cats(a: AisleModel, side: 'L' | 'R'): string[] {
  const sorted = [...a.sides[side]].sort((x, y) => POS_ORDER[y.pos] - POS_ORDER[x.pos]);
  return [...new Set(sorted.map((s) => s.categoryId))];
}

const deptInfo = (d: Dept) => DEPTS.find((x) => x.id === d)!;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The generated parts of a map for a model (ids "g-…"), and the store's size, entrance and checkout. */
export function generateParts(model: StoreModel, entrance: GeneratedMap['entrance'], arrangement: Arrangement = {}) {
  const n = model.aisles.length;
  const L = AISLE_LENGTH;
  const x0 = 6; // first shelf column (side wall area x 1–4, walkway at x 5)
  const width = 4 * n + 12;
  const height = L + 13;
  const yShelf = 6;
  const mirror = (r: Rect): Rect => (entrance === 'left' ? r : { ...r, x: width - r.x - r.w });
  const places: Place[] = [];
  const aisles: AisleLabel[] = [];

  // Aisles, numbered from the entrance side (or from the far side). Slot i (from the left) holds shelves at x0+4i (left side) and x0+4i+3 (right side).
  model.aisles.forEach((a, k) => {
    const fromEntrance = arrangement.aisleOne === 'far' ? n - 1 - k : k;
    const slot = entrance === 'left' ? fromEntrance : n - 1 - fromEntrance;
    const walk: Rect = { x: x0 + 1 + 4 * slot, y: yShelf, w: 2, h: L };
    aisles.push({ id: `g-aisle-${a.label}`, label: `Aisle ${a.label}`, ...walk, ...(a.seen ? {} : { guess: true }) });
    for (const side of ['L', 'R'] as const) {
      // Walking up the aisle from the front, left is the smaller x.
      const x = side === 'L' ? walk.x - 1 : walk.x + 2;
      const shelf: Shelf = {
        kind: 'shelf', id: `g-shelf-${a.label}-${side}`, label: `${a.label}${side}`,
        orientation: 'vertical', x, y: yShelf, length: L, categories: cats(a, side), ...(a.seen ? {} : { guess: true }),
        ...(a.freezer ? { temp: 'frozen' as const } : a.chilled ? { temp: 'chilled' as const } : {}),
      };
      places.push(shelf);
    }
  });

  // Departments: Produce up the entrance-side wall, Frozen up the far wall (or swapped), the rest along the back.
  const area = (d: Dept, r: Rect): Area => ({ kind: 'area', id: `g-dept-${d}`, label: deptInfo(d).name, ...mirror(r), categories: [...deptInfo(d).categories] });
  const nearWall = 1;
  const farWall = width - 5;
  const produceFar = arrangement.produce === 'far';
  if (model.depts.includes('produce')) places.push(area('produce', { x: produceFar ? farWall : nearWall, y: yShelf, w: 4, h: L }));
  if (model.depts.includes('frozen')) places.push(area('frozen', { x: produceFar ? nearWall : farWall, y: yShelf, w: 4, h: L }));
  const back = BACK_WALL.filter((d) => model.depts.includes(d));
  if (arrangement.backWall === 'reversed') back.reverse();
  if (back.length) {
    const span = width - 2;
    back.forEach((d, i) => {
      const x = 1 + Math.floor((i * span) / back.length);
      const x2 = 1 + Math.floor(((i + 1) * span) / back.length);
      places.push(area(d, { x, y: 1, w: x2 - x, h: 3 }));
    });
  }
  const front = yShelf + L + 3; // below the front cross aisle
  for (const d of FRONT_CORNER_NEAR) if (model.depts.includes(d)) places.push(area(d, { x: 1, y: front, w: 4, h: 3 }));
  for (const d of FRONT_CORNER_FAR) if (model.depts.includes(d)) places.push(area(d, { x: width - 5, y: front, w: 4, h: 3 }));
  if (model.checkout) {
    places.push({ kind: 'area', id: 'g-checkout', label: 'Checkout', x: Math.floor(width / 2) - 4, y: front, w: 8, h: 2, categories: [] });
  }
  const entrancePoint = mirror({ x: 2, y: height - 1, w: 1, h: 1 });
  return {
    width, height, places, aisles,
    entrance: { x: entrancePoint.x, y: entrancePoint.y },
    checkout: { x: Math.floor(width / 2), y: height - 2 },
  };
}

/**
 * The store's map regenerated from the model, keeping what the shopper made
 * or changed: their own places, and generated parts listed in `gen.locked`
 * (as they are now, or gone if deleted). Generated parts that would overlap
 * the shopper's own places are left out.
 */
export function regenerate(layout: StoreLayout, model: StoreModel): StoreLayout {
  const gen: GeneratedMap = layout.gen ?? { enabled: true, entrance: 'left', locked: [] };
  const parts = generateParts(model, gen.entrance, gen);
  const locked = new Set(gen.locked);
  const isGenerated = (id: string) => id.startsWith('g-');
  const kept = layout.places.filter((p) => !isGenerated(p.id) || locked.has(p.id));
  const keptAisles = (layout.aisles ?? []).filter((a) => !isGenerated(a.id) || locked.has(a.id));
  const taken = kept.map(footprint);
  const places = [
    ...kept,
    ...parts.places.filter((p) => !locked.has(p.id) && !taken.some((t) => overlaps(t, footprint(p)))),
  ];
  const aisles = [...keptAisles, ...parts.aisles.filter((a) => !locked.has(a.id) && !keptAisles.some((k) => overlaps(k, a)))];
  // Big enough for everything kept, too.
  const width = Math.max(parts.width, ...kept.map((p) => { const f = footprint(p); return f.x + f.w + 1; }));
  const height = Math.max(parts.height, ...kept.map((p) => { const f = footprint(p); return f.y + f.h + 1; }));
  return {
    ...layout,
    width,
    height,
    places,
    aisles,
    entrance: locked.has('g-entrance') ? layout.entrance : parts.entrance,
    checkout: locked.has('g-checkout-point') ? layout.checkout : parts.checkout,
    gen: { ...gen, key: modelKey(model, gen) },
  };
}

/**
 * Generated parts the shopper has changed or deleted between two versions
 * of a store (so they're kept as they are from now on). The entrance and
 * checkout count as "g-entrance" and "g-checkout-point".
 */
export function newlyEdited(before: StoreLayout, after: StoreLayout): string[] {
  if (!before.gen?.enabled) return [];
  // The whole store moving together (it grew left or up) isn't an edit.
  const b0 = before.places[0];
  const a0 = b0 && after.places.find((p) => p.id === b0.id);
  if (b0 && a0 && (a0.x !== b0.x || a0.y !== b0.y)) {
    const dx = a0.x - b0.x;
    const dy = a0.y - b0.y;
    const shifted = before.places.every((p) => {
      const q = after.places.find((x) => x.id === p.id);
      return q && q.x - p.x === dx && q.y - p.y === dy;
    });
    if (shifted && after.places.length === before.places.length) return [];
  }
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const afterPlaces = new Map(after.places.map((p) => [p.id, p]));
  for (const p of before.places) {
    if (!p.id.startsWith('g-')) continue;
    const now = afterPlaces.get(p.id);
    if (!now || !same(p, now)) out.push(p.id);
  }
  const afterAisles = new Map((after.aisles ?? []).map((a) => [a.id, a]));
  for (const a of before.aisles ?? []) {
    if (!a.id.startsWith('g-')) continue;
    const now = afterAisles.get(a.id);
    if (!now || !same(a, now)) out.push(a.id);
  }
  if (!same(before.entrance, after.entrance)) out.push('g-entrance');
  if (!same(before.checkout, after.checkout)) out.push('g-checkout-point');
  return out.filter((id) => !before.gen!.locked.includes(id));
}
