import { shelvesAcross } from './build';
import type { AisleLabel, Rect, Shelf, StoreLayout } from './types';

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
// Moving and turning a whole aisle: its label and the shelves on both sides

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

/** Whether the aisle's new parts fit: inside the store, and clear of everything else. */
function fits(l: StoreLayout, moving: Set<string>, rects: Rect[]): boolean {
  const others = l.places.filter((p) => !moving.has(p.id)).map(placeRect);
  return rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= l.width && r.y + r.h <= l.height && !others.some((o) => overlaps(o, r)));
}

/** Moves an aisle (label and both shelves) by dx, dy squares. Unchanged if there's no room. */
export function moveAisle(l: StoreLayout, id: string, dx: number, dy: number): { layout: StoreLayout; ok: boolean } {
  const a = (l.aisles ?? []).find((x) => x.id === id);
  if (!a) return { layout: l, ok: false };
  const shelves = aisleShelves(l, a);
  const moving = new Set(shelves.map((s) => s.id));
  const shift = <T extends Rect | Shelf>(r: T): T => ({ ...r, x: r.x + dx, y: r.y + dy });
  if (!fits(l, moving, [shift(a), ...shelves.map((s) => shift(shelfRect(s)))])) return { layout: l, ok: false };
  return {
    layout: {
      ...l,
      places: l.places.map((p) => (moving.has(p.id) ? shift(p as Shelf) : p)),
      aisles: (l.aisles ?? []).map((x) => (x.id === id ? shift(x) : x)),
    },
    ok: true,
  };
}

/**
 * Turns an aisle a quarter turn about its middle (up-and-down ↔ side-to-side),
 * label and shelves together. Each shelf keeps its order (top becomes left,
 * left becomes top), so saved spots and categories stay where they were
 * along it; wall shelves keep their back away from the walkway.
 */
export function turnAisle(l: StoreLayout, id: string): { layout: StoreLayout; ok: boolean } {
  const a = (l.aisles ?? []).find((x) => x.id === id);
  if (!a) return { layout: l, ok: false };
  const shelves = aisleShelves(l, a);
  const parts: Rect[] = [a, ...shelves.map(shelfRect)];
  const x0 = Math.min(...parts.map((r) => r.x));
  const y0 = Math.min(...parts.map((r) => r.y));
  const GW = Math.max(...parts.map((r) => r.x + r.w)) - x0;
  const GH = Math.max(...parts.map((r) => r.y + r.h)) - y0;
  // The turned group, centred where it was.
  const nx0 = Math.round(x0 + GW / 2 - GH / 2);
  const ny0 = Math.round(y0 + GH / 2 - GW / 2);
  const wasVertical = a.h >= a.w;
  const turn = (r: Rect): Rect => {
    const rx = r.x - x0;
    const ry = r.y - y0;
    // Up-and-down turns anticlockwise (top → left); side-to-side turns clockwise (left → top).
    return wasVertical
      ? { x: nx0 + ry, y: ny0 + (GW - (rx + r.w)), w: r.h, h: r.w }
      : { x: nx0 + (GH - (ry + r.h)), y: ny0 + rx, w: r.h, h: r.w };
  };
  const label = { ...a, ...turn(a) };
  const turned = new Map(shelves.map((s) => {
    const r = turn(shelfRect(s));
    const next: Shelf = {
      ...s, x: r.x, y: r.y, orientation: wasVertical ? 'horizontal' : 'vertical',
      ...(s.back !== undefined && { back: (-s.back) as -1 | 1 }),
    };
    return [s.id, next];
  }));
  if (!fits(l, new Set(turned.keys()), [label, ...[...turned.values()].map(shelfRect)])) return { layout: l, ok: false };
  return {
    layout: {
      ...l,
      places: l.places.map((p) => turned.get(p.id) ?? p),
      aisles: (l.aisles ?? []).map((x) => (x.id === id ? label : x)),
    },
    ok: true,
  };
}
