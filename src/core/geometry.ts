import type { Aisle, Place, Point, Rect, StoreLayout } from './types';

/** The full rectangle a place occupies, shelves included. */
export function footprint(p: Place): Rect {
  if (p.kind === 'area') return { x: p.x, y: p.y, w: p.w, h: p.h };
  return p.orientation === 'vertical'
    ? { x: p.x, y: p.y, w: p.width + 2, h: p.length }
    : { x: p.x, y: p.y, w: p.length, h: p.width + 2 };
}

/** The walkable part of a place. */
export function walkway(p: Place): Rect {
  if (p.kind === 'area') return footprint(p);
  return p.orientation === 'vertical'
    ? { x: p.x + 1, y: p.y, w: p.width, h: p.length }
    : { x: p.x, y: p.y + 1, w: p.length, h: p.width };
}

/** The two shelf strips along an aisle's long sides. Areas have none. */
export function shelves(p: Place): Rect[] {
  if (p.kind === 'area') return [];
  const f = footprint(p);
  return p.orientation === 'vertical'
    ? [{ x: f.x, y: f.y, w: 1, h: f.h }, { x: f.x + f.w - 1, y: f.y, w: 1, h: f.h }]
    : [{ x: f.x, y: f.y, w: f.w, h: 1 }, { x: f.x, y: f.y + f.h - 1, w: f.w, h: 1 }];
}

/**
 * Where the `index`-th of `count` things stocked in a place sits. Things are
 * spread evenly along the aisle (or the long side of an area).
 */
export function spotPoint(p: Place, index = 0, count = 1): Point {
  const r = walkway(p);
  const t = (index + 0.5) / Math.max(1, count);
  const alongX = p.kind === 'aisle' ? p.orientation === 'horizontal' : r.w >= r.h;
  return alongX
    ? { x: r.x + Math.min(r.w - 1, Math.floor(t * r.w)), y: r.y + Math.floor((r.h - 1) / 2) }
    : { x: r.x + Math.floor((r.w - 1) / 2), y: r.y + Math.min(r.h - 1, Math.floor(t * r.h)) };
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

/** The place under a floor square, if any (last drawn wins). */
export function placeAt(layout: StoreLayout, p: Point): Place | undefined {
  for (let i = layout.places.length - 1; i >= 0; i--) {
    if (contains(footprint(layout.places[i]), p)) return layout.places[i];
  }
  return undefined;
}

/** Keeps a place inside the store walls. */
export function clampPlace<T extends Place>(p: T, layout: Pick<StoreLayout, 'width' | 'height'>): T {
  const f = footprint(p);
  const x = Math.max(0, Math.min(layout.width - f.w, p.x));
  const y = Math.max(0, Math.min(layout.height - f.h, p.y));
  return { ...p, x, y };
}

export function isAisle(p: Place): p is Aisle {
  return p.kind === 'aisle';
}

// ---------------------------------------------------------------------------
// Exact spots
//
// An exact spot is saved relative to its place so it survives moving or
// resizing the place: key `placeId@u,v`.
//   Aisles: u = how far along (0 = top/left end, 1 = bottom/right end);
//           v = side: 0 = left/top shelf, 1 = right/bottom shelf, 0.5 = either.
//   Areas:  u, v = how far across and down (0..1).

export interface ExactSpot {
  u: number;
  v: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round = (n: number) => Math.round(n * 1000) / 1000;

export function exactKey(placeId: string, s: ExactSpot): string {
  return `${placeId}@${round(s.u)},${round(s.v)}`;
}

export function parseExactKey(key: string): { placeId: string; spot: ExactSpot } | undefined {
  const m = /^(.+)@(-?[\d.]+),(-?[\d.]+)$/.exec(key);
  if (!m) return undefined;
  const u = Number(m[2]);
  const v = Number(m[3]);
  if (!Number.isFinite(u) || !Number.isFinite(v)) return undefined;
  return { placeId: m[1], spot: { u: clamp01(u), v: clamp01(v) } };
}

/**
 * The exact spot under a point on the map (grid units, fractions allowed).
 * In an aisle, the half you tap decides the side.
 */
export function exactSpotAt(p: Place, x: number, y: number): ExactSpot {
  const f = footprint(p);
  const fx = clamp01((x - f.x) / f.w);
  const fy = clamp01((y - f.y) / f.h);
  if (p.kind === 'area') return { u: fx, v: fy };
  return p.orientation === 'vertical' ? { u: fy, v: fx < 0.5 ? 0 : 1 } : { u: fx, v: fy < 0.5 ? 0 : 1 };
}

/** The floor square to walk to for an exact spot: next to the right shelf, at the right distance along. */
export function exactPoint(p: Place, s: ExactSpot): Point {
  const r = walkway(p);
  const pick = (start: number, size: number, t: number) => start + Math.min(size - 1, Math.floor(t * size));
  const lane = (start: number, size: number, side: number) =>
    side === 0 ? start : side === 1 ? start + size - 1 : start + Math.floor((size - 1) / 2);
  if (p.kind === 'area') return { x: pick(r.x, r.w, s.u), y: pick(r.y, r.h, s.v) };
  return p.orientation === 'vertical'
    ? { x: lane(r.x, r.w, s.v), y: pick(r.y, r.h, s.u) }
    : { x: pick(r.x, r.w, s.u), y: lane(r.y, r.h, s.v) };
}

/** Where to draw an exact spot: on the shelf for a known side, else on the floor. */
export function exactMark(p: Place, s: ExactSpot): { x: number; y: number } {
  const f = footprint(p);
  const pt = exactPoint(p, s);
  if (p.kind === 'area' || s.v === 0.5) return { x: pt.x + 0.5, y: pt.y + 0.5 };
  const near = s.v === 0;
  return p.orientation === 'vertical'
    ? { x: near ? f.x + 0.5 : f.x + f.w - 0.5, y: pt.y + 0.5 }
    : { x: pt.x + 0.5, y: near ? f.y + 0.5 : f.y + f.h - 0.5 };
}

/** Words for an exact spot, e.g. "left side, near the top". Uses map directions. */
export function describeExact(p: Place, s: ExactSpot): string {
  const third = (t: number, ends: [string, string]) => (t < 1 / 3 ? ends[0] : t > 2 / 3 ? ends[1] : 'middle');
  if (p.kind === 'area') {
    const row = s.v < 1 / 3 ? 'top' : s.v > 2 / 3 ? 'bottom' : '';
    const col = s.u < 1 / 3 ? 'left' : s.u > 2 / 3 ? 'right' : '';
    return row && col ? `${row}-${col}` : row || col || 'middle';
  }
  const vertical = p.orientation === 'vertical';
  const along = third(s.u, vertical ? ['near the top', 'near the bottom'] : ['near the left end', 'near the right end']);
  if (s.v === 0.5) return along;
  const side = vertical ? (s.v === 0 ? 'left side' : 'right side') : s.v === 0 ? 'top side' : 'bottom side';
  return `${side}, ${along}`;
}
