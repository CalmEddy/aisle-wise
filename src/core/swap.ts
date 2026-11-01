import { footprint } from './geometry';
import type { Place, Rect, StoreLayout } from './types';

/**
 * Swapping pieces that stand end to end along a wall or an aisle (Meat next
 * to Cheese): one swaps places with the next, keeping the gap between them,
 * so the two still cover the same stretch and nothing else moves. Each keeps
 * its own depth and its distance from the wall; what's saved on a piece moves
 * with it.
 */

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where a piece runs along an axis, and across it. */
const along = (r: Rect, x: boolean) => (x ? [r.x, r.x + r.w] : [r.y, r.y + r.h]);
const across = (r: Rect, x: boolean) => (x ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);

/** A piece lies along the line it moves in: a shelf running that way, or any area. */
const runsWay = (p: Place, x: boolean) => p.kind === 'area' || (p.orientation === 'horizontal') === x;

/**
 * The next piece in a direction (dx or dy of ±1) in the same line: running the same way, side by side across
 * the line, with nothing between them.
 */
export function neighbourInLine(l: StoreLayout, id: string, dx: number, dy: number): Place | undefined {
  const a = l.places.find((p) => p.id === id);
  if (!a || (!dx && !dy)) return undefined;
  const x = !!dx;
  const dir = dx || dy;
  if (!runsWay(a, x)) return undefined;
  const fa = footprint(a);
  const [a0, a1] = along(fa, x);
  const [c0, c1] = across(fa, x);
  let best: { p: Place; gap: number } | undefined;
  for (const p of l.places) {
    if (p.id === id || !runsWay(p, x)) continue;
    const f = footprint(p);
    const [p0, p1] = along(f, x);
    const [q0, q1] = across(f, x);
    if (q1 <= c0 || q0 >= c1) continue; // not in this line
    const gap = dir > 0 ? p0 - a1 : a0 - p1;
    if (gap < 0) continue;
    if (!best || gap < best.gap) best = { p, gap };
  }
  if (!best) return undefined;
  // Nothing in the way between them.
  const g = best.gap;
  if (g > 0) {
    const between: Rect = x
      ? { x: dir > 0 ? a1 : a0 - g, y: c0, w: g, h: c1 - c0 }
      : { x: c0, y: dir > 0 ? a1 : a0 - g, w: c1 - c0, h: g };
    if (l.places.some((p) => p.id !== id && p.id !== best!.p.id && overlaps(footprint(p), between))) return undefined;
  }
  return best.p;
}

/** The next piece in a direction when it's right up against this one (no gap): a move that way swaps them. */
export function touchingInLine(l: StoreLayout, id: string, dx: number, dy: number): Place | undefined {
  const a = l.places.find((p) => p.id === id);
  const b = neighbourInLine(l, id, dx, dy);
  if (!a || !b) return undefined;
  const fa = footprint(a);
  const fb = footprint(b);
  const x = !!dx;
  const gap = (dx || dy) > 0 ? along(fb, x)[0] - along(fa, x)[1] : along(fa, x)[0] - along(fb, x)[1];
  return gap === 0 ? b : undefined;
}

/** A piece moved so its footprint starts at `start` along the line. */
function placedAt(p: Place, x: boolean, start: number): Place {
  return x ? { ...p, x: start } : { ...p, y: start };
}

/** Two pieces in a line swapped; undefined if either wouldn't fit where the other was. */
export function swapPieces(l: StoreLayout, id: string, otherId: string): StoreLayout | undefined {
  const a = l.places.find((p) => p.id === id);
  const b = l.places.find((p) => p.id === otherId);
  if (!a || !b) return undefined;
  const fa = footprint(a);
  const fb = footprint(b);
  // The line runs the way they're apart.
  const x = fb.x >= fa.x + fa.w || fa.x >= fb.x + fb.w;
  const [a0, a1] = along(fa, x);
  const [b0, b1] = along(fb, x);
  const [first, second] = a0 < b0 ? [{ p: a, s: a0, e: a1 }, { p: b, s: b0, e: b1 }] : [{ p: b, s: b0, e: b1 }, { p: a, s: a0, e: a1 }];
  const gap = second.s - first.e;
  // The second takes the first's start; the first follows after the same gap.
  const nextSecond = placedAt(second.p, x, first.s);
  const nextFirst = placedAt(first.p, x, first.s + (second.e - second.s) + gap);
  const moved = new Map([[nextSecond.id, nextSecond], [nextFirst.id, nextFirst]]);
  const rects = [...moved.values()].map(footprint);
  const inside = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= l.width && r.y + r.h <= l.height;
  const others = [...l.places.filter((p) => !moved.has(p.id)).map(footprint), ...(l.aisles ?? [])];
  if (!rects.every((r) => inside(r) && !others.some((o) => overlaps(o, r)))) return undefined;
  return { ...l, places: l.places.map((p) => moved.get(p.id) ?? p) };
}

/** One step past the next piece in a direction: they swap. */
export function swapAlong(l: StoreLayout, id: string, dx: number, dy: number): { layout: StoreLayout; with: Place } | undefined {
  const b = neighbourInLine(l, id, dx, dy);
  const next = b && swapPieces(l, id, b.id);
  return next && b ? { layout: next, with: b } : undefined;
}

/**
 * A piece put in another's place along its line: it swaps past each piece on the way, so the ones between move
 * over one place to make room.
 */
export function moveOnto(l: StoreLayout, id: string, ontoId: string): StoreLayout | undefined {
  const a = l.places.find((p) => p.id === id);
  const b = l.places.find((p) => p.id === ontoId);
  if (!a || !b || a.id === b.id) return undefined;
  const fa = footprint(a);
  const fb = footprint(b);
  const x = fb.x >= fa.x + fa.w || fa.x >= fb.x + fb.w;
  const dir = (x ? fb.x - fa.x : fb.y - fa.y) > 0 ? 1 : -1;
  let cur = l;
  for (let i = 0; i < l.places.length; i++) {
    const step = swapAlong(cur, id, x ? dir : 0, x ? 0 : dir);
    if (!step) return undefined;
    cur = step.layout;
    if (step.with.id === ontoId) return cur;
  }
  return undefined;
}
