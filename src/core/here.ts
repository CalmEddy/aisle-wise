import { aisleShelves } from './aisles';
import { alongShelf, extendCandidates, fitShelf, free, nextLabel, NEW_SHELF_LENGTH, planChoice, shelfBeside, turnShelf } from './build';
import { contains, exactKey, exactSpotAt, footprint } from './geometry';
import type { AisleLabel, Category, Orientation, Point, Shelf, StoreLayout } from './types';

/**
 * "Where was it?" → "Where I'm standing": what the map can do at the spot
 * you're on. On a shelf or in an area: that place. Between two shelves: either
 * one. On open floor: carry on an aisle past a walkway (both sides, the item
 * on its side), stretch a shelf that ends nearby, a new shelf either way, a new
 * area; and turn a shelf you're beside. Each builds straight away (Undo puts it
 * back) and saves the item there.
 *
 * New pieces start short (a few squares) and grow as more is found past their
 * ends (see extend.ts).
 */

export type HereOption =
  | { kind: 'on'; placeId: string; label: string }
  | { kind: 'continue'; aisleId: string; side: 'L' | 'R'; label: string }
  | { kind: 'extend'; shelfId: string; label: string }
  | { kind: 'shelf'; orientation: Orientation; label: string }
  | { kind: 'area'; label: string }
  | { kind: 'turn'; shelfId: string; label: string };

/** How far past an aisle's end (squares) it can still be carried on. */
const CONTINUE_REACH = 10;
/** How far from a shelf's end it can still be stretched to you. */
const EXTEND_REACH = 6;

const newId = () => Math.random().toString(36).slice(2, 8);
const runsUp = (a: AisleLabel) => a.h >= a.w;
const word = (s: Shelf, dir: number) => (s.orientation === 'vertical' ? (dir < 0 ? 'up' : 'down') : (dir < 0 ? 'left' : 'right'));

/** An aisle whose line runs through `p` beyond its end: its walkway and the shelf lines either side. */
function aisleLineAt(l: StoreLayout, p: Point) {
  let best: { a: AisleLabel; gap: number; lo: number; hi: number; dir: number } | undefined;
  for (const a of l.aisles ?? []) {
    const up = runsUp(a);
    const cross = up ? p.x : p.y;
    const lo = up ? a.x - 1 : a.y - 1;
    const hi = up ? a.x + a.w : a.y + a.h;
    if (cross < lo || cross > hi) continue;
    const along = up ? p.y : p.x;
    const s0 = up ? a.y : a.x;
    const s1 = s0 + (up ? a.h : a.w);
    const dir = along < s0 ? -1 : along >= s1 ? 1 : 0;
    if (!dir) continue;
    const gap = dir < 0 ? s0 - along : along - s1 + 1;
    if (gap > CONTINUE_REACH || !aisleShelves(l, a).length) continue;
    if (!best || gap < best.gap) best = { a, gap, lo, hi, dir };
  }
  return best;
}

/** What can be done where you're standing, likeliest first. */
export function hereOptions(l: StoreLayout, p: Point): HereOption[] {
  const out: HereOption[] = [];
  const on = shelfBeside(l, p);
  const area = [...l.places].reverse().find((pl) => pl.kind === 'area' && contains(footprint(pl), p));
  if (on) out.push({ kind: 'on', placeId: on.id, label: on.label || 'This shelf' });
  // Between two shelves: the other one too.
  const other = on && l.places.find((pl): pl is Shelf => pl.kind === 'shelf' && pl.id !== on.id && pl.orientation === on.orientation
    && shelfBeside({ ...l, places: [pl] }, p) === pl);
  if (other) out.push({ kind: 'on', placeId: other.id, label: other.label || 'The shelf opposite' });
  if (area) out.push({ kind: 'on', placeId: area.id, label: area.label || 'This area' });
  if (on || area) {
    if (on) out.push({ kind: 'turn', shelfId: on.id, label: `Turn ${on.label || 'the shelf'} ${on.orientation === 'vertical' ? '↔' : '↕'}` });
    return out;
  }
  // Open floor.
  const line = aisleLineAt(l, p);
  if (line) {
    const up = runsUp(line.a);
    const cross = up ? p.x : p.y;
    const name = line.a.label || 'the aisle';
    const sideName = (s: 'L' | 'R') => (up ? (s === 'L' ? 'left' : 'right') : (s === 'L' ? 'top' : 'bottom'));
    const sides: ('L' | 'R')[] = cross === line.lo ? ['L'] : cross === line.hi ? ['R'] : ['L', 'R'];
    for (const side of sides) {
      const flank = flankOf(l, line.a, side, line.dir);
      out.push({ kind: 'continue', aisleId: line.a.id, side, label: `${name} carries on here · ${flank?.label || sideName(side)}` });
    }
  }
  for (const c of extendCandidates(l, p).filter((x) => x.gap <= EXTEND_REACH)) {
    const s = l.places.find((pl) => pl.id === c.shelfId) as Shelf;
    out.push({ kind: 'extend', shelfId: c.shelfId, label: `Stretch ${c.label || 'the shelf'} ${word(s, c.atStart ? -1 : 1)} ${c.gap}` });
  }
  out.push({ kind: 'shelf', orientation: 'vertical', label: 'New shelf ↕' });
  out.push({ kind: 'shelf', orientation: 'horizontal', label: 'New shelf ↔' });
  out.push({ kind: 'area', label: 'New area' });
  return out;
}

/** The shelf on one side of an aisle at the end nearest you (to copy). */
function flankOf(l: StoreLayout, a: AisleLabel, side: 'L' | 'R', dir: number): Shelf | undefined {
  const up = runsUp(a);
  const col = side === 'L' ? (up ? a.x - 1 : a.y - 1) : (up ? a.x + a.w : a.y + a.h);
  const mine = aisleShelves(l, a).filter((s) => (up ? s.x : s.y) === col);
  const end = (s: Shelf) => (up ? s.y : s.x) + (dir > 0 ? s.length : 0);
  return mine.sort((x, y) => (dir > 0 ? end(y) - end(x) : end(x) - end(y)))[0];
}

export interface HereBuilt {
  layout: StoreLayout;
  /** Where to save the item (none for a turn). */
  spotKey?: string;
  /** Saved spots on a shelf that moved or grew, kept where they physically are. */
  rekey?: (key: string) => string;
  /** What was done, for the toast. */
  note: string;
}

/** Builds the chosen option at `p` and says where the item goes. */
export function buildHere(l: StoreLayout, p: Point, o: HereOption, category?: Category): HereBuilt | undefined {
  const cat = category?.id;
  if (o.kind === 'on') {
    const place = l.places.find((pl) => pl.id === o.placeId);
    if (!place) return undefined;
    const spot = place.kind === 'shelf' ? { u: alongShelf(place, p), v: 0.5 } : exactSpotAt(place, p.x + 0.5, p.y + 0.5);
    return { layout: l, spotKey: exactKey(place.id, spot), note: `Saved on ${o.label}.` };
  }
  if (o.kind === 'turn') {
    const r = turnShelf(l, o.shelfId, p);
    return r && { layout: r.layout, rekey: r.rekey, note: `${o.label.replace(/ [↔↕]$/, '')}: turned.` };
  }
  if (o.kind === 'extend') {
    const plan = planChoice(l, p, category, { extend: o.shelfId });
    return plan.action === 'blocked' ? undefined : { layout: plan.layout, spotKey: plan.spotKey, rekey: plan.rekey, note: `${o.label.replace(/^Stretch/, 'Stretched')} square${/ 1$/.test(o.label) ? '' : 's'}.` };
  }
  if (o.kind === 'area') {
    const plan = planChoice(l, p, category, 'area');
    return plan.action === 'blocked' ? undefined : { layout: plan.layout, spotKey: plan.spotKey, rekey: plan.rekey, note: `New area “${plan.label}”.` };
  }
  if (o.kind === 'shelf') {
    const fit = fitShelf(l, p, o.orientation, NEW_SHELF_LENGTH);
    if (!fit) return undefined;
    const v = o.orientation === 'vertical';
    const shelf: Shelf = {
      kind: 'shelf', id: `s-${newId()}`, label: nextLabel(l, 'shelf'), orientation: o.orientation, length: fit.length,
      x: v ? p.x : fit.start, y: v ? fit.start : p.y, categories: cat ? [cat] : [],
    };
    return { layout: { ...l, places: [...l.places, shelf] }, spotKey: exactKey(shelf.id, { u: alongShelf(shelf, p), v: 0.5 }), note: `New shelf “${shelf.label}”.` };
  }
  return continueAisle(l, p, o, cat);
}

/** The aisle carried on past a walkway: both sides, a few squares around you; its walkway label runs on to them. */
function continueAisle(l: StoreLayout, p: Point, o: Extract<HereOption, { kind: 'continue' }>, cat?: string): HereBuilt | undefined {
  const a = l.aisles?.find((x) => x.id === o.aisleId);
  const line = a && aisleLineAt(l, p);
  if (!a || !line || line.a.id !== a.id) return undefined;
  const up = runsUp(a);
  const orientation: Orientation = up ? 'vertical' : 'horizontal';
  const cols = { L: line.lo, R: line.hi };
  const at = (col: number, i: number): Point => (up ? { x: col, y: i } : { x: i, y: col });
  const along = up ? p.y : p.x;
  // A few squares around you, free on your side (and the walkway), shifted to fit.
  const len = NEW_SHELF_LENGTH;
  const freeRun = (col: number, start: number) => Array.from({ length: len }, (_, i) => free(l, at(col, start + i))).every(Boolean);
  const lane = (start: number) => Array.from({ length: len }, (_, i) => i).every((i) => {
    for (let c = line.lo + 1; c < line.hi; c++) if (!free(l, at(c, start + i))) return false;
    return true;
  });
  const starts = [along - Math.floor((len - 1) / 2), along - len + 1, along];
  const start = starts.find((s) => freeRun(cols[o.side], s) && lane(s));
  if (start === undefined) return undefined;
  const gen = l.gen?.enabled;
  const made: Shelf[] = [];
  for (const side of ['L', 'R'] as const) {
    if (side !== o.side && !freeRun(cols[side], start)) continue; // the other side only if it fits
    const flank = flankOf(l, a, side, line.dir);
    const id = gen && flank?.id.startsWith('g-') ? `${flank.id}~c${newId()}` : `s-${newId()}`;
    made.push({
      kind: 'shelf', id, label: flank?.label ?? `${a.label.replace(/^\s*aisle\s*/i, '')}${side}`, orientation, length: len,
      ...(up ? { x: cols[side], y: start } : { x: start, y: cols[side] }),
      ...(flank?.back !== undefined && { back: flank.back }),
      categories: side === o.side && cat ? [cat] : [],
    });
  }
  // The walkway's label runs on to the new part (as an aisle cut by a walkway keeps one label across it).
  const s0 = up ? a.y : a.x;
  const s1 = s0 + (up ? a.h : a.w);
  const from = Math.min(s0, start);
  const to = Math.max(s1, start + len);
  const grown: AisleLabel = up ? { ...a, y: from, h: to - from } : { ...a, x: from, w: to - from };
  let layout: StoreLayout = { ...l, places: [...l.places, ...made], aisles: (l.aisles ?? []).map((x) => (x.id === a.id ? grown : x)) };
  // On a built map: the new parts are kept, and move with the aisle when the map is rebuilt.
  if (gen && l.gen) {
    const origin = { ...l.gen.origin };
    const locked = new Set(l.gen.locked);
    for (const s of made) {
      if (!s.id.startsWith('g-')) continue;
      const flank = l.places.find((x) => x.id === s.id.replace(/~c\w+$/, ''));
      if (flank) origin[s.id] = { x: flank.x, y: flank.y };
      locked.add(s.id);
    }
    if (a.id.startsWith('g-')) { origin[a.id] ??= { x: a.x, y: a.y }; locked.add(a.id); }
    layout = { ...layout, gen: { ...l.gen, locked: [...locked], origin } };
  }
  const mine = made.find((s) => (up ? s.x : s.y) === cols[o.side])!;
  return {
    layout,
    spotKey: exactKey(mine.id, { u: alongShelf(mine, p), v: 0.5 }),
    note: `${a.label || 'The aisle'} carries on here (${made.map((s) => s.label).join(' and ')}).`,
  };
}
