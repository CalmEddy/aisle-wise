import { aisleNumber, storeFrame } from './clues';
import { exactKey, footprint, parseExactKey } from './geometry';
import type { AisleLabel, Product, Rect, Shelf, StoreLayout } from './types';

/**
 * Cutting a block of aisles in two with a cross aisle: a box dragged across
 * the shelves removes the squares under it, so each shelf it crosses becomes
 * two (the half farther from the entrance keeps its id). Saved item spots
 * and categories follow the half they were on.
 *
 * Aisle labels: by default an aisle stays one aisle across the break (its
 * label is untouched and its number continues on the other side). With
 * "new numbers", the front halves become new aisles numbered on from the
 * highest aisle, in the order of the aisles they came from.
 */

export type CutNumbers = 'same' | 'new';

const newId = () => Math.random().toString(36).slice(2, 8);
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Which shelves run across the box: a wide box cuts up-and-down shelves, a tall one side-to-side shelves. */
export const cutsVertical = (box: Rect) => box.w >= box.h;

interface Piece { id: string; start: number; len: number }

/** What a cut would do: the shelves it crosses (or removes), the squares taken out, and the aisle labels it crosses. */
export function cutPreview(l: StoreLayout, box: Rect, which: 'auto' | 'vertical' | 'horizontal' = 'auto') {
  const vertical = which === 'auto' ? cutsVertical(box) : which === 'vertical';
  const shelves = l.places.filter((p): p is Shelf => p.kind === 'shelf' && (p.orientation === 'vertical') === vertical && overlaps(footprint(p), box));
  const removed = shelves.map((s) => {
    const f = footprint(s);
    const x = Math.max(f.x, box.x);
    const y = Math.max(f.y, box.y);
    return { x, y, w: Math.min(f.x + f.w, box.x + box.w) - x, h: Math.min(f.y + f.h, box.y + box.h) - y };
  });
  const aisles = (l.aisles ?? []).filter((a) => {
    const runsUp = a.h >= a.w;
    if (runsUp !== vertical || !overlaps(a, box)) return false;
    // Crossed: the label carries on past both sides of the box.
    return vertical ? a.y < box.y && a.y + a.h > box.y + box.h : a.x < box.x && a.x + a.w > box.x + box.w;
  });
  return { vertical, shelves, removed, aisles };
}

/** The highest aisle number in the store (0 if none). */
function highestAisle(l: StoreLayout): number {
  return Math.max(0, ...(l.aisles ?? []).map((a) => Math.floor(aisleNumber(a.label.replace(/^\s*aisle\s*/i, '')))).filter((n) => !Number.isNaN(n)));
}

/** Cuts the shelves under `box`. Returns the new store and master list (saved spots moved to the right half). */
export function cutAisles(l: StoreLayout, products: Product[], box: Rect, numbers: CutNumbers, which: 'auto' | 'vertical' | 'horizontal' = 'auto'): { layout: StoreLayout; products: Product[]; cut: number; renamed: string[] } {
  const { vertical, shelves, aisles: crossed } = cutPreview(l, box, which);
  if (!shelves.length) return { layout: l, products, cut: 0, renamed: [] };
  const b0 = vertical ? box.y : box.x;
  const b1 = b0 + (vertical ? box.h : box.w);
  const door = vertical ? l.entrance.y : l.entrance.x;
  // Aisle labels: kept whole, or the front halves become new aisles.
  let labels = l.aisles ?? [];
  const renamed: string[] = [];
  /** Old aisle number → the front half's new number ("1" → "6"). */
  const newNumber = new Map<string, string>();
  if (numbers === 'new' && crossed.length) {
    let n = highestAisle(l);
    const ordered = [...crossed].sort((a, b) => {
      const d = aisleNumber(a.label.replace(/^\s*aisle\s*/i, '')) - aisleNumber(b.label.replace(/^\s*aisle\s*/i, ''));
      return Number.isNaN(d) ? (vertical ? a.x - b.x : a.y - b.y) : d;
    });
    const split = new Map<string, AisleLabel[]>();
    for (const a of ordered) {
      const start = vertical ? a.y : a.x;
      const end = start + (vertical ? a.h : a.w);
      const parts = [{ start, len: b0 - start }, { start: b1, len: end - b1 }]
        .sort((p, q) => Math.abs(q.start + q.len / 2 - door) - Math.abs(p.start + p.len / 2 - door));
      const [backPart, frontPart] = parts;
      const label = /^\s*aisle/i.test(a.label) || !/^\s*\d/.test(a.label) ? `Aisle ${++n}` : String(++n);
      renamed.push(`${a.label} → ${label}`);
      newNumber.set(a.label.replace(/^\s*aisle\s*/i, '').trim().toUpperCase(), String(n));
      const along = (p: { start: number; len: number }) => (vertical ? { y: p.start, h: p.len } : { x: p.start, w: p.len });
      split.set(a.id, [
        { ...a, ...along(backPart) },
        { id: `a-${newId()}`, label, x: a.x, y: a.y, w: a.w, h: a.h, ...along(frontPart) },
      ]);
    }
    labels = labels.flatMap((a) => split.get(a.id) ?? [a]);
  }
  // Per cut shelf: its pieces, and where each category went.
  const pieces = new Map<string, Piece[]>();
  const catHome = new Map<string, Map<string, string>>();
  const out: Shelf[] = [];
  for (const s of shelves) {
    const start = vertical ? s.y : s.x;
    const end = start + s.length;
    const parts = [
      { start, len: Math.min(end, b0) - start },
      { start: Math.max(start, b1), len: end - Math.max(start, b1) },
    ].filter((p) => p.len > 0);
    // The half nearer the entrance is the front; the other keeps the shelf's id.
    parts.sort((a, b) => Math.abs(b.start + b.len / 2 - door) - Math.abs(a.start + a.len / 2 - door));
    const ps: Piece[] = parts.map((p, i) => ({ ...p, id: i === 0 ? s.id : `cut-${newId()}` }));
    pieces.set(s.id, ps);
    const homes = new Map<string, string>();
    const at = (pos: number) => nearestPiece(ps, pos);
    const cats = new Map<string, string[]>(ps.map((p) => [p.id, []]));
    s.categories.forEach((c, i) => {
      const p = at(start + ((i + 0.5) / s.categories.length) * s.length);
      if (!p) return;
      cats.get(p.id)!.push(c);
      homes.set(c, p.id);
    });
    catHome.set(s.id, homes);
    for (const p of ps) {
      out.push({
        ...s, id: p.id, length: p.len, categories: cats.get(p.id)!,
        ...(vertical ? { y: p.start } : { x: p.start }),
        ...(p.id !== s.id && { label: frontLabel(s.label, numbers, newNumber) }),
      });
    }
  }
  const cutIds = new Set(shelves.map((s) => s.id));
  const places = [...l.places.filter((p) => !cutIds.has(p.id)), ...out];

  // Saved spots follow their half.
  const moved = products.map((p) => {
    const key = p.locations?.[l.id];
    if (!key) return p;
    const next = moveKey(key, shelves, pieces, catHome, vertical);
    if (next === key) return p;
    const locations = { ...p.locations };
    if (next) locations[l.id] = next;
    else delete locations[l.id];
    return { ...p, locations };
  });

  return { layout: { ...l, places, aisles: labels }, products: moved, cut: shelves.length, renamed };
}

/**
 * The front half's label: the same as the back half's when the aisles carry
 * on; with new numbers, "1R" becomes "6R" (or "Pasta" becomes "Pasta (front)").
 */
function frontLabel(label: string, numbers: CutNumbers, newNumber: Map<string, string>): string {
  if (numbers === 'same' || !label) return label;
  const m = /^(\d+[A-Z]?)([LR])$/i.exec(label.trim());
  const to = m && newNumber.get(m[1].toUpperCase());
  return to ? `${to}${m![2]}` : `${label} (front)`;
}

function nearestPiece(ps: Piece[], pos: number): Piece | undefined {
  let best: Piece | undefined;
  let gap = Infinity;
  for (const p of ps) {
    const d = pos < p.start ? p.start - pos : pos >= p.start + p.len ? pos - (p.start + p.len) + 1e-6 : 0;
    if (d < gap) { best = p; gap = d; }
  }
  return best;
}

/** A saved spot key after the cut (undefined: its shelf is gone). */
function moveKey(key: string, shelves: Shelf[], pieces: Map<string, Piece[]>, catHome: Map<string, Map<string, string>>, vertical: boolean): string | undefined {
  const exact = parseExactKey(key);
  const placeId = exact ? exact.placeId : key.split(':')[0];
  const ps = pieces.get(placeId);
  if (!ps) return key;
  if (!ps.length) return undefined;
  const s = shelves.find((x) => x.id === placeId)!;
  const start = vertical ? s.y : s.x;
  if (exact) {
    const pos = start + exact.spot.u * s.length;
    const p = nearestPiece(ps, pos)!;
    const u = Math.min(0.99, Math.max(0.01, (pos - p.start) / p.len));
    return exactKey(p.id, { u, v: exact.spot.v });
  }
  const cat = key.split(':')[1];
  if (cat) {
    const home = catHome.get(placeId)?.get(cat) ?? ps[0].id;
    return `${home}:${cat}`;
  }
  return ps.some((p) => p.id === placeId) ? key : ps[0].id;
}

/**
 * Numbers the store's aisles 1, 2, 3… : the block farthest from the door
 * first (so the front halves of cut aisles come after), and within a block
 * from the door's side across. Labels that aren't numbers (e.g. "Seasonal")
 * are left alone.
 */
export function renumberAisles(l: StoreLayout): StoreLayout {
  const frame = storeFrame(l);
  const door = frame.toStore(l.entrance);
  const numbered = (a: AisleLabel) => /^\s*(aisle\s*)?\d+[a-z]?\s*$/i.test(a.label);
  const centre = (a: AisleLabel) => frame.toStore({ x: a.x + a.w / 2, y: a.y + a.h / 2 });
  const order = (l.aisles ?? []).filter(numbered).sort((a, b) => {
    const ca = centre(a);
    const cb = centre(b);
    const block = Math.round(cb.v * 10) - Math.round(ca.v * 10);
    return block || Math.abs(ca.u - door.u) - Math.abs(cb.u - door.u);
  });
  const names = new Map(order.map((a, i) => [a.id, /^\s*aisle/i.test(a.label) ? `Aisle ${i + 1}` : String(i + 1)]));
  return { ...l, aisles: (l.aisles ?? []).map((a) => (names.has(a.id) ? { ...a, label: names.get(a.id)! } : a)) };
}

/**
 * Clears the shelves under an area (a display or promo space put down over
 * them): every shelf it covers, whichever way it runs, is split around it.
 * Aisle labels are left as they are (the aisles carry on past it).
 */
export function cutUnder(l: StoreLayout, products: Product[], area: Rect): { layout: StoreLayout; products: Product[]; cut: number } {
  const a = cutAisles(l, products, area, 'same', 'vertical');
  const b = cutAisles(a.layout, a.products, area, 'same', 'horizontal');
  return { layout: b.layout, products: b.products, cut: a.cut + b.cut };
}

/** Shelves an area covers (to offer cutting them). */
export function shelvesUnder(l: StoreLayout, area: Rect): number {
  return cutPreview(l, area, 'vertical').shelves.length + cutPreview(l, area, 'horizontal').shelves.length;
}
