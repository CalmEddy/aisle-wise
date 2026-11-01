import { parseExactKey, footprint } from './geometry';
import type { Place, Point, Product, Shelf, ShelfReach, StoreLayout } from './types';

/**
 * When a shelf on the map is shorter than the real one. Each end of each
 * shelf collects signs that it runs further:
 *
 * - found past the end: something dropped on the floor just past it, lined up
 *   with it (1½ points each, the strongest sign);
 * - piled at the end: two or more things saved on its very last square (1);
 * - out of step: the shelves beside it, across the aisles, run further (1);
 * - crowded: more kinds than it has room for, 2 squares each (½, only with
 *   another sign).
 *
 * At 2 points it's worth asking: "3L seems to go further toward the back.
 * Extend it 2 squares?" The shelf grows only over free floor; what's saved on
 * it stays where it is. An end the shopper said goes no further isn't asked
 * about again.
 */

export const ASK_AT = 2;
/** How far past an end a dropped thing counts as on the shelf (squares). */
export const PAST_REACH = 3;
/** Saved this close to an end (0–1 along) counts as at the end. */
const AT_END = 0.04;
/** How far across (squares) a shelf beside counts as its neighbour. */
const NEIGHBOUR = 5;

export interface Extension {
  placeId: string;
  label: string;
  end: 'start' | 'end';
  /** Squares to add. */
  by: number;
  /** "toward the back", "to the left", … */
  way: string;
  score: number;
  why: string[];
}

/** Against a wall (stocked from one side), or a department: not one of the aisles' shelves. */
const onWall = (s: Shelf) => s.back !== undefined || /^g-(wall|dept)-/.test(s.id);
const run = (s: Shelf) => (s.orientation === 'vertical' ? [s.y, s.y + s.length] : [s.x, s.x + s.length]);
const cross = (s: Shelf) => (s.orientation === 'vertical' ? s.x : s.y);
export const endKey = (placeId: string, end: 'start' | 'end') => `${placeId}:${end}`;

/** Which way an end grows, in words (the top of the map is the back of the store). */
export function wayOf(s: Shelf, end: 'start' | 'end'): string {
  if (s.orientation === 'vertical') return end === 'start' ? 'toward the back' : 'toward the front';
  return end === 'start' ? 'to the left' : 'to the right';
}

/** Free floor for a shelf square: in the store, on nothing else, not the door or the checkout point. */
function free(l: StoreLayout, p: Point, exceptId: string): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= l.width || p.y >= l.height) return false;
  if ((p.x === l.entrance.x && p.y === l.entrance.y) || (p.x === l.checkout.x && p.y === l.checkout.y)) return false;
  const inside = (r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
  return !l.places.some((pl) => pl.id !== exceptId && inside(footprint(pl))) && !(l.aisles ?? []).some(inside);
}

/** How many squares an end can grow, up to `want`, over free floor. */
export function roomAt(l: StoreLayout, s: Shelf, end: 'start' | 'end', want: number): number {
  const [a0, a1] = run(s);
  let n = 0;
  while (n < want) {
    const at = end === 'start' ? a0 - n - 1 : a1 + n;
    const p = s.orientation === 'vertical' ? { x: s.x, y: at } : { x: at, y: s.y };
    if (!free(l, p, s.id)) break;
    n++;
  }
  return n;
}

/**
 * A spot on the floor just past a shelf's end, lined up with it: the shelf (nearest first) and how far past.
 * Undefined if it isn't lined up with one, or something's in between.
 */
export function pastEnd(l: StoreLayout, p: Point): { shelf: Shelf; end: 'start' | 'end'; to: number; gap: number } | undefined {
  let best: { shelf: Shelf; end: 'start' | 'end'; to: number; gap: number } | undefined;
  for (const pl of l.places) {
    if (pl.kind !== 'shelf' || cross(pl) !== (pl.orientation === 'vertical' ? p.x : p.y)) continue;
    const a = pl.orientation === 'vertical' ? p.y : p.x;
    const [a0, a1] = run(pl);
    const end = a < a0 ? 'start' : a >= a1 ? 'end' : undefined;
    if (!end) continue;
    const gap = end === 'start' ? a0 - a : a - a1 + 1;
    if (gap > PAST_REACH || roomAt(l, pl, end, gap) < gap) continue;
    if (!best || gap < best.gap) best = { shelf: pl, end, to: a, gap };
  }
  return best;
}

/** The shelf ends worth asking about, most sure first. */
export function extensionsDue(l: StoreLayout, products: readonly Product[]): Extension[] {
  const out: Extension[] = [];
  const shelves = l.places.filter((p): p is Shelf => p.kind === 'shelf' && !/checkout/i.test(p.label) && p.id !== 'g-checkout');
  const reach = l.reach ?? [];
  // Saved spots on each shelf, 0–1 along it.
  const saved = new Map<string, { item: string; u: number }[]>();
  for (const p of products) {
    const e = parseExactKey(p.locations?.[l.id] ?? '');
    if (e) saved.set(e.placeId, [...(saved.get(e.placeId) ?? []), { item: p.name, u: e.spot.u }]);
  }
  for (const s of shelves) {
    const [a0, a1] = run(s);
    for (const end of ['start', 'end'] as const) {
      if (l.keepLength?.includes(endKey(s.id, end))) continue;
      const why: string[] = [];
      let score = 0;
      let want = 0;
      // Found past the end (and still past it).
      const past = reach.filter((r) => r.placeId === s.id && r.end === end && (end === 'start' ? r.to < a0 : r.to >= a1));
      const pastItems = new Set(past.map((r) => r.item));
      if (past.length) {
        score += 1.5 * pastItems.size;
        want = Math.max(...past.map((r) => (end === 'start' ? a0 - r.to : r.to - a1 + 1)));
        why.push(`${[...pastItems].join(', ')} found past the end`);
      }
      // Piled at the end (not counting those).
      const piled = (saved.get(s.id) ?? []).filter((x) => !pastItems.has(x.item) && (end === 'start' ? x.u <= AT_END : x.u >= 1 - AT_END));
      if (piled.length >= 2) {
        score += 1;
        want = Math.max(want, 1);
        why.push(`${piled.length} things at its very end`);
      }
      // Out of step with the shelves beside it.
      // (Shelves in the aisles only: a wall runs the length of the store, a shelf in an aisle needn't.)
      const beside = onWall(s) ? [] : shelves.filter((o) => o.id !== s.id && o.orientation === s.orientation && !onWall(o)
        && Math.abs(cross(o) - cross(s)) <= NEIGHBOUR && run(o)[0] < a1 && a0 < run(o)[1]);
      const sides = [beside.filter((o) => cross(o) < cross(s)), beside.filter((o) => cross(o) > cross(s))]
        .map((side) => side.sort((x, y) => Math.abs(cross(x) - cross(s)) - Math.abs(cross(y) - cross(s)))[0])
        .filter((o): o is Shelf => !!o);
      if (sides.length) {
        const further = sides.map((o) => (end === 'start' ? a0 - run(o)[0] : run(o)[1] - a1));
        if (further.every((d) => d >= 2)) {
          score += 1;
          want = Math.max(want, Math.min(...further));
          why.push(sides.length > 1 ? 'the shelves either side run further' : 'the shelf beside it runs further');
        }
      }
      // Crowded.
      if (score > 0 && s.categories.length * 2 > s.length) {
        score += 0.5;
        why.push(`${s.categories.length} kinds on ${s.length} squares`);
      }
      if (score < ASK_AT) continue;
      const by = roomAt(l, s, end, want);
      if (by < 1) continue;
      out.push({ placeId: s.id, label: s.label || 'This shelf', end, by, way: wayOf(s, end), score, why });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** A shelf grown at one end. */
export function extended(s: Shelf, end: 'start' | 'end', by: number): Shelf {
  const start = end === 'start' ? -by : 0;
  return { ...s, length: s.length + by, ...(s.orientation === 'vertical' ? { y: s.y + start } : { x: s.x + start }) };
}

/** Records something found past a shelf's end (kept to the latest 60). */
export function withReach(l: StoreLayout, r: ShelfReach): StoreLayout {
  const rest = (l.reach ?? []).filter((x) => !(x.placeId === r.placeId && x.end === r.end && x.item === r.item));
  return { ...l, reach: [...rest, r].slice(-60) };
}

/** The shelf's place in a list, for the editor. */
export const dueFor = (due: readonly Extension[], p: Place) => due.find((d) => d.placeId === p.id);
