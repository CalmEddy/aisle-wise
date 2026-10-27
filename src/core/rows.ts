import { contains, footprint } from './geometry';
import type { Orientation, Point, Rect, Shelf, StoreLayout } from './types';

/**
 * Rows of shelves: learning how a store's shelves are spaced, so new ones
 * can copy their neighbours and the shelves you walked past can be filled in.
 *
 * "Across" is the direction shelves in a row are spaced (x for vertical
 * shelves); "along" is the direction a shelf runs.
 */

/** How far away (squares, across the row) a shelf still counts as a neighbour. */
export const ROW_RANGE = 25;
/** Walkway width when the store doesn't show one yet. */
export const DEFAULT_LANE = 2;

/** How a row of shelves is spaced. */
export interface RowPattern {
  /** Squares of walkway between shelves that face each other. */
  lane: number;
  /** Shelves stand in back-to-back pairs. */
  paired: boolean;
}

const vertical = (s: { orientation: Orientation }) => s.orientation === 'vertical';
const across = (s: Shelf) => (vertical(s) ? s.x : s.y);
const alongStart = (s: Shelf) => (vertical(s) ? s.y : s.x);
const at = (o: Orientation, acrossV: number, alongV: number): Point =>
  o === 'vertical' ? { x: acrossV, y: alongV } : { x: alongV, y: acrossV };

const shelves = (l: StoreLayout) => l.places.filter((p): p is Shelf => p.kind === 'shelf');

function free(l: StoreLayout, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < l.width && p.y < l.height && !l.places.some((pl) => contains(footprint(pl), p));
}

/** Squares two parallel shelves have side by side (0 if none). */
function overlap(a: Shelf, b: Shelf): number {
  const a0 = alongStart(a);
  const b0 = alongStart(b);
  return Math.max(0, Math.min(a0 + a.length, b0 + b.length) - Math.max(a0, b0));
}

/** Shelves running the same way as `s`, side by side with it (sharing at least one square of its run). */
function rowMates(l: StoreLayout, s: Shelf): Shelf[] {
  return shelves(l).filter((o) => o.id !== s.id && o.orientation === s.orientation && overlap(o, s) > 0
    && Math.abs(across(o) - across(s)) <= ROW_RANGE);
}

/** The spacing of the row `s` is in: the usual walkway width, and whether shelves come in pairs. */
export function learnPattern(l: StoreLayout, s: Shelf): RowPattern {
  const coords = [...new Set([s, ...rowMates(l, s)].map(across))].sort((a, b) => a - b);
  const gaps = coords.slice(1).map((c, i) => c - coords[i] - 1);
  const lanes = new Map<number, number>();
  for (const g of gaps) if (g > 0 && g <= 6) lanes.set(g, (lanes.get(g) ?? 0) + 1);
  let lane = DEFAULT_LANE;
  let best = 0;
  for (const [g, n] of lanes) if (n > best || (n === best && g < lane)) [lane, best] = [g, n];
  return { lane, paired: gaps.includes(0) };
}

/** A copy of `template` (same direction, start and length) at another position across the row; undefined if it doesn't fit. */
export function shelfLike(l: StoreLayout, template: Shelf, acrossAt: number): Shelf | undefined {
  const start = alongStart(template);
  for (let i = 0; i < template.length; i++) {
    if (!free(l, at(template.orientation, acrossAt, start + i))) return undefined;
  }
  const v = vertical(template);
  return {
    kind: 'shelf', id: '', label: '', orientation: template.orientation, length: template.length, categories: [],
    x: v ? acrossAt : start, y: v ? start : acrossAt,
  };
}

/**
 * The shelf a new shelf at `p` should copy: the nearest one whose run passes
 * `p` (so `p` is somewhere in the same row). Undefined on open floor with no
 * row nearby.
 */
export function matchNeighbour(l: StoreLayout, p: Point): Shelf | undefined {
  let best: Shelf | undefined;
  let bestD = ROW_RANGE + 1;
  for (const s of shelves(l)) {
    const v = vertical(s);
    const a = v ? p.y : p.x;
    const start = alongStart(s);
    if (a < start || a >= start + s.length) continue;
    const d = Math.abs((v ? p.x : p.y) - across(s));
    if (d >= 1 && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** A shelf standing directly behind `s` on one side (back to back). */
function partner(l: StoreLayout, s: Shelf, side: -1 | 1): Shelf | undefined {
  return rowMates(l, s).find((o) => across(o) === across(s) + side);
}

/**
 * Where the next shelf after `s` goes on one side, at the row's spacing: back
 * to back with `s` when shelves come in pairs and `s` doesn't have its
 * partner yet, otherwise across a walkway. Undefined if it doesn't fit.
 */
export function nextShelf(l: StoreLayout, s: Shelf, side: -1 | 1): Shelf | undefined {
  const pattern = learnPattern(l, s);
  // Already has a shelf right behind it on this side: carry on from that one.
  let base = s;
  for (let guard = 0; guard < 3; guard++) {
    const behind = partner(l, base, side);
    if (!behind) break;
    base = behind;
  }
  const hasPair = !!partner(l, base, -side as -1 | 1) || base !== s;
  const gap = pattern.paired && !hasPair ? 0 : pattern.lane;
  return shelfLike(l, s, across(base) + side * (gap + 1));
}

/**
 * Shelves the shopper probably walked past to get from an existing shelf to
 * the new shelf `made`: the gap between them on the nearer side, filled at
 * the row's spacing, keeping a walkway beside each open side. Ordered from
 * the existing shelf towards `made`. Empty when the gap is just a walkway.
 */
export function skippedShelves(l: StoreLayout, made: Shelf): Shelf[] {
  const mates = rowMates(l, made);
  const sides = ([-1, 1] as const).map((side) => {
    const near = mates
      .filter((o) => (across(o) - across(made)) * side > 0)
      .sort((a, b) => Math.abs(across(a) - across(made)) - Math.abs(across(b) - across(made)))[0];
    return near ? { side, near } : undefined;
  }).filter((x): x is { side: -1 | 1; near: Shelf } => !!x)
    .sort((a, b) => Math.abs(across(a.near) - across(made)) - Math.abs(across(b.near) - across(made)));

  for (const { side, near } of sides) {
    const { lane, paired } = learnPattern(l, near);
    const unit = paired ? 2 : 1;
    // Squares strictly between them, counted from the existing shelf.
    const total = Math.abs(across(made) - across(near)) - 1;
    let k = 0;
    while ((k + 1) * unit + (k + 2) * lane <= total) k++;
    if (k === 0) continue;
    // Spread any spare squares over the walkways so they stay even.
    const spare = total - k * unit - (k + 1) * lane;
    const lanes = Array.from({ length: k + 1 }, (_, i) => lane + Math.floor(spare / (k + 1)) + (i < spare % (k + 1) ? 1 : 0));
    const dir = -side; // from `near` towards `made`
    const out: Shelf[] = [];
    let c = across(near) + dir * (lanes[0] + 1);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < unit; j++) {
        const s = shelfLike({ ...l, places: [...l.places, ...out] }, made, c + dir * j);
        if (s) out.push(s);
      }
      c += dir * (unit + lanes[i + 1]);
    }
    if (out.length) return out;
  }
  return [];
}

/** The squares a planned change adds to a shelf or area: the whole place if new, else just the new part. */
export function addedRect(before: StoreLayout, after: StoreLayout, placeId: string | undefined): Rect | undefined {
  if (!placeId) return undefined;
  const now = after.places.find((p) => p.id === placeId);
  if (!now) return undefined;
  const was = before.places.find((p) => p.id === placeId);
  const f = footprint(now);
  if (!was) return f;
  const g = footprint(was);
  if (f.x === g.x && f.y === g.y && f.w === g.w && f.h === g.h) return undefined;
  // Grown along one direction: the part that's new.
  if (f.w === g.w && f.x === g.x) return f.y < g.y ? { ...f, h: g.y - f.y } : { ...f, y: g.y + g.h, h: f.y + f.h - (g.y + g.h) };
  if (f.h === g.h && f.y === g.y) return f.x < g.x ? { ...f, w: g.x - f.x } : { ...f, x: g.x + g.w, w: f.x + f.w - (g.x + g.w) };
  return f;
}
