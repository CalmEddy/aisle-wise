import { shelvesAcross } from './build';
import type { AisleLabel, Place, Rect, Shelf, StoreLayout } from './types';

/**
 * Aisle labels: names for walkways ("Aisle 5"), drawn along the floor
 * between shelves. They're only labels – walking and routes ignore them.
 */

const newId = () => Math.random().toString(36).slice(2, 10);

/** The next free "Aisle N". */
export function nextAisleLabel(l: StoreLayout): string {
  const used = new Set((l.aisles ?? []).map((a) => /^Aisle (\d+)$/.exec(a.label.trim())?.[1]).filter(Boolean).map(Number));
  let n = 1;
  while (used.has(n)) n++;
  return `Aisle ${n}`;
}

/**
 * The walkway you're standing in: the floor between the shelves on either
 * side of you (up to `maxWidth` apart), along the stretch where both run.
 */
export function walkwayAt(l: StoreLayout, p: { x: number; y: number }, maxWidth = 6): Rect | undefined {
  const sides = shelvesAcross(l, p, maxWidth);
  if (sides.length < 2) return undefined;
  const [a, b] = sides.map((s) => l.places.find((pl) => pl.id === s.shelfId) as Shelf);
  const v = a.orientation === 'vertical';
  const startA = v ? a.y : a.x;
  const startB = v ? b.y : b.x;
  const from = Math.max(startA, startB);
  const to = Math.min(startA + a.length, startB + b.length) - 1;
  const lo = (v ? a.x : a.y) + 1;
  const hi = (v ? b.x : b.y) - 1;
  if (to < from || hi < lo) return undefined;
  return v ? { x: lo, y: from, w: hi - lo + 1, h: to - from + 1 } : { x: from, y: lo, w: to - from + 1, h: hi - lo + 1 };
}

/** Adds an aisle label over `rect`, replacing any label already on that floor. */
export function addAisle(l: StoreLayout, rect: Rect, label: string): { layout: StoreLayout; aisle: AisleLabel } {
  const aisle: AisleLabel = { id: `a-${newId()}`, label, ...rect };
  const others = (l.aisles ?? []).filter((a) => !overlaps(a, rect));
  return { layout: { ...l, aisles: [...others, aisle] }, aisle };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Extends the label `label` over a walkway just painted (`lane`): if a label
 * of that name runs straight into it (same width, end to end), it grows;
 * otherwise a new one starts (e.g. after turning a corner).
 */
export function paintAisle(l: StoreLayout, lane: Rect, label: string): StoreLayout {
  const aisles = l.aisles ?? [];
  const joins = (a: AisleLabel) => a.label === label && (
    (a.x === lane.x && a.w === lane.w && a.y <= lane.y + lane.h && lane.y <= a.y + a.h)
    || (a.y === lane.y && a.h === lane.h && a.x <= lane.x + lane.w && lane.x <= a.x + a.w));
  const hit = aisles.find(joins);
  if (!hit) return addAisle(l, lane, label).layout;
  const x = Math.min(hit.x, lane.x);
  const y = Math.min(hit.y, lane.y);
  const grown = { ...hit, x, y, w: Math.max(hit.x + hit.w, lane.x + lane.w) - x, h: Math.max(hit.y + hit.h, lane.y + lane.h) - y };
  return { ...l, aisles: aisles.map((a) => (a.id === hit.id ? grown : a)) };
}

export function renameAisle(l: StoreLayout, id: string, label: string): StoreLayout {
  return { ...l, aisles: (l.aisles ?? []).map((a) => (a.id === id ? { ...a, label } : a)) };
}

export function removeAisle(l: StoreLayout, id: string): StoreLayout {
  return { ...l, aisles: (l.aisles ?? []).filter((a) => a.id !== id) };
}

/** Keeps aisle labels inside the store after it's resized (dropping any left outside). */
export function clipAisles(l: StoreLayout): StoreLayout {
  if (!l.aisles?.length) return l;
  const aisles = l.aisles
    .map((a) => {
      const x = Math.max(0, a.x);
      const y = Math.max(0, a.y);
      return { ...a, x, y, w: Math.min(a.x + a.w, l.width) - x, h: Math.min(a.y + a.h, l.height) - y };
    })
    .filter((a) => a.w > 0 && a.h > 0);
  return { ...l, aisles };
}

// ---------------------------------------------------------------------------
// Whole aisles (a label and the shelves on both sides), one or a group at a time

/** The shelves along either side of an aisle's walkway. */
export function aisleShelves(l: StoreLayout, a: AisleLabel): Shelf[] {
  const vertical = a.h >= a.w;
  return l.places.filter((p): p is Shelf => {
    if (p.kind !== 'shelf' || (p.orientation === 'vertical') !== vertical) return false;
    if (vertical) return (p.x === a.x - 1 || p.x === a.x + a.w) && p.y < a.y + a.h && p.y + p.length > a.y;
    return (p.y === a.y - 1 || p.y === a.y + a.h) && p.x < a.x + a.w && p.x + p.length > a.x;
  });
}

const shelfRect = (s: Shelf): Rect => (s.orientation === 'vertical' ? { x: s.x, y: s.y, w: 1, h: s.length } : { x: s.x, y: s.y, w: s.length, h: 1 });
const placeRect = (p: StoreLayout['places'][number]): Rect => (p.kind === 'shelf' ? shelfRect(p) : { x: p.x, y: p.y, w: p.w, h: p.h });
const inside = (l: StoreLayout, r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= l.width && r.y + r.h <= l.height;

/**
 * Whether new rectangles fit: inside the store, clear of every place not in
 * `places`, and clear of every aisle label not in `aisles` (aisles never
 * overlap each other).
 */
function fits(l: StoreLayout, places: Set<string>, aisles: Set<string>, rects: Rect[]): boolean {
  const others = [
    ...l.places.filter((p) => !places.has(p.id)).map(placeRect),
    ...(l.aisles ?? []).filter((a) => !aisles.has(a.id)),
  ];
  return rects.every((r) => inside(l, r) && !others.some((o) => overlaps(o, r)));
}

/**
 * A selection: aisles (with every shelf along them) and any places picked
 * on their own (shelves, departments, areas), by id.
 */
function group(l: StoreLayout, ids: string[]) {
  const labels = (l.aisles ?? []).filter((a) => ids.includes(a.id));
  const places = new Map<string, Place>();
  for (const a of labels) for (const s of aisleShelves(l, a)) places.set(s.id, s);
  for (const p of l.places) if (ids.includes(p.id)) places.set(p.id, p);
  return { labels, places: [...places.values()] };
}

/** What a dragged box touches: aisles' walkways and places. */
export function selectionIn(l: StoreLayout, box: Rect): string[] {
  return [...(l.aisles ?? []).filter((a) => overlaps(a, box)).map((a) => a.id), ...l.places.filter((p) => overlaps(placeRect(p), box)).map((p) => p.id)];
}

/** The aisles whose walkways a box touches. */
export function aislesIn(l: StoreLayout, box: Rect): string[] {
  return (l.aisles ?? []).filter((a) => overlaps(a, box)).map((a) => a.id);
}

/** Moves a selection (aisles with their shelves, and places) by dx, dy squares. Unchanged if they'd hit something or leave the store. */
export function moveAisles(l: StoreLayout, ids: string[], dx: number, dy: number): { layout: StoreLayout; ok: boolean } {
  const { labels, places } = group(l, ids);
  if (!labels.length && !places.length) return { layout: l, ok: false };
  const placeIds = new Set(places.map((s) => s.id));
  const labelIds = new Set(labels.map((a) => a.id));
  const shift = <T extends Rect | Place>(r: T): T => ({ ...r, x: r.x + dx, y: r.y + dy });
  if (!fits(l, placeIds, labelIds, [...labels.map(shift), ...places.map((s) => shift(placeRect(s)))])) return { layout: l, ok: false };
  return {
    layout: {
      ...l,
      places: l.places.map((p) => (placeIds.has(p.id) ? shift(p) : p)),
      aisles: (l.aisles ?? []).map((x) => (labelIds.has(x.id) ? shift(x) : x)),
    },
    ok: true,
  };
}

export const moveAisle = (l: StoreLayout, id: string, dx: number, dy: number) => moveAisles(l, [id], dx, dy);

/** Whether a selection mostly runs up and down (its aisles, else its shelves). */
export function runsUp(l: StoreLayout, ids: string[]): boolean {
  const { labels, places } = group(l, ids);
  if (labels.length) return labels.filter((a) => a.h >= a.w).length * 2 >= labels.length;
  const shelves = places.filter((p): p is Shelf => p.kind === 'shelf');
  if (shelves.length) return shelves.filter((s) => s.orientation === 'vertical').length * 2 >= shelves.length;
  return true;
}

/** The box round a selection (undefined: nothing selected). */
export function selectionRect(l: StoreLayout, ids: string[]): Rect | undefined {
  const { labels, places } = group(l, ids);
  const rects = [...labels, ...places.map(placeRect)];
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

/**
 * Turns aisles a quarter turn as one block about its middle (up-and-down ↔
 * side-to-side): 5 aisles side by side become 5 aisles stacked. Each shelf
 * keeps its order (top becomes left, left becomes top), so saved spots and
 * categories stay where they were along it; wall shelves keep their backs
 * away from the walkway. Unchanged if the turned block would hit something.
 */
export function turnAisles(l: StoreLayout, ids: string[]): { layout: StoreLayout; ok: boolean } {
  const { labels, places } = group(l, ids);
  if (!labels.length && !places.length) return { layout: l, ok: false };
  // Turn the way most of the group runs now.
  const wasVertical = runsUp(l, ids);
  const moving = [...labels, ...places.map(placeRect)];
  const x0 = Math.min(...moving.map((r) => r.x));
  const y0 = Math.min(...moving.map((r) => r.y));
  const GW = Math.max(...moving.map((r) => r.x + r.w)) - x0;
  const GH = Math.max(...moving.map((r) => r.y + r.h)) - y0;
  // The turned block, centred where it was.
  const nx0 = Math.round(x0 + GW / 2 - GH / 2);
  const ny0 = Math.round(y0 + GH / 2 - GW / 2);
  const turn = (r: Rect): Rect => {
    const rx = r.x - x0;
    const ry = r.y - y0;
    // Up-and-down turns anticlockwise (top → left); side-to-side turns clockwise (left → top).
    return wasVertical
      ? { x: nx0 + ry, y: ny0 + (GW - (rx + r.w)), w: r.h, h: r.w }
      : { x: nx0 + (GH - (ry + r.h)), y: ny0 + rx, w: r.h, h: r.w };
  };
  const turnedLabels = new Map(labels.map((a) => [a.id, { ...a, ...turn(a) }]));
  const turned = new Map(places.map((s): [string, Place] => {
    const r = turn(placeRect(s));
    if (s.kind !== 'shelf') return [s.id, { ...s, ...r }];
    const vertical = s.orientation === 'vertical';
    const next: Shelf = {
      ...s, x: r.x, y: r.y, orientation: vertical ? 'horizontal' : 'vertical',
      ...(s.back !== undefined && { back: (-s.back) as -1 | 1 }),
    };
    return [s.id, next];
  }));
  const ok = fits(l, new Set(turned.keys()), new Set(turnedLabels.keys()), [...turnedLabels.values(), ...[...turned.values()].map(placeRect)]);
  if (!ok) return { layout: l, ok: false };
  return {
    layout: {
      ...l,
      places: l.places.map((p) => turned.get(p.id) ?? p),
      aisles: (l.aisles ?? []).map((x) => turnedLabels.get(x.id) ?? x),
    },
    ok: true,
  };
}

export const turnAisle = (l: StoreLayout, id: string) => turnAisles(l, [id]);

/** Deletes a selection: aisles' labels, their shelves unless a remaining aisle also uses them, and places picked on their own. */
export function deleteAisles(l: StoreLayout, ids: string[]): StoreLayout {
  const { labels, places } = group(l, ids);
  const labelIds = new Set(labels.map((a) => a.id));
  const keep = (l.aisles ?? []).filter((a) => !labelIds.has(a.id));
  const shared = new Set(keep.flatMap((a) => aisleShelves(l, a).map((s) => s.id)));
  const gone = new Set(places.map((s) => s.id).filter((id) => ids.includes(id) || !shared.has(id)));
  return { ...l, places: l.places.filter((p) => !gone.has(p.id)), aisles: keep };
}

/**
 * Moves or resizes one shelf, keeping the aisles it borders: moved away from
 * its aisle, the walkway widens; moved into it, it narrows; slid along, the
 * aisle runs the length of both sides. Refused (unchanged) if the shelf would
 * land on another place or another aisle's walkway, close its own walkway,
 * or leave the store.
 */
export function moveShelf(l: StoreLayout, id: string, patch: Partial<Shelf>): { layout: StoreLayout; ok: boolean } {
  const s = l.places.find((p): p is Shelf => p.id === id && p.kind === 'shelf');
  if (!s) return { layout: l, ok: false };
  const next: Shelf = { ...s, ...patch };
  const own = (l.aisles ?? []).filter((a) => aisleShelves(l, a).some((x) => x.id === id));
  const ownIds = new Set(own.map((a) => a.id));
  // The shelf itself: in the store, on open floor (its own walkways are fine).
  if (!fits(l, new Set([id]), ownIds, [shelfRect(next)])) return { layout: l, ok: false };
  const sameDirection = next.orientation === s.orientation;
  const refit = new Map<string, AisleLabel>();
  if (sameDirection) {
    for (const a of own) {
      const vertical = a.h >= a.w;
      const sides = aisleShelves(l, a).map((x) => (x.id === id ? next : x));
      const across = (r: Rect) => (vertical ? r.x : r.y);
      // Which side each shelf was on before the move decides its side now.
      const wasLow = (x: Shelf) => across(shelfRect(x.id === id ? s : x)) < across(a);
      const lows = sides.filter(wasLow);
      const highs = sides.filter((x) => !wasLow(x));
      const from = lows.length ? Math.max(...lows.map((x) => across(shelfRect(x)) + 1)) : across(a);
      const to = highs.length ? Math.min(...highs.map((x) => across(shelfRect(x)))) : across(a) + (vertical ? a.w : a.h);
      if (to - from < 1) return { layout: l, ok: false };
      const along = (r: Rect) => (vertical ? [r.y, r.y + r.h] : [r.x, r.x + r.w]);
      const runs = sides.map((x) => along(shelfRect(x)));
      const a0 = Math.min(...runs.map((r) => r[0]));
      const a1 = Math.max(...runs.map((r) => r[1]));
      refit.set(a.id, vertical ? { ...a, x: from, w: to - from, y: a0, h: a1 - a0 } : { ...a, y: from, h: to - from, x: a0, w: a1 - a0 });
    }
  }
  // Refitted walkways mustn't run into other places or aisles.
  for (const a of refit.values()) {
    const mine = new Set(aisleShelves(l, own.find((o) => o.id === a.id)!).map((x) => x.id));
    mine.add(id);
    if (!fits(l, mine, ownIds, [a])) return { layout: l, ok: false };
  }
  return {
    layout: {
      ...l,
      places: l.places.map((p) => (p.id === id ? next : p)),
      aisles: (l.aisles ?? []).map((a) => refit.get(a.id) ?? a),
    },
    ok: true,
  };
}
