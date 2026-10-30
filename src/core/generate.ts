import { aisleNumber, DEPTS, findAisle, guessDept, sectionNumber } from './clues';
import { formatLabel, shelfOffsets, type LabelStyle } from './labels';
import { footprint } from './geometry';
import type { AisleLabel, AislePos, Area, Arrangement, Placement, Clue, Dept, Fixture, GeneratedMap, OpenNear, Place, Product, Rect, Shelf, StoreLayout, Temp, Wall, WallPart } from './types';

/**
 * Building a store map from shoppers' "Where was it?" answers.
 *
 * 1. The answers become a model of the store: which aisles exist (all from 1
 *    up to the highest number heard), what's on each side of each aisle,
 *    which departments there are, and what's along each wall.
 * 2. The model becomes a map drawn the same way for every store: the top of
 *    the map is the back of the store and the bottom line is the front, with
 *    the entrance in the middle of it. The numbered aisles run up and down in
 *    front of you, aisle 1 on the right. The outermost shelves are the walls:
 *    the back wall across the top, the left and right walls down the sides.
 *    Whatever is on the right wall (produce, bakery, deli…) sits to the right
 *    of the aisles, which start just left of it.
 *
 * Generated parts have stable ids ("g-…"). Anything the shopper changes or
 * deletes is listed in `gen.locked` and never regenerated; places they add
 * themselves are left alone, and generated parts that would overlap them
 * are skipped.
 */

/** Squares along each aisle. */
export const AISLE_LENGTH = 14;
/** Departments usually along the back wall, left to right. */
export const BACK_WALL: Dept[] = ['dairy', 'seafood', 'meat'];
/** Departments usually up the right wall, front to back (Produce is placed by its own setting). */
const RIGHT_WALL: Dept[] = ['bakery', 'deli'];
/** Departments usually in a front corner. */
const FRONT_RIGHT: Dept[] = ['floral'];
const FRONT_LEFT: Dept[] = ['pharmacy'];

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

/** A section of labelled shelves ("B": shelves B1, B2…), in stores that label shelves, not aisles. */
export interface BlockModel {
  section: string;
  /** Mentioned in an answer (otherwise a guess filling a gap, e.g. B between A and C). */
  seen: boolean;
  /** Highest shelf number heard (shelves 1 to this are drawn). */
  max: number;
  /** Categories on each shelf, by number. */
  shelves: Record<number, string[]>;
  /** Shelf numbers mentioned. */
  seenShelves: number[];
  /** Answers in it. */
  count: number;
  temp?: Temp;
}

export interface StoreModel {
  aisles: AisleModel[];
  /** Sections of labelled shelves. */
  blocks: BlockModel[];
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
  const blocks = new Map<string, BlockModel>();
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
      case 'shelf': {
        const key = c.section.toUpperCase();
        let b = blocks.get(key);
        if (!b) blocks.set(key, (b = { section: key, seen: true, max: 1, shelves: {}, seenShelves: [], count: 0 }));
        b.count++;
        if (c.shelf) {
          b.max = Math.max(b.max, c.shelf);
          if (!b.seenShelves.includes(c.shelf)) b.seenShelves.push(c.shelf);
          if (p.categoryId && !(b.shelves[c.shelf] ?? []).includes(p.categoryId)) b.shelves[c.shelf] = [...(b.shelves[c.shelf] ?? []), p.categoryId];
        }
        if (c.temp) b.temp = c.temp;
        break;
      }
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
  // Sections in order; single letters (or numbers) fill the gaps (A and C heard: B is there too).
  const seenBlocks = [...blocks.values()].sort((a, b) => sectionNumber(a.section) - sectionNumber(b.section) || a.section.localeCompare(b.section));
  const allBlocks: BlockModel[] = [...seenBlocks];
  const simple = seenBlocks.length > 1 && seenBlocks.every((b) => /^([A-Z]|\d+)$/.test(b.section));
  if (simple) {
    const nums = seenBlocks.map((b) => sectionNumber(b.section));
    const letters = /^[A-Z]$/.test(seenBlocks[0].section);
    for (let n = Math.min(...nums); n <= Math.max(...nums); n++) {
      const name = letters ? String.fromCharCode(64 + n) : String(n);
      if (!blocks.has(name)) allBlocks.push({ section: name, seen: false, max: 1, shelves: {}, seenShelves: [], count: 0 });
    }
    allBlocks.sort((a, b) => sectionNumber(a.section) - sectionNumber(b.section));
  }
  return { aisles: all, blocks: allBlocks, depts: [...depts], sections: secs, islands: [...islands.values()].sort((a, b) => a.key.localeCompare(b.key)), checkout };
}

/** What a map is generated with: the entrance corner and the arrangement. */
export type GenSettings = Arrangement & { entrance: GeneratedMap['entrance']; placements?: Record<string, Placement>; labels?: LabelStyle };

/** A short fingerprint of what a map would be generated from. */
export function modelKey(model: StoreModel, settings: GenSettings): string {
  return JSON.stringify({
    v: 2, // the layout rules (back at the top, aisle 1 on the right, entrance in the middle)
    // Only when not the usual, so maps made before these settings existed aren't rebuilt.
    ...(settings.aisleOne === 'far' && { a1: 'far' }),
    ...(settings.produce === 'far' && { p: 'far' }),
    ...(settings.backWall === 'reversed' && { b: 'rev' }),
    ...(settings.placements && Object.keys(settings.placements).length && { pl: settings.placements }),
    a: model.aisles.map((a) => [a.label, a.seen ? 1 : 0, a.freezer ? 1 : a.chilled ? 2 : 0, cats(a, 'L'), cats(a, 'R')]),
    d: [...model.depts].sort(),
    ...(model.blocks.length && { bl: model.blocks.map((b) => [b.section, b.seen ? 1 : 0, b.max, b.shelves, b.temp ?? '']) }),
    ...(settings.labels && { lb: [settings.labels.example, settings.labels.roles, settings.labels.pairing] }),
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
export function generateParts(model: StoreModel, arrangement: Arrangement & { placements?: Record<string, Placement>; labels?: LabelStyle } = {}) {
  const placements = arrangement.placements ?? {};
  const n = model.aisles.length;
  const L = AISLE_LENGTH;
  // Sections of labelled shelves, laid out as blocks (in their own squares, from 0,0).
  const blockRects = layoutBlocks(model.blocks, arrangement.labels?.pairing ?? 'backToBack', placements);
  const bw = blockRects.length ? Math.max(...blockRects.map((b) => b.rect.x + b.rect.w)) : 0;
  const bh = blockRects.length ? Math.max(...blockRects.map((b) => b.rect.y + b.rect.h)) : 0;
  // Across: left wall shelf (x 1), a 2-square walkway, the sections, a walkway, the aisles (4 squares each), a walkway, the right wall shelf.
  const xLeftWall = 1;
  const xBlocks = xLeftWall + 3;
  const x0 = xBlocks + (bw ? bw + 2 : 0); // first aisle shelf
  const width = Math.max((n ? x0 + 4 * n : xBlocks + bw) + 4, 14);
  const xRightWall = width - 2;
  // Down: back wall shelf (y 1), a 3-square cross aisle, the aisles, the front cross aisle, things in the open, checkout.
  const yShelf = 5;
  const H = Math.max(n ? L : 0, bh, L); // how deep the aisles and sections run
  const band = model.islands.length ? 4 : 0;
  const front = yShelf + H + 3 + band;
  const height = front + 4;
  const places: Place[] = [];
  const aisles: AisleLabel[] = [];
  const area = (d: Dept, r: Rect): Area => ({ kind: 'area', id: `g-dept-${d}`, label: deptInfo(d).name, ...r, categories: [...deptInfo(d).categories] });

  // Aisles, aisle 1 on the right (or on the left when the store numbers that way). Slot i (from the left) holds shelves at x0+4i and x0+4i+3.
  model.aisles.forEach((a, k) => {
    const slot = arrangement.aisleOne === 'far' ? k : n - 1 - k;
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

  // The walls: each a chain of shelf sections. Departments go on the wall the answers say, or their
  // usual one: Produce, Bakery and Deli up the right wall (front to back), Frozen down the left (or
  // Produce and Frozen swapped), Dairy, Seafood and Meat along the back. Floral and Pharmacy take
  // the front corners.
  const sideRun = { from: 2, len: yShelf + H - 2 }; // from just under the back wall to the front of the aisles

  // The sections' shelves, shelf 1 of each on its right (like aisle 1).
  for (const { block, rect } of blockRects) {
    const pairing = arrangement.labels?.pairing ?? 'backToBack';
    const offs = shelfOffsets(pairing, block.max);
    for (let k = 1; k <= block.max; k++) {
      const row = pairing === 'row';
      places.push({
        kind: 'shelf', id: `g-sec-${block.section}-${k}`, label: formatLabel(arrangement.labels, block.section, k),
        orientation: 'vertical',
        x: xBlocks + rect.x + (row ? 0 : rect.w - 1 - offs[k - 1]),
        y: yShelf + rect.y + (row ? (block.max - k) * ROW_BAY : 0),
        length: row ? ROW_BAY : SECTION_SHELF,
        categories: block.shelves[k] ?? [],
        ...(!block.seen || !block.seenShelves.includes(k) ? { guess: true } : {}),
        ...(block.temp && { temp: block.temp }),
      });
    }
  }
  const backRun = { from: xLeftWall, len: xRightWall - xLeftWall + 1 };
  const produceFar = arrangement.produce === 'far';
  const back = BACK_WALL.filter((d) => model.depts.includes(d));
  if (arrangement.backWall === 'reversed') back.reverse();
  const right = RIGHT_WALL.filter((d) => model.depts.includes(d));
  const placed: { sec: SectionModel; wall: Wall; along: number }[] = [];
  const corners: Dept[] = [];
  for (const sec of model.sections) {
    let wall = sec.wall;
    let along = sec.along;
    if (!wall) {
      const d = sec.dept;
      if (d === 'produce') { wall = produceFar ? 'left' : 'right'; along ??= 0.15; }
      else if (d === 'frozen') wall = produceFar ? 'right' : 'left';
      else if (d && right.includes(d)) { wall = 'right'; along ??= 0.45 + (0.5 * (right.indexOf(d) + 0.5)) / right.length; }
      else if (d && back.includes(d)) { wall = 'back'; along ??= (back.indexOf(d) + 0.5) / back.length; }
      else if (d && (FRONT_RIGHT.includes(d) || FRONT_LEFT.includes(d)) && !placements[`sec:${sec.key}`]) { corners.push(d); continue; }
      else wall = 'back';
    }
    placed.push({ sec, wall, along: along ?? 0.5 });
  }
  // Where the shopper placed sections: next to another one (just before or after it), or on a wall.
  // Placements can refer to each other, so settle them a few times over.
  for (let pass = 0; pass < 4; pass++) {
    for (const p of placed) {
      const pl = placements[`sec:${p.sec.key}`];
      if (!pl) continue;
      if (pl.of.startsWith('wall:')) {
        const w = pl.of.slice(5) as Wall;
        if (p.wall !== w) { p.wall = w; p.along = pl.side === 'before' ? 0 : pl.side === 'after' ? 1 : 0.5; }
        continue;
      }
      const target = placed.find((t) => `sec:${t.sec.key}` === pl.of && t !== p);
      if (!target) continue;
      p.wall = target.wall;
      p.along = target.along + (pl.side === 'before' ? -0.001 : 0.001);
    }
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
      places.push(wallSection(sec, wall, start, Math.max(1, end - start)));
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
    return { ...base, orientation: 'vertical', x: wall === 'left' ? xLeftWall : xRightWall, y, back: wall === 'left' ? -1 : 1 };
  }

  // Out in the open: tables, cases and stands in a band between the aisles and the checkouts.
  const mid = Math.floor(width / 2);
  if (model.islands.length) {
    const yIsland = yShelf + H + 3;
    const taken: Rect[] = [];
    const walkX = (label: string) => aisles.find((x) => x.id === `g-aisle-${label}`)?.x;
    for (const isl of model.islands) {
      // Where it goes (the door is in the middle of the front), then either side of that until there's room.
      let x: number;
      const pl = placements[`isl:${isl.key}`];
      const byAisle = pl?.of.startsWith('aisle:') ? pl.of.slice(6) : isl.aisle;
      if (pl?.of === 'wall:left') x = 2;
      else if (pl?.of === 'wall:right') x = width - 5;
      else if (byAisle && walkX(byAisle) !== undefined) x = walkX(byAisle)! - 0.5;
      else if (isl.near === 'entrance') x = mid - 1;
      else if (isl.near === 'far') x = 2;
      else x = mid - 1;
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
  // Front corners, and the checkouts to the left of the door.
  for (const d of FRONT_RIGHT) if (corners.includes(d)) places.push(area(d, { x: width - 6, y: front, w: 4, h: 3 }));
  for (const d of FRONT_LEFT) if (corners.includes(d)) places.push(area(d, { x: 2, y: front, w: 4, h: 3 }));
  const checkoutX = Math.max(corners.some((d) => FRONT_LEFT.includes(d)) ? 7 : 2, mid - 10);
  if (model.checkout) {
    places.push({ kind: 'area', id: 'g-checkout', label: 'Checkout', x: checkoutX, y: front, w: Math.min(8, mid - 1 - checkoutX), h: 2, categories: [] });
  }
  return {
    width, height, places, aisles,
    entrance: { x: mid, y: height - 1 },
    checkout: { x: checkoutX + 3, y: height - 2 },
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
  const parts = generateParts({ ...model, aisles: model.aisles.filter((a) => !elsewhere(a.label)) }, { ...gen, labels: layout.labels });
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
    gen: { ...gen, key: modelKey(model, { ...gen, labels: layout.labels }) },
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

/**
 * What a rebuild changed on the map, for highlighting: ids of places and
 * aisle labels that are new, or have moved, changed size or direction, or
 * stock something new. Parts that only lost their "guess" dashes count too.
 */
export function changedParts(before: StoreLayout, after: StoreLayout): string[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const old = new Map<string, unknown>([...before.places, ...(before.aisles ?? [])].map((p) => [p.id, p]));
  return [...after.places, ...(after.aisles ?? [])].filter((p) => !same(old.get(p.id), p)).map((p) => p.id);
}

/** Squares along a section's shelf (stood up and down), and along one bay of a section in a row. */
export const SECTION_SHELF = 10;
export const ROW_BAY = 4;

/** A section's size in squares: across (its shelves side by side) and deep. */
function blockSize(b: BlockModel, pairing: LabelStyle['pairing']) {
  if (pairing === 'row') return { w: 1, h: b.max * ROW_BAY };
  const offs = shelfOffsets(pairing, b.max);
  return { w: Math.max(...offs) + 1, h: SECTION_SHELF };
}

/**
 * Where each section goes, in squares from the top-left of the sections'
 * area: each next to the one before it (to its left), unless the shopper
 * placed it next to another ("block:C" below "block:A"). Walkways between
 * sections are 2 squares; nothing overlaps.
 */
export function layoutBlocks(blocks: BlockModel[], pairing: LabelStyle['pairing'], placements: Record<string, Placement>) {
  const out: { block: BlockModel; rect: Rect }[] = [];
  const gap = 2;
  const clash = (r: Rect, self: BlockModel) => out.some((o) => o.block !== self && r.x < o.rect.x + o.rect.w + gap && o.rect.x < r.x + r.w + gap && r.y < o.rect.y + o.rect.h + gap && o.rect.y < r.y + r.h + gap);
  // Sections placed next to another go after it (so it's there to be next to); the rest in order.
  const order: BlockModel[] = [];
  const left = [...blocks];
  while (left.length) {
    const i = left.findIndex((b) => {
      const pl = placements[`block:${b.section}`];
      return !pl || order.some((o) => `block:${o.section}` === pl.of) || !left.some((o) => `block:${o.section}` === pl.of);
    });
    order.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  for (const b of order) {
    const { w, h } = blockSize(b, pairing);
    const pl = placements[`block:${b.section}`];
    const target = pl && out.find((o) => `block:${o.block.section}` === pl.of);
    const prev = out[out.length - 1];
    let r: Rect;
    let step = { x: -1, y: 0 };
    if (target) {
      const t = target.rect;
      switch (pl!.side) {
        case 'right': r = { x: t.x + t.w + gap, y: t.y, w, h }; step = { x: 1, y: 0 }; break;
        case 'above': r = { x: t.x, y: t.y - gap - h, w, h }; step = { x: 0, y: -1 }; break;
        case 'below': r = { x: t.x, y: t.y + t.h + gap, w, h }; step = { x: 0, y: 1 }; break;
        default: r = { x: t.x - gap - w, y: t.y, w, h };
      }
    } else if (prev) r = { x: prev.rect.x - gap - w, y: prev.rect.y, w, h };
    else r = { x: 0, y: 0, w, h };
    for (let k = 0; k < 200 && clash(r, b); k++) r = { ...r, x: r.x + step.x, y: r.y + step.y };
    out.push({ block: b, rect: r });
  }
  // Start the area at 0,0.
  const minX = Math.min(0, ...out.map((o) => o.rect.x));
  const minY = Math.min(0, ...out.map((o) => o.rect.y));
  return out.map((o) => ({ ...o, rect: { ...o.rect, x: o.rect.x - minX, y: o.rect.y - minY } }));
}
