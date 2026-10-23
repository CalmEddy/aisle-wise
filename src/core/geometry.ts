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
