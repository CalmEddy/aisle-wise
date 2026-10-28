import { paintAisle } from './aisles';
import { growStore, nextLabel, type Direction } from './build';
import { contains, exactKey, footprint, parseExactKey } from './geometry';
import type { Orientation, Point, Rect, Shelf, StoreLayout } from './types';

/**
 * The aisle brush: walk down an aisle in steps of BRUSH_LENGTH squares and
 * paint what's on your left and right as you go (a shelf, a wall shelf, or
 * nothing). Sides are relative to the direction you're walking, so turning
 * a corner keeps "left" on your left. Each step joins up with the shelf it
 * continues, so a whole aisle side stays one shelf.
 */

export type SideKind = 'shelf' | 'wall' | 'gap';

export interface Brush {
  left: SideKind;
  right: SideKind;
  /** Category each side stocks as it's painted (optional). */
  leftCategory?: string;
  rightCategory?: string;
  /** Name the walkway as you paint it ("Aisle 5"). */
  aisleLabel?: string;
  /** Walkway width between the two sides, in squares. */
  width: number;
}

/** Squares painted per step. */
export const BRUSH_LENGTH = 4;
export const DEFAULT_BRUSH: Brush = { left: 'shelf', right: 'shelf', width: 2 };
export const MIN_AISLE = 2;
export const MAX_AISLE = 6;

export const BRUSH_PRESETS: { name: string; left: SideKind; right: SideKind }[] = [
  { name: 'Aisle', left: 'shelf', right: 'shelf' },
  { name: 'Wall on right', left: 'shelf', right: 'wall' },
  { name: 'Wall on left', left: 'wall', right: 'shelf' },
  { name: 'Corridor', left: 'gap', right: 'gap' },
];

const STEP: Record<Direction, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** One side of one step: a run of shelf to paint. */
export interface SideSegment {
  side: 'left' | 'right';
  kind: 'shelf' | 'wall';
  orientation: Orientation;
  /** Column (vertical) or row (horizontal) of the shelf. */
  across: number;
  start: number;
  length: number;
  /** Wall shelves: the closed side, facing away from the walkway. */
  back?: -1 | 1;
  /** Category the painted squares stock. */
  categoryId?: string;
}

/** Where a brush step from `p` heading `dir` reaches: the walkway, the two sides, and where you end up. */
export function brushArea(p: Point, dir: Direction, width: number) {
  const vertical = dir === 'up' || dir === 'down';
  const a = vertical ? p.y : p.x;
  const c = vertical ? p.x : p.y;
  const forward = dir === 'down' || dir === 'right' ? 1 : -1;
  const start = forward > 0 ? a : a - (BRUSH_LENGTH - 1);
  // The walkway is `width` squares wide, starting at your square (and centred when it can be).
  const lo = c - Math.floor((width - 1) / 2);
  const hi = lo + width - 1;
  // Left of the way you're walking: walking up, that's the smaller x; walking right, the smaller y.
  const leftIsLow = dir === 'up' || dir === 'right';
  return {
    orientation: (vertical ? 'vertical' : 'horizontal') as Orientation,
    start,
    end: start + BRUSH_LENGTH - 1,
    lo,
    hi,
    leftAcross: leftIsLow ? lo - 1 : hi + 1,
    rightAcross: leftIsLow ? hi + 1 : lo - 1,
    next: { x: p.x + STEP[dir].x * BRUSH_LENGTH, y: p.y + STEP[dir].y * BRUSH_LENGTH },
  };
}

/** What one step would paint (before fitting around anything already there). */
export function brushSegments(p: Point, dir: Direction, brush: Brush): SideSegment[] {
  const a = brushArea(p, dir, brush.width);
  const out: SideSegment[] = [];
  for (const side of ['left', 'right'] as const) {
    const kind = brush[side];
    if (kind === 'gap') continue;
    const across = side === 'left' ? a.leftAcross : a.rightAcross;
    const categoryId = side === 'left' ? brush.leftCategory : brush.rightCategory;
    out.push({
      side, kind, orientation: a.orientation, across, start: a.start, length: BRUSH_LENGTH,
      ...(kind === 'wall' && { back: across < a.lo ? -1 : 1 }),
      ...(categoryId && { categoryId }),
    });
  }
  return out;
}

/** The squares a segment covers, as a rectangle (for previews). */
export function segmentRect(s: SideSegment): Rect {
  return s.orientation === 'vertical'
    ? { x: s.across, y: s.start, w: 1, h: s.length }
    : { x: s.start, y: s.across, w: s.length, h: 1 };
}

const acrossOf = (s: Shelf) => (s.orientation === 'vertical' ? s.x : s.y);
const startOf = (s: Shelf) => (s.orientation === 'vertical' ? s.y : s.x);

/** Saved spots on `before` moved onto `after` (same line of squares), keeping each at the same physical square. */
export function rekeyInto(before: Shelf, after: Shelf) {
  return (key: string): string => {
    const exact = parseExactKey(key);
    if (exact) {
      if (exact.placeId !== before.id) return key;
      const at = startOf(before) + exact.spot.u * before.length;
      return exactKey(after.id, { u: Math.max(0, Math.min(1, (at - startOf(after)) / after.length)), v: exact.spot.v });
    }
    const [placeId, cat] = key.split(':');
    if (placeId !== before.id) return key;
    return cat ? `${after.id}:${cat}` : after.id;
  };
}

const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * Paints one side segment: squares already taken by something else are
 * skipped, and each painted run joins any shelf of the same kind it touches
 * or overlaps on the same line (merging them into one).
 */
function paintSegment(l: StoreLayout, seg: SideSegment, avoid: Rect[]): { layout: StoreLayout; rekeys: ((k: string) => string)[]; painted: number; blocked: number } {
  const v = seg.orientation === 'vertical';
  const cell = (i: number): Point => (v ? { x: seg.across, y: i } : { x: i, y: seg.across });
  const sameKind = (pl: StoreLayout['places'][number]): pl is Shelf =>
    pl.kind === 'shelf' && pl.orientation === seg.orientation && acrossOf(pl) === seg.across && (pl.back ?? 0) === (seg.back ?? 0);
  let layout = l;
  const rekeys: ((k: string) => string)[] = [];
  let painted = 0;
  let blocked = 0;

  const usable = (i: number) => !avoid.some((r) => contains(r, cell(i)))
    && !layout.places.some((pl) => contains(footprint(pl), cell(i)) && !sameKind(pl));
  const runs: [number, number][] = [];
  for (let i = seg.start; i < seg.start + seg.length; i++) {
    if (!usable(i)) {
      blocked++;
      continue;
    }
    const last = runs[runs.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  }

  for (const [r0, r1] of runs) {
    painted += r1 - r0 + 1;
    const touching = layout.places.filter(sameKind).filter((s) => startOf(s) <= r1 + 1 && startOf(s) + s.length - 1 >= r0 - 1);
    if (!touching.length) {
      const shelf: Shelf = {
        kind: 'shelf', id: `s-${newId()}`, label: nextLabel(layout, 'shelf'), orientation: seg.orientation,
        length: r1 - r0 + 1, x: v ? seg.across : r0, y: v ? r0 : seg.across, categories: seg.categoryId ? [seg.categoryId] : [],
        ...(seg.back && { back: seg.back }),
      };
      layout = { ...layout, places: [...layout.places, shelf] };
      continue;
    }
    // Join into the first shelf touched; others on the line merge into it.
    const keep = touching[0];
    const s0 = Math.min(r0, ...touching.map(startOf));
    const s1 = Math.max(r1, ...touching.map((s) => startOf(s) + s.length - 1));
    // Categories in order along the shelf; a painted category goes at the end it was painted on.
    const ordered = [...touching].sort((x, y) => startOf(x) - startOf(y));
    let categories = [...new Set(ordered.flatMap((s) => s.categories))];
    if (seg.categoryId && !categories.includes(seg.categoryId)) {
      const atStart = r0 < Math.min(...touching.map(startOf));
      categories = atStart ? [seg.categoryId, ...categories] : [...categories, seg.categoryId];
    }
    const merged: Shelf = {
      ...keep,
      length: s1 - s0 + 1,
      ...(v ? { y: s0 } : { x: s0 }),
      categories,
    };
    for (const s of touching) rekeys.push(rekeyInto(s, merged));
    const gone = new Set(touching.map((s) => s.id));
    layout = { ...layout, places: [...layout.places.filter((p) => !gone.has(p.id)), merged] };
  }
  return { layout, rekeys, painted, blocked };
}

/** Grows the store so `cells` (and `also`) fit inside. Returns the shift applied to everything. */
function makeRoom(l: StoreLayout, rects: Rect[]): { layout: StoreLayout; shift: Point } {
  let layout = l;
  const shift = { x: 0, y: 0 };
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w - 1));
  const maxY = Math.max(...rects.map((r) => r.y + r.h - 1));
  const grow = (dir: Direction, by: number) => {
    const g = growStore(layout, dir, by);
    layout = g.layout;
    shift.x += g.shift.x;
    shift.y += g.shift.y;
  };
  if (minX < 0) grow('left', -minX + 1);
  if (minY < 0) grow('up', -minY + 1);
  if (maxX + shift.x > layout.width - 1) grow('right', maxX + shift.x - (layout.width - 1) + 1);
  if (maxY + shift.y > layout.height - 1) grow('down', maxY + shift.y - (layout.height - 1) + 1);
  return { layout, shift };
}

export interface PaintResult {
  layout: StoreLayout;
  /** Where you are after the step. */
  position: Point;
  /** How far everything moved because the store grew left or up. */
  shift: Point;
  /** Saved spot keys on shelves that were joined or grew. */
  rekey: (key: string) => string;
  /** Squares of shelf painted, and squares skipped because something was there. */
  painted: number;
  blocked: number;
  /** This step's walkway (after any shift), to avoid painting over later. */
  lane: Rect;
}

/**
 * One brush step: paints both sides along the next BRUSH_LENGTH squares and
 * moves you to the end of them. `avoid`: walkways of earlier steps, never
 * painted over (so turning a corner doesn't wall off the aisle behind you).
 */
export function paintStep(l: StoreLayout, p: Point, dir: Direction, brush: Brush, avoid: Rect[] = []): PaintResult {
  const area = brushArea(p, dir, brush.width);
  const lane: Rect = area.orientation === 'vertical'
    ? { x: area.lo - 1, y: area.start, w: area.hi - area.lo + 3, h: BRUSH_LENGTH }
    : { x: area.start, y: area.lo - 1, w: BRUSH_LENGTH, h: area.hi - area.lo + 3 };
  const room = makeRoom(l, [lane, { ...area.next, w: 1, h: 1 }]);
  const here = { x: p.x + room.shift.x, y: p.y + room.shift.y };
  const moved = (r: Rect): Rect => ({ ...r, x: r.x + room.shift.x, y: r.y + room.shift.y });
  const walked = avoid.map(moved);
  let layout = room.layout;
  const rekeys: ((k: string) => string)[] = [];
  let painted = 0;
  let blocked = 0;
  for (const seg of brushSegments(here, dir, brush)) {
    const r = paintSegment(layout, seg, walked);
    layout = r.layout;
    rekeys.push(...r.rekeys);
    painted += r.painted;
    blocked += r.blocked;
  }
  const stepLane = walkway(here, dir, brush.width);
  if (brush.aisleLabel?.trim()) layout = paintAisle(layout, stepLane, brush.aisleLabel.trim());
  const next = brushArea(here, dir, brush.width).next;
  return {
    layout,
    position: next,
    shift: room.shift,
    rekey: (key) => rekeys.reduce((k, f) => f(k), key),
    painted,
    blocked,
    lane: stepLane,
  };
}

/** The walkway squares of a step from `p`. */
export function walkway(p: Point, dir: Direction, width: number): Rect {
  const a = brushArea(p, dir, width);
  return a.orientation === 'vertical'
    ? { x: a.lo, y: a.start, w: a.hi - a.lo + 1, h: BRUSH_LENGTH }
    : { x: a.start, y: a.lo, w: BRUSH_LENGTH, h: a.hi - a.lo + 1 };
}
