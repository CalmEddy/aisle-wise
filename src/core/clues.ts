import { exactKey, footprint } from './geometry';
import type { AisleLabel, AislePos, AisleSide, Clue, Dept, Point, Product, Shelf, StoreLayout } from './types';

/**
 * Plain-language item locations ("aisle 7, left, middle", "Produce"): what
 * shoppers can tell us at the shelf, with or without a map. They sort the
 * list on their own, and land on the map wherever it has matching aisle
 * labels or departments.
 */

export const DEPTS: { id: Dept; name: string; icon: string; categories: string[] }[] = [
  { id: 'produce', name: 'Produce', icon: '🥬', categories: ['fruit', 'veg'] },
  { id: 'floral', name: 'Floral', icon: '💐', categories: ['floral'] },
  { id: 'bakery', name: 'Bakery', icon: '🍞', categories: ['bakery'] },
  { id: 'deli', name: 'Deli', icon: '🧀', categories: ['deli'] },
  { id: 'meat', name: 'Meat', icon: '🥩', categories: ['meat'] },
  { id: 'seafood', name: 'Seafood', icon: '🐟', categories: ['seafood'] },
  { id: 'dairy', name: 'Dairy', icon: '🥛', categories: ['dairy', 'eggs'] },
  { id: 'frozen', name: 'Frozen', icon: '🧊', categories: ['frozen', 'icecream'] },
  { id: 'pharmacy', name: 'Pharmacy', icon: '💊', categories: ['pharmacy'] },
];
const deptOf = (id: Dept) => DEPTS.find((d) => d.id === id)!;

/** The department an item's category usually belongs to (e.g. Fruit → Produce). */
export function guessDept(categoryId?: string): Dept | undefined {
  return categoryId ? DEPTS.find((d) => d.categories.includes(categoryId))?.id : undefined;
}

/** "12" → 12, "12B" → 12.2, "" → NaN. */
export function aisleNumber(aisle: string): number {
  const m = /^\s*(\d+)\s*([a-z])?/i.exec(aisle);
  if (!m) return NaN;
  return Number(m[1]) + (m[2] ? (m[2].toLowerCase().charCodeAt(0) - 96) / 10 : 0);
}

const POS_WORD: Record<AislePos, string> = { front: 'front', middle: 'middle', back: 'back' };
const SIDE_WORD: Record<AisleSide, string> = { L: 'left', R: 'right' };

/** "Aisle 7 · left · middle", "Produce", "Freezer, aisle 14", "End of aisle 7 (front)". */
export function describeClue(c: Clue): string {
  const detail = (side?: AisleSide, pos?: AislePos) => [side && SIDE_WORD[side], pos && POS_WORD[pos]].filter(Boolean).join(' · ');
  const withDetail = (head: string, side?: AisleSide, pos?: AislePos) => {
    const d = detail(side, pos);
    return d ? `${head} · ${d}` : head;
  };
  switch (c.kind) {
    case 'aisle': return withDetail(`Aisle ${c.aisle}`, c.side, c.pos);
    case 'dept': return deptOf(c.dept).name;
    case 'freezer': return c.aisle ? withDetail(`Freezer, aisle ${c.aisle}`, c.side, c.pos) : 'Freezer wall';
    case 'endcap': return `End of aisle ${c.aisle} (${c.end})`;
    case 'display': return c.aisle ? `Display near aisle ${c.aisle}` : c.dept ? `Display in ${deptOf(c.dept).name}` : 'Display';
    case 'checkout': return 'Checkout';
  }
}

/**
 * Where a clue falls in a typical walk round a store, for sorting a list
 * with no map: front departments, then the aisles in number order (front
 * end-caps, front, middle, back, back end-caps), then the back and side
 * departments, then checkout.
 */
const FRONT: Partial<Record<Dept, number>> = { produce: 0, floral: 1, bakery: 2, deli: 3 };
const BACK: Partial<Record<Dept, number>> = { meat: 9000, seafood: 9001, dairy: 9002, frozen: 9003, pharmacy: 9500 };
const deptRank = (d: Dept) => FRONT[d] ?? BACK[d] ?? 9400;
const POS_RANK: Record<AislePos, number> = { front: 2, middle: 4, back: 6 };

export function clueRank(c: Clue): number {
  const aisle = (a: string, offset: number) => {
    const n = aisleNumber(a);
    return Number.isNaN(n) ? 8500 : 100 + n * 10 + offset;
  };
  switch (c.kind) {
    case 'aisle':
    case 'freezer':
      return c.aisle ? aisle(c.aisle, POS_RANK[c.pos ?? 'middle']) : 8800;
    case 'endcap': return aisle(c.aisle, c.end === 'front' ? 1 : 7);
    case 'display': return c.aisle ? aisle(c.aisle, 4) : c.dept ? deptRank(c.dept) + 0.5 : 8900;
    case 'dept': return deptRank(c.dept);
    case 'checkout': return 9999;
  }
}

// ---------------------------------------------------------------------------
// Matching a clue to the map

/** The aisle label for an aisle number ("Aisle 7", "7", "Aisle 12B"). */
export function findAisle(l: StoreLayout, aisle: string): AisleLabel | undefined {
  const want = aisle.trim().toLowerCase().replace(/[^0-9a-z]/g, '').replace(/^0+(?=\d)/, '');
  if (!want) return undefined;
  const re = new RegExp(`(^|[^0-9a-z])0*${want}($|[^0-9a-z])`, 'i');
  return (l.aisles ?? []).find((a) => re.test(a.label.toLowerCase()));
}

/**
 * The shelf on one side of an aisle and how far along it, as seen walking
 * in from the end of the aisle nearest the entrance.
 */
function aisleSpot(l: StoreLayout, a: AisleLabel, side: AisleSide | undefined, along: number): string | undefined {
  const vertical = a.h >= a.w;
  // Which end is the front: the one nearer the entrance.
  const ends = vertical
    ? [{ x: a.x + a.w / 2, y: a.y }, { x: a.x + a.w / 2, y: a.y + a.h }]
    : [{ x: a.x, y: a.y + a.h / 2 }, { x: a.x + a.w, y: a.y + a.h / 2 }];
  const dist = (p: Point) => Math.hypot(p.x - l.entrance.x, p.y - l.entrance.y);
  const frontIsStart = dist(ends[0]) <= dist(ends[1]);
  // Walking from the front: the forward direction, and which side is left.
  const forward = frontIsStart ? 1 : -1;
  // Facing +y (down the map) left is +x; facing -y left is -x. Facing +x left is -y; facing -x left is +y.
  const leftIsLow = vertical ? forward < 0 : forward > 0;
  const sides: AisleSide[] = side ? [side] : ['L', 'R'];
  for (const s of sides) {
    const low = (s === 'L') === leftIsLow;
    const across = vertical ? (low ? a.x - 1 : a.x + a.w) : (low ? a.y - 1 : a.y + a.h);
    const t = frontIsStart ? along : 1 - along;
    const at = vertical ? { x: across, y: Math.min(a.y + a.h - 1, Math.floor(a.y + t * a.h)) } : { x: Math.min(a.x + a.w - 1, Math.floor(a.x + t * a.w)), y: across };
    const shelf = l.places.find((p): p is Shelf => {
      if (p.kind !== 'shelf') return false;
      const f = footprint(p);
      return at.x >= f.x && at.x < f.x + f.w && at.y >= f.y && at.y < f.y + f.h;
    });
    if (!shelf) continue;
    const start = shelf.orientation === 'vertical' ? shelf.y : shelf.x;
    const u = ((shelf.orientation === 'vertical' ? at.y : at.x) - start + 0.5) / shelf.length;
    return exactKey(shelf.id, { u, v: 0.5 });
  }
  return undefined;
}

const ALONG: Record<AislePos, number> = { front: 0.15, middle: 0.5, back: 0.85 };

/** A place that is this department: named for it, or stocking its categories. */
function findDept(l: StoreLayout, dept: Dept, categoryId?: string): string | undefined {
  const d = deptOf(dept);
  const named = l.places.find((p) => p.label.toLowerCase().includes(d.name.toLowerCase()));
  if (named) return named.id;
  const cats = categoryId && d.categories.includes(categoryId) ? [categoryId, ...d.categories] : d.categories;
  for (const c of cats) {
    const p = l.places.find((pl) => pl.categories.includes(c));
    if (p) return `${p.id}:${c}`;
  }
  return undefined;
}

/** The map spot a clue points to in this store, if the map has what it needs (aisle labels, departments). */
export function resolveClue(c: Clue, l: StoreLayout, product?: Pick<Product, 'categoryId'>): string | undefined {
  const inAisle = (aisle: string, side: AisleSide | undefined, along: number) => {
    const a = findAisle(l, aisle);
    return a ? aisleSpot(l, a, side, along) : undefined;
  };
  switch (c.kind) {
    case 'aisle': return inAisle(c.aisle, c.side, ALONG[c.pos ?? 'middle']);
    case 'freezer': return c.aisle ? inAisle(c.aisle, c.side, ALONG[c.pos ?? 'middle']) : findDept(l, 'frozen', product?.categoryId);
    case 'endcap': return inAisle(c.aisle, undefined, c.end === 'front' ? 0.02 : 0.98);
    case 'display': return c.aisle ? inAisle(c.aisle, undefined, 0.5) : c.dept ? findDept(l, c.dept, product?.categoryId) : undefined;
    case 'dept': return findDept(l, c.dept, product?.categoryId);
    case 'checkout': return undefined;
  }
}

/** Aisle numbers used in this store's clues, most used first (for quick picks). */
export function aislesUsed(products: Product[], layoutId: string): string[] {
  const n = new Map<string, number>();
  for (const p of products) {
    const c = p.clues?.[layoutId];
    const a = c && 'aisle' in c ? c.aisle : undefined;
    if (a) n.set(a, (n.get(a) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || aisleNumber(a[0]) - aisleNumber(b[0])).map(([a]) => a);
}
