import { aisleNumber, DEPTS, findAisle, guessDept } from './clues';
import { footprint } from './geometry';
import type { AisleLabel, AislePos, Area, Arrangement, Clue, Dept, Fixture, GeneratedMap, OpenNear, Place, Product, Rect, Shelf, StoreLayout, Temp, Wall, WallPart } from './types';

/**
 * Building a store map from shoppers' "Where was it?" answers.
 *
 * 1. The answers become a model of the store: which aisles exist (all from 1
 *    up to the highest number heard), what's on each side of each aisle, and
 *    which departments there are.
 * 2. The model becomes a map in the shape of a typical supermarket: numbered
 *    aisles of back-to-back shelves across the middle (aisle 1 nearest the
 *    entrance), Produce along the entrance-side wall, Frozen along the far
 *    wall, the other departments along the back, checkout across the front.
 *
 * Generated parts have stable ids ("g-…"). Anything the shopper changes or
 * deletes is listed in `gen.locked` and never regenerated; places they add
 * themselves are left alone, and generated parts that would overlap them
 * are skipped.
 */

/** Squares along each aisle. */
export const AISLE_LENGTH = 14;
/** The other departments, in order along the back wall from the entrance side. */
export const BACK_WALL: Dept[] = ['bakery', 'deli', 'meat', 'seafood', 'dairy'];
const FRONT_CORNER_NEAR: Dept[] = ['floral'];
const FRONT_CORNER_FAR: Dept[] = ['pharmacy'];

interface AisleModel {
  /** As said ("7", "12B"). */
  label: string;
  /** Mentioned in an answer (otherwise it's a guess filling a gap). */
  seen: boolean;
  freezer: boolean;
  /** Fridges along it (and not freezers). */
  chilled?: boolean;
  /** Categories on each side, with how far along (for ordering). */
  sides: { L: { categoryId: string; pos: AislePos }[]; R: { categoryId: string; pos: AislePos }[] };
}

/** A stretch of wall: a department, or fridges, freezers or shelves along it. */
export interface SectionModel {
  /** A department's id, or "<wall>-<chilled|frozen|shelf>". */
  key: string;
  dept?: Dept;
  /** The wall the answers put it on (most said); missing: its usual wall. */
  wall?: Wall;
  /** How far along the wall, 0–1 (side walls front→back, back wall left→right), when said. */
  along?: number;
  /** Answers for it. */
  count: number;
  temp?: Temp;
  categories: string[];
}

/** A table, case or stand out on the floor. */
export interface IslandModel {
  key: string;
  near: OpenNear;
  /** Next to this aisle (its label), instead of `near`. */
  aisle?: string;
  fixture?: Fixture;
  temp?: Temp;
  categories: string[];
}

export interface StoreModel {
  aisles: AisleModel[];
  /** Departments heard of. */
  depts: Dept[];
  /** Everything along the walls (departments included). */
  sections: SectionModel[];
  islands: IslandModel[];
  checkout: boolean;
}

const POS_ORDER: Record<AislePos, number> = { front: 0, middle: 1, back: 2 };

const PART_ALONG: Record<WallPart, number> = { front: 0.15, left: 0.15, middle: 0.5, back: 0.85, right: 0.85 };

/** What the answers for one store say about it. */
export function buildModel(products: Product[], layoutId: string): StoreModel {
  const aisles = new Map<string, AisleModel>();
  const depts = new Set<Dept>();
  const sections = new Map<string, SectionModel & { walls: Wall[]; alongs: number[]; temps: Temp[] }>();
  const islands = new Map<string, IslandModel>();
  let checkout = false;
  const aisle = (label: string) => {
    const key = label.trim().toUpperCase();
    let a = aisles.get(key);
    if (!a) aisles.set(key, (a = { label: key, seen: true, freezer: false, sides: { L: [], R: [] } }));
    return a;
  };
  const section = (key: string, dept?: Dept) => {
    let sec = sections.get(key);
    if (!sec) sections.set(key, (sec = { key, ...(dept && { dept }), count: 0, categories: [], walls: [], alongs: [], temps: [] }));
    sec.count++;
    return sec;
  };
  const addCat = (list: string[], c?: string) => { if (c && !list.includes(c)) list.push(c); };
  for (const p of products) {
    const c: Clue | undefined = p.clues?.[layoutId];
    if (!c) continue;
    switch (c.kind) {
      case 'aisle':
      case 'freezer': {
        if (!c.aisle) {
          // An older "freezer along a wall" answer.
          depts.add('frozen');
          section('frozen', 'frozen');
          break;
        }
        const a = aisle(c.aisle);
        if (c.kind === 'freezer' || c.temp === 'frozen') a.freezer = true;
        else if (c.kind === 'aisle' && c.temp === 'chilled') a.chilled = true;
        if (p.categoryId) a.sides[c.side ?? 'L'].push({ categoryId: p.categoryId, pos: c.pos ?? 'middle' });
        break;
      }
      case 'endcap': aisle(c.aisle); break;
      case 'wall': {
        // Fridges and freezers along a wall are one run whatever's in them; otherwise the item's department.
        const dept = c.temp ? undefined : guessDept(p.categoryId);
        const sec = section(dept ?? `${c.wall}-${c.temp ?? 'shelf'}`, dept);
        if (dept) depts.add(dept);
        sec.walls.push(c.wall);
        if (c.part) sec.alongs.push(PART_ALONG[c.part]);
        if (c.temp) sec.temps.push(c.temp);
        if (!dept) addCat(sec.categories, p.categoryId);
        break;
      }
      case 'open': {
        if (c.aisle) aisle(c.aisle);
        const near = c.near ?? 'middle';
        const key = `${c.aisle ? `a${c.aisle.trim().toUpperCase()}` : near}-${c.fixture ?? 'any'}-${c.temp ?? 'room'}`;
        let isl = islands.get(key);
        if (!isl) islands.set(key, (isl = { key, near, ...(c.aisle && { aisle: c.aisle.trim().toUpperCase() }), ...(c.fixture && { fixture: c.fixture }), ...(c.temp && { temp: c.temp }), categories: [] }));
        addCat(isl.categories, p.categoryId);
        break;
      }
      case 'display':
        if (c.aisle) aisle(c.aisle);
        if (c.dept) { depts.add(c.dept); section(c.dept, c.dept); }
        break;
      case 'dept': depts.add(c.dept); section(c.dept, c.dept); break;
      case 'checkout': checkout = true; break;
    }
  }
  // Every aisle from 1 to the highest heard; letters (12A, 12B) stand in for their number.
  const seen = [...aisles.values()];
  const max = Math.max(0, ...seen.map((a) => Math.floor(aisleNumber(a.label))).filter((n) => !Number.isNaN(n)));
  const all: AisleModel[] = [];
  for (let n = 1; n <= max; n++) {
    const these = seen.filter((a) => Math.floor(aisleNumber(a.label)) === n).sort((a, b) => aisleNumber(a.label) - aisleNumber(b.label));
    all.push(...(these.length ? these : [{ label: String(n), seen: false, freezer: false, sides: { L: [], R: [] } }]));
  }
  // Aisles with names that aren't numbers go after the numbered ones.
  all.push(...seen.filter((a) => Number.isNaN(aisleNumber(a.label))));
  const most = <T,>(xs: T[]): T | undefined => {
    const n = new Map<T, number>();
    for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const secs: SectionModel[] = [...sections.values()].map(({ walls, alongs, temps, ...sec }) => {
    const wall = most(walls);
    const temp = most(temps) ?? (sec.key.endsWith('-chilled') ? 'chilled' : sec.key.endsWith('-frozen') ? 'frozen' : undefined);
    return {
      ...sec,
      ...(wall && { wall }),
      ...(alongs.length && { along: alongs.reduce((x, y) => x + y, 0) / alongs.length }),
      ...(temp && { temp }),
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
  return { aisles: all, depts: [...depts], sections: secs, islands: [...islands.values()].sort((a, b) => a.key.localeCompare(b.key)), checkout };
}

/** What a map is generated with: the entrance corner and the arrangement. */
export type GenSettings = Arrangement & { entrance: GeneratedMap['entrance'] };

/** A short fingerprint of what a map would be generated from. */
export function modelKey(model: StoreModel, settings: GenSettings): string {
  return JSON.stringify({
    e: settings.entrance,
    // Only when not the usual, so maps made before these settings existed aren't rebuilt.
    ...(settings.aisleOne === 'far' && { a1: 'far' }),
    ...(settings.produce === 'far' && { p: 'far' }),
    ...(settings.backWall === 'reversed' && { b: 'rev' }),
    a: model.aisles.map((a) => [a.label, a.seen ? 1 : 0, a.freezer ? 1 : a.chilled ? 2 : 0, cats(a, 'L'), cats(a, 'R')]),
    d: [...model.depts].sort(),
    s: model.sections.map((x) => [x.key, x.wall ?? '', x.along === undefined ? '' : Math.round(x.along * 20), Math.min(x.count, 9), x.temp ?? '', x.categories]),
    i: model.islands.map((x) => [x.key, x.categories]),
    c: model.checkout,
  });
}

/** Categories on one side of an aisle, ordered top to bottom of the map (back of the store first). */
function cats(a: AisleModel, side: 'L' | 'R'): string[] {
  const sorted = [...a.sides[side]].sort((x, y) => POS_ORDER[y.pos] - POS_ORDER[x.pos]);
  return [...new Set(sorted.map((s) => s.categoryId))];
}

const deptInfo = (d: Dept) => DEPTS.find((x) => x.id === d)!;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The generated parts of a map for a model (ids "g-…"), and the store's size, entrance and checkout. */
export function generateParts(model: StoreModel, entrance: GeneratedMap['entrance'], arrangement: Arrangement = {}) {
  const n = model.aisles.length;
  const L = AISLE_LENGTH;
  const x0 = 6; // first shelf column (side wall area x 1–4, walkway at x 5)
  const width = Math.max(4 * n + 12, model.sections.length || model.islands.length ? 20 : 0);
  // Room for tables and cases out in the open, when there are any.
  const band = model.islands.length ? 4 : 0;
  const height = L + 13 + band;
  const yShelf = 6;
  const mirror = (r: Rect): Rect => (entrance === 'left' ? r : { ...r, x: width - r.x - r.w });
  const places: Place[] = [];
  const aisles: AisleLabel[] = [];
  const area = (d: Dept, r: Rect): Area => ({ kind: 'area', id: `g-dept-${d}`, label: deptInfo(d).name, ...mirror(r), categories: [...deptInfo(d).categories] });

  // Aisles, numbered from the entrance side (or from the far side). Slot i (from the left) holds shelves at x0+4i (left side) and x0+4i+3 (right side).
  model.aisles.forEach((a, k) => {
    const fromEntrance = arrangement.aisleOne === 'far' ? n - 1 - k : k;
    const slot = entrance === 'left' ? fromEntrance : n - 1 - fromEntrance;
    const walk: Rect = { x: x0 + 1 + 4 * slot, y: yShelf, w: 2, h: L };
    aisles.push({ id: `g-aisle-${a.label}`, label: `Aisle ${a.label}`, ...walk, ...(a.seen ? {} : { guess: true }) });
    for (const side of ['L', 'R'] as const) {
      // Walking up the aisle from the front, left is the smaller x.
      const x = side === 'L' ? walk.x - 1 : walk.x + 2;
      const shelf: Shelf = {
        kind: 'shelf', id: `g-shelf-${a.label}-${side}`, label: `${a.label}${side}`,
        orientation: 'vertical', x, y: yShelf, length: L, categories: cats(a, side), ...(a.seen ? {} : { guess: true }),
        ...(a.freezer ? { temp: 'frozen' as const } : a.chilled ? { temp: 'chilled' as const } : {}),
      };
      places.push(shelf);
    }
  });

  // Along the walls: each wall is a chain of shelf sections. Departments go on the wall the answers say,
  // or their usual one: Produce up the entrance-side wall, Frozen up the far wall (or swapped),
  // the rest along the back from the entrance side. Floral and Pharmacy take the front corners.
  const sideRun = { from: yShelf, len: L };
  const backRun = { from: 1, len: width - 2 };
  const entranceWall: Wall = entrance === 'left' ? 'left' : 'right';
  const farSide: Wall = entrance === 'left' ? 'right' : 'left';
  const produceFar = arrangement.produce === 'far';
  const back = BACK_WALL.filter((d) => model.depts.includes(d));
  if (arrangement.backWall === 'reversed') back.reverse();
  const placed: { sec: SectionModel; wall: Wall; along: number }[] = [];
  const corners: Dept[] = [];
  for (const sec of model.sections) {
    let wall = sec.wall;
    let along = sec.along;
    if (!wall) {
      const d = sec.dept;
      if (d === 'produce') wall = produceFar ? farSide : entranceWall;
      else if (d === 'frozen') wall = produceFar ? entranceWall : farSide;
      else if (d && back.includes(d)) {
        wall = 'back';
        const t = (back.indexOf(d) + 0.5) / back.length;
        along ??= entrance === 'left' ? t : 1 - t;
      } else if (d && (FRONT_CORNER_NEAR.includes(d) || FRONT_CORNER_FAR.includes(d))) {
        corners.push(d);
        continue;
      } else wall = 'back';
    }
    placed.push({ sec, wall, along: along ?? 0.5 });
  }
  const weight = (sec: SectionModel) => 1 + 0.25 * Math.min(sec.count - 1, 8);
  for (const wall of ['left', 'back', 'right'] as Wall[]) {
    const here = placed.filter((p) => p.wall === wall).sort((a, b) => a.along - b.along || a.sec.key.localeCompare(b.sec.key));
    if (!here.length) continue;
    const run = wall === 'back' ? backRun : sideRun;
    const total = here.reduce((t, p) => t + weight(p.sec), 0);
    let done = 0;
    here.forEach(({ sec }, i) => {
      const start = Math.round((done / total) * run.len);
      done += weight(sec);
      const end = i === here.length - 1 ? run.len : Math.round((done / total) * run.len);
      const len = Math.max(1, end - start);
      places.push(wallSection(sec, wall, start, len));
    });
  }
  /** One section of wall: `start` squares along it (side walls from the front, the back wall from the left). */
  function wallSection(sec: SectionModel, wall: Wall, start: number, len: number): Place {
    const temp = sec.temp ?? (sec.dept === 'frozen' ? 'frozen' : sec.dept === 'dairy' ? 'chilled' : undefined);
    const extra = temp ? { temp } : {};
    // Side walls run up the map from the front (bottom).
    const y = sideRun.from + sideRun.len - start - len;
    // Every section is a run of wall shelving, stocked from the store side only.
    const info = sec.dept && deptInfo(sec.dept);
    const label = info ? info.name : temp === 'frozen' ? 'Freezer' : temp === 'chilled' ? 'Refrigerated' : 'Wall shelves';
    const base = {
      kind: 'shelf' as const, id: info ? `g-dept-${sec.dept}` : `g-wall-${sec.key}`, label, length: len,
      categories: info ? [...info.categories] : [...sec.categories], ...extra,
    };
    if (wall === 'back') return { ...base, orientation: 'horizontal', x: backRun.from + start, y: 1, back: -1 };
    return { ...base, orientation: 'vertical', x: wall === 'left' ? 1 : width - 2, y, back: wall === 'left' ? -1 : 1 };
  }

  // Out in the open: tables, cases and stands in a band between the aisles and the checkouts.
  const front = yShelf + L + 3 + band; // below the front cross aisle (and the open band)
  if (model.islands.length) {
    const yIsland = yShelf + L + 3;
    const taken: Rect[] = [];
    const walkX = (label: string) => aisles.find((x) => x.id === `g-aisle-${label}`)?.x;
    for (const isl of model.islands) {
      // Where it goes, then either side of that until there's room.
      let x: number;
      if (isl.aisle && walkX(isl.aisle) !== undefined) x = walkX(isl.aisle)! - 0.5;
      else if (isl.near === 'entrance') x = mirror({ x: 6, y: 0, w: 3, h: 2 }).x;
      else if (isl.near === 'far') x = mirror({ x: width - 9, y: 0, w: 3, h: 2 }).x;
      else x = Math.floor(width / 2) - 1;
      x = Math.round(x);
      let r: Rect = { x, y: yIsland, w: 3, h: 2 };
      for (let k = 1; k < 30 && (taken.some((t) => overlaps(t, r)) || r.x < 1 || r.x + r.w > width - 1); k++) {
        r = { ...r, x: x + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 4 };
      }
      taken.push(r);
      const what = isl.fixture === 'table' ? 'table' : isl.fixture === 'stand' ? 'stand' : isl.fixture === 'case' ? 'case' : undefined;
      const depts = [...new Set(isl.categories.map(guessDept))];
      const dept = depts.length === 1 && depts[0] ? deptInfo(depts[0]).name : undefined;
      const cold = isl.temp === 'frozen' ? 'Freezer' : isl.temp === 'chilled' ? 'Fridge' : undefined;
      const label = [cold ?? dept, what ?? (dept || cold ? undefined : 'Display')].filter(Boolean).join(' ') || 'Display';
      places.push({
        kind: 'area', id: `g-open-${isl.key}`, label: label[0].toUpperCase() + label.slice(1), ...r,
        categories: [...isl.categories], ...(isl.temp && { temp: isl.temp }),
      });
    }
  }
  for (const d of FRONT_CORNER_NEAR) if (corners.includes(d)) places.push(area(d, { x: 1, y: front, w: 4, h: 3 }));
  for (const d of FRONT_CORNER_FAR) if (corners.includes(d)) places.push(area(d, { x: width - 5, y: front, w: 4, h: 3 }));
  if (model.checkout) {
    places.push({ kind: 'area', id: 'g-checkout', label: 'Checkout', x: Math.floor(width / 2) - 4, y: front, w: 8, h: 2, categories: [] });
  }
  const entrancePoint = mirror({ x: 2, y: height - 1, w: 1, h: 1 });
  return {
    width, height, places, aisles,
    entrance: { x: entrancePoint.x, y: entrancePoint.y },
    checkout: { x: Math.floor(width / 2), y: height - 2 },
  };
}

/**
 * The store's map regenerated from the model, keeping what the shopper made
 * or changed: their own places, and generated parts listed in `gen.locked`
 * (as they are now, or gone if deleted). Generated parts that would overlap
 * the shopper's own places are left out.
 */
export function regenerate(layout: StoreLayout, model: StoreModel): StoreLayout {
  const gen: GeneratedMap = layout.gen ?? { enabled: true, entrance: 'left', locked: [] };
  const locked = new Set(gen.locked);
  const isGenerated = (id: string) => id.startsWith('g-');
  const kept = layout.places.filter((p) => !isGenerated(p.id) || locked.has(p.id));
  const keptAisles = (layout.aisles ?? []).filter((a) => !isGenerated(a.id) || locked.has(a.id));
  // Aisles the shopper has given a number to elsewhere (e.g. the front half of a cut aisle) aren't generated again.
  const elsewhere = (label: string) => keptAisles.some((k) => k.id !== `g-aisle-${label}` && findAisle({ ...layout, aisles: [k] }, label));
  const parts = generateParts({ ...model, aisles: model.aisles.filter((a) => !elsewhere(a.label)) }, gen.entrance, gen);
  const taken = kept.map(footprint);
  const places = [
    ...kept,
    ...parts.places.filter((p) => !locked.has(p.id) && !taken.some((t) => overlaps(t, footprint(p)))),
  ];
  const aisles = [...keptAisles, ...parts.aisles.filter((a) => !locked.has(a.id) && !keptAisles.some((k) => overlaps(k, a)))];
  // Big enough for everything kept, too.
  const width = Math.max(parts.width, ...kept.map((p) => { const f = footprint(p); return f.x + f.w + 1; }));
  const height = Math.max(parts.height, ...kept.map((p) => { const f = footprint(p); return f.y + f.h + 1; }));
  return {
    ...layout,
    width,
    height,
    places,
    aisles,
    entrance: locked.has('g-entrance') ? layout.entrance : parts.entrance,
    checkout: locked.has('g-checkout-point') ? layout.checkout : parts.checkout,
    gen: { ...gen, key: modelKey(model, gen) },
  };
}

/**
 * Generated parts the shopper has changed or deleted between two versions
 * of a store (so they're kept as they are from now on). The entrance and
 * checkout count as "g-entrance" and "g-checkout-point".
 */
export function newlyEdited(before: StoreLayout, after: StoreLayout): string[] {
  if (!before.gen?.enabled) return [];
  // The whole store moving together (it grew left or up) isn't an edit.
  const b0 = before.places[0];
  const a0 = b0 && after.places.find((p) => p.id === b0.id);
  if (b0 && a0 && (a0.x !== b0.x || a0.y !== b0.y)) {
    const dx = a0.x - b0.x;
    const dy = a0.y - b0.y;
    const shifted = before.places.every((p) => {
      const q = after.places.find((x) => x.id === p.id);
      return q && q.x - p.x === dx && q.y - p.y === dy;
    });
    if (shifted && after.places.length === before.places.length) return [];
  }
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const afterPlaces = new Map(after.places.map((p) => [p.id, p]));
  for (const p of before.places) {
    if (!p.id.startsWith('g-')) continue;
    const now = afterPlaces.get(p.id);
    if (!now || !same(p, now)) out.push(p.id);
  }
  const afterAisles = new Map((after.aisles ?? []).map((a) => [a.id, a]));
  for (const a of before.aisles ?? []) {
    if (!a.id.startsWith('g-')) continue;
    const now = afterAisles.get(a.id);
    if (!now || !same(a, now)) out.push(a.id);
  }
  if (!same(before.entrance, after.entrance)) out.push('g-entrance');
  if (!same(before.checkout, after.checkout)) out.push('g-checkout-point');
  return out.filter((id) => !before.gen!.locked.includes(id));
}
