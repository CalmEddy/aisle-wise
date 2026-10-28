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
