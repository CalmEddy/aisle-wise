import { exactKey, exactSpotAt, footprint } from './geometry';
import type { AisleLabel, AislePos, AisleSide, Clue, Dept, OpenNear, Place, Point, Product, Rect, Shelf, StoreLayout, Temp, Wall, WallPart } from './types';

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
export const WALL_WORD: Record<Wall, string> = { left: 'Left', back: 'Back', right: 'Right' };
export const NEAR_WORD: Record<OpenNear, string> = { entrance: 'near the door', middle: 'in the middle', far: 'on the far side' };
const FIXTURE_WORD = { table: 'Table', case: 'Case', stand: 'Stand' } as const;

/** "Aisle 7 · left · middle", "Produce", "Freezer, aisle 14", "End of aisle 7 (front)". */
export function describeClue(c: Clue): string {
  const detail = (side?: AisleSide, pos?: AislePos) => [side && SIDE_WORD[side], pos && POS_WORD[pos]].filter(Boolean).join(' · ');
  const withDetail = (head: string, side?: AisleSide, pos?: AislePos) => {
    const d = detail(side, pos);
    return d ? `${head} · ${d}` : head;
  };
  const cold = (t?: Temp) => (t === 'frozen' ? 'Freezer, ' : t === 'chilled' ? 'Fridge, ' : '');
  switch (c.kind) {
    case 'aisle': return withDetail(c.temp ? `${cold(c.temp)}aisle ${c.aisle}` : `Aisle ${c.aisle}`, c.side, c.pos);
    case 'wall': {
      const head = `${WALL_WORD[c.wall]} wall${c.part && c.part !== 'middle' ? ` · ${c.part}` : c.part ? ' · middle' : ''}`;
      return c.temp ? `${cold(c.temp)}${head.toLowerCase()}` : head;
    }
    case 'open': {
      const what = c.fixture ? FIXTURE_WORD[c.fixture] : 'Out in the open';
      const where = c.aisle ? `by aisle ${c.aisle}` : c.near ? NEAR_WORD[c.near] : '';
      const head = [what, where].filter(Boolean).join(' ');
      return c.temp ? `${cold(c.temp)}${head[0].toLowerCase()}${head.slice(1)}` : head;
    }
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
const WALL_ORDER: Record<Wall, number> = { left: 0, back: 1, right: 2 };
/** Going round the walls: up the left wall (front first), along the back left to right, down the right wall. */
const partRank = (w: Wall, p?: WallPart) => {
  const along = p === 'front' || p === 'left' ? 0 : p === 'back' || p === 'right' ? 2 : 1;
  return w === 'right' ? 2 - along : along;
};

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
    // Walls: after the aisles, round from the left wall's front to the right wall's front.
    case 'wall': return 9100 + WALL_ORDER[c.wall] * 10 + partRank(c.wall, c.part);
    case 'open': return c.aisle ? aisle(c.aisle, 0) : c.near === 'entrance' ? 5 : c.near === 'far' ? 8700 : 4900;
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
    const target = vertical ? { x: across, y: Math.min(a.y + a.h - 1, Math.floor(a.y + t * a.h)) } : { x: Math.min(a.x + a.w - 1, Math.floor(a.x + t * a.w)), y: across };
    const shelfAt = (q: Point) => l.places.find((p): p is Shelf => {
      if (p.kind !== 'shelf') return false;
      const f = footprint(p);
      return q.x >= f.x && q.x < f.x + f.w && q.y >= f.y && q.y < f.y + f.h;
    });
    // The shelf beside that spot, or (if it falls in a gap, e.g. a cross aisle) the nearest one along the aisle.
    let at = target;
    let shelf = shelfAt(at);
    const run = vertical ? a.h : a.w;
    for (let d = 1; !shelf && d < run; d++) {
      for (const sign of [1, -1]) {
        const q = vertical ? { x: target.x, y: target.y + sign * d } : { x: target.x + sign * d, y: target.y };
        const inside = vertical ? q.y >= a.y && q.y < a.y + a.h : q.x >= a.x && q.x < a.x + a.w;
        const hit = inside ? shelfAt(q) : undefined;
        if (hit) { shelf = hit; at = q; break; }
      }
    }
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
    case 'wall': return onWall(l, c.wall, c.part, c.temp);
    case 'open': return c.aisle ? inAisle(c.aisle, undefined, 0.02) : inOpen(l, c.near, c.temp);
    case 'display': return c.aisle ? inAisle(c.aisle, undefined, 0.5) : c.dept ? findDept(l, c.dept, product?.categoryId) : undefined;
    case 'dept': return findDept(l, c.dept, product?.categoryId);
    case 'checkout': return l.places.find((p) => /checkout/i.test(p.label))?.id;
  }
}

// ---------------------------------------------------------------------------
// Walls and open floor, as you face into the store from the entrance

/**
 * The store seen from the entrance: `toMap(u, v)` turns "across" (u: 0 left
 * wall → 1 right wall) and "deep" (v: 0 front → 1 back) into map squares.
 * The front is the edge of the map nearest the entrance.
 */
export function storeFrame(l: StoreLayout) {
  const W = l.width;
  const H = l.height;
  const e = l.entrance;
  const edges = [
    { front: 'bottom', d: H - 1 - e.y },
    { front: 'top', d: e.y },
    { front: 'left', d: e.x },
    { front: 'right', d: W - 1 - e.x },
  ].sort((a, b) => a.d - b.d);
  const front = edges[0].front;
  const toMap = (u: number, v: number): Point => {
    switch (front) {
      case 'top': return { x: (1 - u) * W, y: v * H };
      case 'left': return { x: v * W, y: u * H };
      case 'right': return { x: (1 - v) * W, y: (1 - u) * H };
      default: return { x: u * W, y: (1 - v) * H };
    }
  };
  const toStore = (p: Point) => {
    switch (front) {
      case 'top': return { u: 1 - p.x / W, v: p.y / H };
      case 'left': return { u: p.y / H, v: p.x / W };
      case 'right': return { u: 1 - p.y / H, v: 1 - p.x / W };
      default: return { u: p.x / W, v: 1 - p.y / H };
    }
  };
  /** How far (squares) a rectangle is from a wall. */
  const fromWall = (r: Rect, wall: Wall) => {
    const corners = [toStore({ x: r.x, y: r.y }), toStore({ x: r.x + r.w, y: r.y + r.h })];
    const across = front === 'left' || front === 'right' ? H : W;
    const deep = front === 'left' || front === 'right' ? W : H;
    if (wall === 'left') return Math.min(...corners.map((c) => c.u)) * across;
    if (wall === 'right') return (1 - Math.max(...corners.map((c) => c.u))) * across;
    return (1 - Math.max(...corners.map((c) => c.v))) * deep;
  };
  return { front, toMap, toStore, fromWall };
}

/** Where on a wall a part is, in store terms (u across, v deep). */
function wallTarget(wall: Wall, part?: WallPart): { u: number; v: number } {
  const along = part === 'front' || part === 'left' ? 0.2 : part === 'back' || part === 'right' ? 0.8 : 0.5;
  if (wall === 'left') return { u: 0, v: along };
  if (wall === 'right') return { u: 1, v: along };
  return { u: along, v: 1 };
}

/** Squares from a point to the nearest square of a rectangle. */
const gap = (p: Point, r: Rect) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
/** Prefer a matching fridge/freezer; anything else costs extra. */
const tempCost = (p: Place, t?: Temp) => (t && p.temp !== t ? 25 : 0);
/** Places within this many squares of a wall are "along" it. */
export const WALL_REACH = 6;

function nearest(target: Point, places: Place[], t?: Temp): string | undefined {
  let best: Place | undefined;
  let bestCost = Infinity;
  for (const p of places) {
    const cost = gap(target, footprint(p)) + tempCost(p, t);
    if (cost < bestCost) { best = p; bestCost = cost; }
  }
  if (!best) return undefined;
  const f = footprint(best);
  const x = Math.max(f.x, Math.min(f.x + f.w, target.x));
  const y = Math.max(f.y, Math.min(f.y + f.h, target.y));
  return exactKey(best.id, exactSpotAt(best, x, y));
}

/** The place along a wall nearest the part said (a matching fridge or freezer if there is one). */
function onWall(l: StoreLayout, wall: Wall, part?: WallPart, t?: Temp): string | undefined {
  const frame = storeFrame(l);
  const tgt = wallTarget(wall, part);
  const along = l.places.filter((p) => frame.fromWall(footprint(p), wall) <= WALL_REACH && !/checkout/i.test(p.label));
  return nearest(frame.toMap(tgt.u, tgt.v), along, t);
}

/** A table, case or stand out on the floor (not along a wall) nearest the spot said. */
function inOpen(l: StoreLayout, near?: OpenNear, t?: Temp): string | undefined {
  const frame = storeFrame(l);
  const door = frame.toStore(l.entrance);
  const target = near === 'entrance' ? frame.toMap(door.u, 0.15)
    : near === 'far' ? frame.toMap(1 - door.u, 0.15)
      : frame.toMap(0.5, 0.5);
  const walls: Wall[] = ['left', 'back', 'right'];
  const open = l.places.filter((p) => {
    const f = footprint(p);
    const short = p.kind === 'area' || p.length <= 8;
    return short && walls.every((w) => frame.fromWall(f, w) > 3) && !/checkout/i.test(p.label);
  });
  return nearest(target, open, t);
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

// ---------------------------------------------------------------------------
// Typical store order (no answers yet)

/** Centre-store categories in the order a typical supermarket's aisles run. */
const CENTRE_ORDER = ['breakfast', 'coffee', 'baking', 'pasta', 'canned', 'condiments', 'snacks', 'cookies', 'soda', 'water', 'paper', 'laundry', 'health', 'baby'];

/**
 * Where a category usually is in a walk round a store, on the same scale as
 * clueRank: departments in their usual place, centre-store categories after
 * any numbered aisles (we don't know their numbers) but before the back
 * departments. Unknown categories go just before the back.
 */
export function typicalRank(categoryId: string): number {
  const dept = guessDept(categoryId);
  if (dept) return deptRank(dept);
  const i = CENTRE_ORDER.indexOf(categoryId);
  return 5000 + (i < 0 ? CENTRE_ORDER.length : i);
}
