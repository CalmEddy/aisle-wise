import type { Place, Point, Rect, Shelf, StoreLayout } from './types';

/** The rectangle a place occupies. A shelf is one square thick. */
export function footprint(p: Place): Rect {
  if (p.kind === 'area') return { x: p.x, y: p.y, w: p.w, h: p.h };
  return p.orientation === 'vertical' ? { x: p.x, y: p.y, w: 1, h: p.length } : { x: p.x, y: p.y, w: p.length, h: 1 };
}

/** Squares you can't walk through: shelves. Areas are open floor. */
export function blocks(p: Place): Rect[] {
  return p.kind === 'shelf' ? [footprint(p)] : [];
}

/** Whether things in a place are laid out left-to-right (else top-to-bottom). */
export function runsAlongX(p: Place): boolean {
  return p.kind === 'shelf' ? p.orientation === 'horizontal' : p.w >= p.h;
}

/**
 * Where the `index`-th of `count` things stocked in a place sits: spread
 * evenly along the shelf, or along the long side of an area.
 */
export function spotPoint(p: Place, index = 0, count = 1): Point {
  const r = footprint(p);
  const t = (index + 0.5) / Math.max(1, count);
  return runsAlongX(p)
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

/**
 * The place at a map position (grid units, fractions allowed). Shelves are
 * thin, so a tap within `reach` squares of one counts as on it.
 */
export function placeNear(layout: StoreLayout, x: number, y: number, reach = 0.6): Place | undefined {
  const direct = placeAt(layout, { x: Math.floor(x), y: Math.floor(y) });
  if (direct?.kind === 'shelf') return direct;
  let best: Shelf | undefined;
  let bestD = reach;
  for (const p of layout.places) {
    if (p.kind !== 'shelf') continue;
    const f = footprint(p);
    const dx = Math.max(f.x - x, 0, x - (f.x + f.w));
    const dy = Math.max(f.y - y, 0, y - (f.y + f.h));
    const d = Math.max(dx, dy);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best ?? direct;
}

/** Keeps a place inside the store walls. */
export function clampPlace<T extends Place>(p: T, layout: Pick<StoreLayout, 'width' | 'height'>): T {
  const f = footprint(p);
  const x = Math.max(0, Math.min(layout.width - f.w, p.x));
  const y = Math.max(0, Math.min(layout.height - f.h, p.y));
  return { ...p, x, y };
}

// ---------------------------------------------------------------------------
// Exact spots
//
// An exact spot is saved relative to its place so it survives moving or
// resizing the place: key `placeId@u,v`, with u, v = how far across and
// down (0..1). Shelves only use u (how far along); v is stored as 0.5.

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

/** The exact spot under a map position (grid units, fractions allowed). */
export function exactSpotAt(p: Place, x: number, y: number): ExactSpot {
  const f = footprint(p);
  const fx = clamp01((x - f.x) / f.w);
  const fy = clamp01((y - f.y) / f.h);
  if (p.kind === 'area') return { u: fx, v: fy };
  return { u: p.orientation === 'vertical' ? fy : fx, v: 0.5 };
}

/** The square an exact spot falls on. For shelves that's a shelf square; walking goes to whichever side is nearer. */
export function exactPoint(p: Place, s: ExactSpot): Point {
  const r = footprint(p);
  const pick = (start: number, size: number, t: number) => start + Math.min(size - 1, Math.floor(t * size));
  if (p.kind === 'area') return { x: pick(r.x, r.w, s.u), y: pick(r.y, r.h, s.v) };
  return p.orientation === 'vertical' ? { x: r.x, y: pick(r.y, r.h, s.u) } : { x: pick(r.x, r.w, s.u), y: r.y };
}

/** Where to draw an exact spot (centre of its square). */
export function exactMark(p: Place, s: ExactSpot): { x: number; y: number } {
  const pt = exactPoint(p, s);
  return { x: pt.x + 0.5, y: pt.y + 0.5 };
}

/** Words for an exact spot, e.g. "near the top". Uses map directions. */
export function describeExact(p: Place, s: ExactSpot): string {
  if (p.kind === 'area') {
    const row = s.v < 1 / 3 ? 'top' : s.v > 2 / 3 ? 'bottom' : '';
    const col = s.u < 1 / 3 ? 'left' : s.u > 2 / 3 ? 'right' : '';
    return row && col ? `${row}-${col}` : row || col || 'middle';
  }
  const [start, end] = p.orientation === 'vertical' ? ['near the top', 'near the bottom'] : ['near the left end', 'near the right end'];
  return s.u < 1 / 3 ? start : s.u > 2 / 3 ? end : 'middle';
}

// ---------------------------------------------------------------------------
// Category sections

/** Where a category sits in a place, as an exact spot. Sections share the shelf (or the area's long side) equally. */
export function categorySpot(p: Place, categoryId: string): ExactSpot | undefined {
  const i = p.categories.indexOf(categoryId);
  if (i < 0) return undefined;
  const t = (i + 0.5) / p.categories.length;
  if (p.kind === 'shelf') return { u: t, v: 0.5 };
  return runsAlongX(p) ? { u: t, v: 0.5 } : { u: 0.5, v: t };
}

export interface SectionShape {
  categoryId: string;
  /** Shelf segment or area band, in grid units. */
  rect: Rect;
}

/** The coloured sections to draw for a place. */
export function sectionShapes(p: Place): SectionShape[] {
  const r = footprint(p);
  const n = p.categories.length;
  const alongX = runsAlongX(p);
  return p.categories.map((categoryId, i) => ({
    categoryId,
    rect: alongX
      ? { x: r.x + (r.w * i) / n, y: r.y, w: r.w / n, h: r.h }
      : { x: r.x, y: r.y + (r.h * i) / n, w: r.w, h: r.h / n },
  }));
}
