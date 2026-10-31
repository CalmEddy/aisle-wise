import { acrossRect, aisleNumber, DEPTS, findAisle, guessDept, islandKey, sectionNumber } from './clues';
import { formatLabel, shelfOffsets, type LabelStyle } from './labels';
import { footprint } from './geometry';
import type { Across, AisleLabel, AislePos, Area, Arrangement, Orientation, Placement, Clue, Dept, Fixture, GeneratedMap, OpenNear, MainWall, Place, Product, Rect, SectionShape, Shelf, StoreLayout, Temp, Wall, WallPart } from './types';

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
  /** In the middle of a block, across these aisles or sections: the shelves there make way. */
  across?: Across;
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
        // The front wall is two runs, either side of the door.
        const wallKey = c.wall === 'front' ? `front-${c.part === 'left' ? 'left' : 'right'}` : c.wall;
        const sec = section(dept ?? `${wallKey}-${c.temp ?? 'shelf'}`, dept);
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
        const across = c.across && { from: c.across.from.trim().toUpperCase(), to: c.across.to.trim().toUpperCase(), ...(c.across.part && { part: c.across.part }) };
        const key = islandKey(c);
        let isl = islands.get(key);
        if (!isl) islands.set(key, (isl = { key, near, ...(c.aisle && { aisle: c.aisle.trim().toUpperCase() }), ...(across && { across }), ...(c.fixture && { fixture: c.fixture }), ...(c.temp && { temp: c.temp }), categories: [] }));
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
export type GenSettings = Arrangement & Pick<GeneratedMap, 'entrance' | 'placements' | 'aisleGroups' | 'directions' | 'shapes' | 'door' | 'wallOrder'> & { labels?: LabelStyle };

/** A short fingerprint of what a map would be generated from. */
export function modelKey(model: StoreModel, settings: GenSettings): string {
  return JSON.stringify({
    v: 2, // the layout rules (back at the top, aisle 1 on the right, entrance in the middle)
    // Only when not the usual, so maps made before these settings existed aren't rebuilt.
    ...(settings.aisleOne === 'far' && { a1: 'far' }),
    ...(settings.produce === 'far' && { p: 'far' }),
    ...(settings.backWall === 'reversed' && { b: 'rev' }),
    ...(settings.placements && Object.keys(settings.placements).length && { pl: settings.placements }),
    ...(settings.aisleGroups?.length && { ag: settings.aisleGroups }),
    ...(settings.door !== undefined && { door: settings.door }),
    ...(settings.wallOrder && { wo: settings.wallOrder }),
    ...(settings.directions && Object.keys(settings.directions).length && { dr: settings.directions }),
    ...(settings.shapes && Object.keys(settings.shapes).length && { sh: settings.shapes }),
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
export function generateParts(model: StoreModel, arrangement: Arrangement & { placements?: Record<string, Placement>; labels?: LabelStyle; aisleGroups?: { from: string; to: string }[]; directions?: Record<string, Orientation>; shapes?: Record<string, SectionShape>; door?: number; wallOrder?: Record<MainWall, string[]> } = {}) {
  const placements = arrangement.placements ?? {};
  const L = AISLE_LENGTH;
  // Blocks of shelving: the numbered aisles, runs of aisles the shopper made into their own block,
  // and sections of labelled shelves. Each has a direction and a place next to the others.
  const pairing = arrangement.labels?.pairing ?? 'backToBack';
  const dirs = arrangement.directions ?? {};
  const inGroup = (label: string) => (arrangement.aisleGroups ?? []).find((g) => {
    const n = aisleNumber(label);
    return n >= aisleNumber(g.from) && n <= aisleNumber(g.to);
  });
  const mainAisles = model.aisles.filter((a) => !inGroup(a.label));
  const items: BlockItem[] = [];
  if (mainAisles.length) items.push({ ref: 'aisles:main', ...aisleBlockSize(mainAisles.length, 'vertical', L) });
  for (const g of arrangement.aisleGroups ?? []) {
    const members = model.aisles.filter((a) => inGroup(a.label) === g);
    if (!members.length) continue;
    const ref = `aisles:${g.from}`;
    items.push({ ref, ...aisleBlockSize(members.length, dirs[ref] ?? 'horizontal', L), default: items.length ? { of: 'aisles:main', side: 'below' } : undefined });
  }
  let prevSection: string | undefined = mainAisles.length ? 'aisles:main' : undefined;
  for (const b of model.blocks) {
    const ref = `block:${b.section}`;
    items.push({ ref, ...sectionSize(b, pairing, dirs[ref] ?? 'vertical', arrangement.shapes?.[ref]), default: prevSection ? { of: prevSection, side: 'left' } : undefined });
    prevSection = ref;
  }
  const arranged = arrangeBlocks(items, placements);
  const at = new Map(arranged.map((a) => [a.ref, a.rect]));
  const bw = arranged.length ? Math.max(...arranged.map((a) => a.rect.x + a.rect.w)) : 0;
  const bh = arranged.length ? Math.max(...arranged.map((a) => a.rect.y + a.rect.h)) : 0;
  // Across: left wall shelf (x 1), a 2-square walkway, the blocks, a walkway, the right wall shelf.
  let xLeftWall = 1;
  const xBlocks = xLeftWall + 3;
  let width = Math.max(xBlocks + bw + 4, 14);
  let xRightWall = width - 2;
  // Down: back wall shelf (y 1), a 3-square cross aisle, the aisles, the front cross aisle, things in the open, checkout.
  // Tables, cases and stands by the back wall get a strip of their own, between the back cross aisle and the shelves.
  const atBack = (isl: IslandModel) => {
    const pl = placements[`isl:${isl.key}`];
    return !isl.across && (pl ? pl.of.startsWith('back:') : isl.near === 'back' && !isl.aisle);
  };
  const backBand = model.islands.some(atBack) ? 3 : 0;
  const yShelf = 5 + backBand;
  const H = Math.max(bh, L); // how deep the aisles and sections run
  const band = model.islands.some((i) => !i.across && !atBack(i)) ? 4 : 0;
  const front = yShelf + H + 3 + band;
  // The bottom row is the front of the store: the door, and any front wall shelving either side of it.
  const height = front + 3;
  const places: Place[] = [];
  const aisles: AisleLabel[] = [];
  const area = (d: Dept, r: Rect): Area => ({ kind: 'area', id: `g-dept-${d}`, label: deptInfo(d).name, ...r, categories: [...deptInfo(d).categories] });

  // Aisles, aisle 1 on the right (or on the left when the store numbers that way). In an up-and-down
  // block, slot i (from the left) holds shelves at 4i and 4i+3; in a side-to-side block, slot i (from the
  // front, i.e. the bottom) holds shelves at those distances up from its bottom.
  const drawAisles = (list: AisleModel[], rect: Rect, dir: Orientation) => {
    const m = list.length;
    list.forEach((a, k) => {
      const freezer = a.freezer ? { temp: 'frozen' as const } : a.chilled ? { temp: 'chilled' as const } : {};
      const guess = a.seen ? {} : { guess: true };
      if (dir === 'vertical') {
        const fromRight = arrangement.aisleOne === 'far' ? k : m - 1 - k;
        const walk: Rect = { x: xBlocks + rect.x + 1 + 4 * fromRight, y: yShelf + rect.y, w: 2, h: L };
        aisles.push({ id: `g-aisle-${a.label}`, label: `Aisle ${a.label}`, ...walk, ...guess });
        for (const side of ['L', 'R'] as const) {
          // Walking up the aisle from the front, left is the smaller x.
          places.push({
            kind: 'shelf', id: `g-shelf-${a.label}-${side}`, label: `${a.label}${side}`, orientation: 'vertical',
            x: side === 'L' ? walk.x - 1 : walk.x + 2, y: walk.y, length: L, categories: cats(a, side), ...guess, ...freezer,
          });
        }
      } else {
        // Side to side: aisle 1 nearest the front (bottom); walking along it from the right, left is the smaller y.
        const fromBottom = arrangement.aisleOne === 'far' ? m - 1 - k : k;
        const walk: Rect = { x: xBlocks + rect.x, y: yShelf + rect.y + rect.h - 3 - 4 * fromBottom, w: L, h: 2 };
        aisles.push({ id: `g-aisle-${a.label}`, label: `Aisle ${a.label}`, ...walk, ...guess });
        for (const side of ['L', 'R'] as const) {
          places.push({
            kind: 'shelf', id: `g-shelf-${a.label}-${side}`, label: `${a.label}${side}`, orientation: 'horizontal',
            x: walk.x, y: side === 'L' ? walk.y - 1 : walk.y + 2, length: L, categories: cats(a, side), ...guess, ...freezer,
          });
        }
      }
    });
  };
  if (mainAisles.length) drawAisles(mainAisles, at.get('aisles:main')!, 'vertical');
  for (const g of arrangement.aisleGroups ?? []) {
    const ref = `aisles:${g.from}`;
    const rect = at.get(ref);
    if (rect) drawAisles(model.aisles.filter((a) => inGroup(a.label) === g), rect, dirs[ref] ?? 'horizontal');
  }

  // The walls: each a chain of shelf sections. Departments go on the wall the answers say, or their
  // usual one: Produce, Bakery and Deli up the right wall (front to back), Frozen down the left (or
  // Produce and Frozen swapped), Dairy, Seafood and Meat along the back. Floral and Pharmacy take
  // the front corners.
  const sideRun = { from: 2, len: yShelf + H - 2 }; // from just under the back wall to the front of the aisles

  // The sections' shelves, shelf 1 of each on its right (like aisle 1), or at the front when it runs side to side.
  for (const block of model.blocks) {
    const ref = `block:${block.section}`;
    const rect = at.get(ref);
    if (!rect) continue;
    const across = dirs[ref] === 'horizontal';
    const offs = shelfOffsets(pairing, block.max);
    const row = pairing === 'row';
    const shape = row ? 'long' : arrangement.shapes?.[ref] ?? 'long';
    for (let k = 1; k <= block.max; k++) {
      const len = row ? ROW_BAY : shape === 'short' ? SHORT_SHELF : SECTION_SHELF;
      const step = row ? (block.max - k) * ROW_BAY : 0; // along a row
      const off = row ? 0 : (across ? rect.h : rect.w) - 1 - offs[k - 1]; // across the section
      const shelf: Shelf = {
        kind: 'shelf', id: `g-sec-${block.section}-${k}`, label: formatLabel(arrangement.labels, block.section, k),
        orientation: across ? 'horizontal' : 'vertical',
        x: xBlocks + rect.x + (across ? (row ? rect.w - len - step : 0) : off),
        y: yShelf + rect.y + (across ? off : step),
        length: len,
        categories: block.shelves[k] ?? [],
        ...(!block.seen || !block.seenShelves.includes(k) ? { guess: true } : {}),
        ...(block.temp && { temp: block.temp }),
      };
      if (shape !== 'split') { places.push(shelf); continue; }
      // Split by a walkway across the middle: two short runs, both with the shelf's label.
      const piece = Math.floor((len - SPLIT_GAP) / 2);
      const far = piece + SPLIT_GAP;
      places.push({ ...shelf, length: piece });
      places.push({ ...shelf, id: `${shelf.id}~2`, length: len - far, categories: [], ...(across ? { x: shelf.x + far } : { y: shelf.y + far }) });
    }
  }
  // Things out in the middle of a block (across aisles 3–5, front): the shelves there make way.
  for (const isl of model.islands.filter((i) => i.across)) {
    const r = acrossRect({ places } as StoreLayout, isl.across!);
    if (!r) continue;
    for (let i = places.length - 1; i >= 0; i--) {
      const sh = places[i];
      if (sh.kind !== 'shelf' || !overlaps(footprint(sh), r)) continue;
      const v = sh.orientation === 'vertical';
      const start = v ? sh.y : sh.x;
      const end = start + sh.length;
      const cut0 = v ? r.y : r.x;
      const cut1 = cut0 + (v ? r.h : r.w);
      const pieces = [{ from: start, to: Math.min(end, cut0) }, { from: Math.max(start, cut1), to: end }].filter((q) => q.to > q.from);
      places.splice(i, 1, ...pieces.map((q, k) => ({
        ...sh, id: k === 0 ? sh.id : `${sh.id}~2`, length: q.to - q.from, ...(v ? { y: q.from } : { x: q.from }),
      })));
    }
    places.push({ kind: 'area', id: `g-open-${isl.key}`, label: islandLabel(isl), ...r, categories: islandStock(isl), ...(isl.temp && { temp: isl.temp }) });
  }
  const produceFar = arrangement.produce === 'far';
  const back = BACK_WALL.filter((d) => model.depts.includes(d));
  if (arrangement.backWall === 'reversed') back.reverse();
  const right = RIGHT_WALL.filter((d) => model.depts.includes(d));
  const placed: { sec: SectionModel; wall: Wall; along: number }[] = [];
  const onAWall = (key: string) => (['left', 'back', 'right'] as MainWall[]).some((w) => arrangement.wallOrder?.[w]?.includes(key));
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
      else if (d && (FRONT_RIGHT.includes(d) || FRONT_LEFT.includes(d)) && !placements[`sec:${sec.key}`] && !onAWall(sec.key)) { corners.push(d); continue; }
      else wall = 'back';
    }
    placed.push({ sec, wall, along: along ?? 0.5 });
  }
  // The walls as the shopper arranged them (the departments screen): their order wins.
  for (const wall of ['left', 'back', 'right'] as MainWall[]) {
    const keys = (arrangement.wallOrder?.[wall] ?? []).filter((k) => placed.some((p) => p.sec.key === k));
    keys.forEach((k, i) => {
      const p = placed.find((x) => x.sec.key === k)!;
      p.wall = wall;
      p.along = (i + 0.5) / keys.length;
    });
  }
  // Where the shopper placed sections: next to another one (just before or after it), or on a wall.
  // Placements can refer to each other, so settle them a few times over.
  for (let pass = 0; pass < 4; pass++) {
    for (const p of placed) {
      const pl = placements[`sec:${p.sec.key}`];
      if (!pl || onAWall(p.sec.key)) continue;
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
  // The outermost aisle's far side is the wall itself when that wall has shelving: the end shelf there
  // gives way and the wall stands in its place (no walkway between an end shelf and the wall).
  const gaveWay: { wall: Wall; shelf: Shelf }[] = [];
  const blockShelf = (p: Place): p is Shelf => p.kind === 'shelf' && /^g-(shelf|sec)-/.test(p.id);
  const wallEdge = (wall: 'left' | 'right'): number | undefined => {
    if (!placed.some((p) => p.wall === wall)) return undefined;
    const shelves = places.filter(blockShelf);
    if (!shelves.length) return undefined;
    const right = (sh: Shelf) => { const f = footprint(sh); return f.x + f.w - 1; };
    const edge = wall === 'left' ? Math.min(...shelves.map((sh) => sh.x)) : Math.max(...shelves.map(right));
    const atEdge = shelves.filter((sh) => (wall === 'left' ? sh.x === edge : right(sh) === edge));
    // Only up-and-down shelves with a walkway (not a back-to-back partner) on their inner side.
    const inner = wall === 'left' ? edge + 1 : edge - 1;
    const single = (sh: Shelf) => sh.orientation === 'vertical'
      && !shelves.some((o) => o !== sh && o.orientation === 'vertical' && o.x === inner && o.y < sh.y + sh.length && sh.y < o.y + o.length);
    if (!atEdge.every(single)) return undefined;
    for (const sh of atEdge) { places.splice(places.indexOf(sh), 1); gaveWay.push({ wall, shelf: sh }); }
    return edge;
  };
  const leftMerge = wallEdge('left');
  const rightMerge = wallEdge('right');
  if (leftMerge !== undefined) xLeftWall = leftMerge;
  if (rightMerge !== undefined) { xRightWall = rightMerge; width = rightMerge + 2; }
  // A side with nothing along its wall: the outermost shelf there is the edge of the store, and the back wall
  // stops at it (no strip of empty floor beyond).
  const blockShelves = places.filter(blockShelf);
  if (blockShelves.length) {
    if (!placed.some((p) => p.wall === 'left')) xLeftWall = Math.min(...blockShelves.map((sh) => sh.x));
    if (!placed.some((p) => p.wall === 'right')) {
      xRightWall = Math.max(...blockShelves.map((sh) => { const f = footprint(sh); return f.x + f.w - 1; }));
      width = xRightWall + 2;
    }
  }
  const backRun = { from: xLeftWall, len: xRightWall - xLeftWall + 1 };
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
  // What the end shelves stocked is on the wall now.
  for (const { wall, shelf } of gaveWay) {
    for (const w of places) {
      if (w.kind !== 'shelf' || !/^g-(dept|wall)-/.test(w.id) || w.orientation !== 'vertical' || w.x !== (wall === 'left' ? xLeftWall : xRightWall)) continue;
      if (w.y < shelf.y + shelf.length && shelf.y < w.y + w.length) w.categories = [...new Set([...w.categories, ...shelf.categories])];
    }
  }
  // The left wall moved in: everything shifts left to the edge of the store.
  if (xLeftWall > 1) {
    const dx = xLeftWall - 1;
    for (const p of places) p.x -= dx;
    for (const a of aisles) a.x -= dx;
    xRightWall -= dx;
    width -= dx;
    xLeftWall = 1;
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
  if (model.islands.some((i) => !i.across)) {
    const yFront = yShelf + H + 3;
    const taken: Rect[] = [];
    const walkX = (label: string) => aisles.find((x) => x.id === `g-aisle-${label}`)?.x;
    for (const isl of model.islands.filter((i) => !i.across)) {
      // Where it goes (the door is in the middle of the front), then either side of that until there's room.
      let x: number;
      const pl = placements[`isl:${isl.key}`];
      const byAisle = pl?.of.startsWith('aisle:') ? pl.of.slice(6) : isl.aisle;
      const back = atBack(isl);
      if (pl?.of === 'wall:left' || pl?.of === 'back:left') x = 2;
      else if (pl?.of === 'wall:right' || pl?.of === 'back:right') x = width - 5;
      else if (back) x = mid - 1;
      else if (byAisle && walkX(byAisle) !== undefined) x = walkX(byAisle)! - 0.5;
      else if (isl.near === 'entrance') x = mid - 1;
      else if (isl.near === 'far') x = 2;
      else x = mid - 1;
      x = Math.round(x);
      let r: Rect = { x, y: back ? 5 : yFront, w: 3, h: 2 };
      for (let k = 1; k < 30 && (taken.some((t) => overlaps(t, r)) || r.x < 1 || r.x + r.w > width - 1); k++) {
        r = { ...r, x: x + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 4 };
      }
      taken.push(r);
      places.push({
        kind: 'area', id: `g-open-${isl.key}`, label: islandLabel(isl), ...r,
        categories: islandStock(isl), ...(isl.temp && { temp: isl.temp }),
      });
    }
  }
  // Front corners, and the checkouts beside the door (to its left if there's room, else its right).
  const doorX = Math.max(1, Math.min(width - 2, Math.round((arrangement.door ?? 0.5) * (width - 1))));
  for (const d of FRONT_RIGHT) if (corners.includes(d)) places.push(area(d, { x: width - 6, y: front, w: 4, h: 2 }));
  for (const d of FRONT_LEFT) if (corners.includes(d)) places.push(area(d, { x: 2, y: front, w: 4, h: 2 }));
  // The front wall: runs of shelving along the bottom row, left and right of the door (a gap of 3 for the door).
  const frontRuns = { left: { from: 1, len: doorX - 2 }, right: { from: doorX + 2, len: width - 2 - (doorX + 2) + 1 } };
  for (const side of ['left', 'right'] as const) {
    const here = placed.filter((p) => p.wall === 'front' && (p.along < 0.5) === (side === 'left')).sort((a, b) => a.along - b.along || a.sec.key.localeCompare(b.sec.key));
    const run = frontRuns[side];
    if (!here.length || run.len < 1) continue;
    const total = here.reduce((t, p) => t + weight(p.sec), 0);
    let done = 0;
    here.forEach(({ sec }, i) => {
      const start = Math.round((done / total) * run.len);
      done += weight(sec);
      const end = i === here.length - 1 ? run.len : Math.round((done / total) * run.len);
      const temp = sec.temp ?? (sec.dept === 'frozen' ? 'frozen' : sec.dept === 'dairy' ? 'chilled' : undefined);
      const info = sec.dept && deptInfo(sec.dept);
      places.push({
        kind: 'shelf', id: info ? `g-dept-${sec.dept}` : `g-wall-${sec.key}`,
        label: info ? info.name : temp === 'frozen' ? 'Freezer' : temp === 'chilled' ? 'Refrigerated' : 'Front shelves',
        orientation: 'horizontal', x: run.from + start, y: height - 1, length: Math.max(1, end - start), back: 1,
        categories: info ? [...info.categories] : [...sec.categories], ...(temp && { temp }),
      });
    });
  }
  const leftEdge = corners.some((d) => FRONT_LEFT.includes(d)) ? 7 : 2;
  const rightEdge = width - (corners.some((d) => FRONT_RIGHT.includes(d)) ? 7 : 2);
  // Checkouts beside the door, never across it: up to 8 squares, on the left if they fit, else the roomier side.
  const roomLeft = doorX - 2 - leftEdge;
  const roomRight = rightEdge - (doorX + 3);
  const onLeft = roomLeft >= 8 || roomLeft >= roomRight;
  const coW = Math.max(3, Math.min(8, onLeft ? roomLeft : roomRight));
  const checkoutX = onLeft ? doorX - 2 - coW : doorX + 3;
  if (model.checkout) {
    places.push({ kind: 'area', id: 'g-checkout', label: 'Checkout', x: checkoutX, y: front, w: coW, h: 2, categories: [] });
  }
  return {
    width, height, places, aisles,
    entrance: { x: doorX, y: height - 1 },
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
/** Squares along a short section's shelves (stubs), and a split section's walkway across the middle. */
export const SHORT_SHELF = 4;
const SPLIT_GAP = 2;

/**
 * What a table, case or stand out on the floor stocks, for placing other things of the same kind: a case (a
 * freezer or fridge case) holds its kind of thing; a stand or table is a display of a few things this week, so
 * the rest of its kind stay where they are (only the items said to be there go to it).
 */
function islandStock(isl: IslandModel): string[] {
  return isl.fixture === 'stand' || isl.fixture === 'table' ? [] : [...isl.categories];
}

/** A block to lay out: its size, and where it goes when the shopper hasn't said. */
interface BlockItem { ref: string; w: number; h: number; default?: Placement }

/** A block of m numbered aisles: 4 squares per aisle across, the aisle length along. */
function aisleBlockSize(m: number, dir: Orientation, L: number) {
  return dir === 'vertical' ? { w: 4 * m, h: L } : { w: L, h: 4 * m };
}

/** A section's size in squares, standing up and down or turned side to side. */
function sectionSize(b: BlockModel, pairing: LabelStyle['pairing'], dir: Orientation, shape: SectionShape = 'long') {
  const offs = shelfOffsets(pairing, b.max);
  const across = pairing === 'row' ? 1 : Math.max(...offs) + 1;
  const along = pairing === 'row' ? b.max * ROW_BAY : shape === 'short' ? SHORT_SHELF : SECTION_SHELF;
  return dir === 'vertical' ? { w: across, h: along } : { w: along, h: across };
}

/**
 * Where each block goes, in squares from the top-left of the blocks' area:
 * next to another block (left, right, behind = above, in front = below) as
 * the shopper placed it, or as it usually goes. Walkways between blocks
 * are 2 squares; nothing overlaps.
 */
export function arrangeBlocks(items: BlockItem[], placements: Record<string, Placement>) {
  const out: { ref: string; rect: Rect }[] = [];
  const gap = 2;
  const clash = (r: Rect, self: string) => out.some((o) => o.ref !== self && r.x < o.rect.x + o.rect.w + gap && o.rect.x < r.x + r.w + gap && r.y < o.rect.y + o.rect.h + gap && o.rect.y < r.y + r.h + gap);
  // What each block is placed next to: the shopper's placement, else where it usually goes, unless
  // that would go round in a circle (B left of A by default, A placed right of B): the shopper's wins.
  const explicit = (ref: string) => placements[ref];
  const leadsTo = (from: string | undefined, to: string, seen = new Set<string>()): boolean => {
    if (!from || seen.has(from)) return false;
    if (from === to) return true;
    seen.add(from);
    const it = items.find((x) => x.ref === from);
    const next = explicit(from)?.of ?? it?.default?.of;
    return leadsTo(next, to, seen);
  };
  const rule = (it: BlockItem) => explicit(it.ref) ?? (it.default && !leadsTo(explicit(it.default.of)?.of, it.ref) ? it.default : undefined);
  // A block placed next to another goes after it (so it's there to be next to).
  const order: BlockItem[] = [];
  const left = [...items];
  while (left.length) {
    const i = left.findIndex((it) => {
      const pl = rule(it);
      return !pl || order.some((o) => o.ref === pl.of) || !left.some((o) => o.ref === pl.of);
    });
    order.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  for (const it of order) {
    const { w, h } = it;
    const pl = rule(it);
    const target = pl && out.find((o) => o.ref === pl.of);
    let r: Rect = { x: 0, y: 0, w, h };
    let step = { x: -1, y: 0 };
    if (target) {
      const t = target.rect;
      switch (pl!.side) {
        case 'right': r = { x: t.x + t.w + gap, y: t.y, w, h }; step = { x: 1, y: 0 }; break;
        case 'above': r = { x: t.x + t.w - w, y: t.y - gap - h, w, h }; step = { x: 0, y: -1 }; break;
        case 'below': r = { x: t.x + t.w - w, y: t.y + t.h + gap, w, h }; step = { x: 0, y: 1 }; break;
        default: r = { x: t.x - gap - w, y: t.y, w, h };
      }
    } else if (out.length) {
      const prev = out[out.length - 1].rect;
      r = { x: prev.x - gap - w, y: prev.y, w, h };
    }
    for (let k = 0; k < 400 && clash(r, it.ref); k++) r = { ...r, x: r.x + step.x, y: r.y + step.y };
    out.push({ ref: it.ref, rect: r });
  }
  const minX = Math.min(0, ...out.map((o) => o.rect.x));
  const minY = Math.min(0, ...out.map((o) => o.rect.y));
  return out.map((o) => ({ ...o, rect: { ...o.rect, x: o.rect.x - minX, y: o.rect.y - minY } }));
}

/** What a table, case or stand is called on the map ("Produce table", "Freezer case"). */
function islandLabel(isl: IslandModel): string {
  const what = isl.fixture === 'table' ? 'table' : isl.fixture === 'stand' ? 'stand' : isl.fixture === 'case' ? 'case' : undefined;
  const depts = [...new Set(isl.categories.map(guessDept))];
  const dept = depts.length === 1 && depts[0] ? deptInfo(depts[0]).name : undefined;
  const cold = isl.temp === 'frozen' ? 'Freezer' : isl.temp === 'chilled' ? 'Fridge' : undefined;
  const label = [cold ?? dept, what ?? (dept || cold ? undefined : 'Display')].filter(Boolean).join(' ') || 'Display';
  return label[0].toUpperCase() + label.slice(1);
}
