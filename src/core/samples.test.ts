import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { defaultCategories } from './categories';
import { Floor } from './floor';
import { buildModel, regenerate } from './generate';
import { locateProduct } from './locate';
import { pendingPlacements } from './placement';
import { planGroupedRoute } from './route';
import type { Clue, GeneratedMap, Point, Product, StoreLayout } from './types';

/**
 * Scoring the map on the four sample store layouts (the shopper's drawings).
 *
 * Each sample is a store the shopper visits for the first time. Some items get
 * an answer on that trip ("Aisle 3", "Produce", "a table near the door"); others
 * are held back: they're on the list later, with no answer, and the map has to
 * work out where they are. Each item also has its true place, and the store's
 * true map is built from complete answers (and the same Store settings). The
 * scores:
 *
 * - held back: right / wrong / unplaced (wrong is worse than unplaced: it sends
 *   you to the wrong place);
 * - side claims: an answer gave no aisle side, but the map puts its kind of thing
 *   on one side only;
 * - merged areas: two different tables said alike, drawn as one;
 * - extra walking: the trip in the order the first-trip map gives, walked on the
 *   true map, against the best order there;
 * - cards: placement questions the first-trip map asks.
 *
 * Assumptions the drawings don't settle: the door is in the middle of the front,
 * the checkouts beside it; aisles are numbered from the right; the green areas
 * are tables or stands you walk round (not through).
 */

type Where = string; // "aisle:3", "dept:produce", "section:B", "wall:front-right", "open:t1", "checkout"
interface Item { name: string; cat?: string; first?: Clue; truth: Clue; where: Where }

const aisle = (n: string, side?: 'L' | 'R'): Clue => ({ kind: 'aisle', aisle: n, ...(side && { side }) });
const dept = (d: string): Clue => ({ kind: 'dept', dept: d as never });
const wall = (w: 'left' | 'right' | 'back' | 'front', part?: string): Clue => ({ kind: 'wall', wall: w, ...(part && { part: part as never }) });
const code = (c: string): Clue => ({ kind: 'shelf', code: c, section: c[0], shelf: Number(c.slice(1)) });
const open = (near: 'entrance' | 'middle' | 'far' | 'back', fixture: 'table' | 'stand' | 'case', n?: number): Clue => ({ kind: 'open', near, fixture, ...(n && n > 1 && { n }) } as Clue);
const across = (from: string, to: string): Clue => ({ kind: 'open', fixture: 'stand', across: { from, to, part: 'middle' } });
const checkout: Clue = { kind: 'checkout' };

/** An item answered on the first trip. */
const ans = (name: string, cat: string | undefined, clue: Clue, where: Where): Item => ({ name, cat, first: clue, truth: clue, where });
/** An item held back: no answer on the first trip; its true place. */
const later = (name: string, cat: string, truth: Clue, where: Where): Item => ({ name, cat, truth, where });

interface Sample { name: string; items: Item[]; gen?: Partial<GeneratedMap>; labels?: StoreLayout['labels'] }

const SAMPLES: Sample[] = [
  {
    name: '1: three aisles, walls all round, front-left run',
    items: [
      ans('Bananas', 'fruit', dept('produce'), 'dept:produce'),
      ans('Bread', 'bakery', wall('right'), 'dept:bakery'),
      ans('Cereal', 'breakfast', aisle('1'), 'aisle:1'),
      ans('Pasta', 'pasta', aisle('2', 'L'), 'aisle:2'),
      ans('Chips', 'snacks', aisle('3'), 'aisle:3'),
      ans('Chicken breasts', 'meat', dept('meat'), 'dept:meat'),
      ans('Milk', 'dairy', dept('dairy'), 'dept:dairy'),
      ans('Frozen pizza', 'frozen', wall('left'), 'dept:frozen'),
      ans('Greeting card', 'floral', wall('front', 'left'), 'dept:floral'),
      ans('Gum', undefined, checkout, 'checkout'),
      later('Lettuce', 'veg', dept('produce'), 'dept:produce'),
      later('Bagels', 'bakery', wall('right'), 'dept:bakery'),
      later('Oatmeal', 'breakfast', aisle('1'), 'aisle:1'),
      later('Rice', 'pasta', aisle('2'), 'aisle:2'),
      later('Pretzels', 'snacks', aisle('3'), 'aisle:3'),
      later('Steak', 'meat', dept('meat'), 'dept:meat'),
      later('Yogurt', 'dairy', dept('dairy'), 'dept:dairy'),
      later('Fish sticks', 'frozen', wall('left'), 'dept:frozen'),
      later('Flowers', 'floral', wall('front', 'left'), 'dept:floral'),
      later('Coffee', 'coffee', aisle('1'), 'aisle:1'), // a kind not seen yet
    ],
  },
  {
    name: '2: displays in the cross aisle, front runs both sides',
    items: [
      ans('Bananas', 'fruit', dept('produce'), 'dept:produce'),
      ans('Bread', 'bakery', wall('right'), 'dept:bakery'),
      ans('Cereal', 'breakfast', aisle('1'), 'aisle:1'),
      ans('Pasta', 'pasta', aisle('2'), 'aisle:2'),
      ans('Chips', 'snacks', aisle('3'), 'aisle:3'),
      ans('Tortilla chips', 'snacks', across('3', '3'), 'open:x3'), // on a promo stand this week
      ans('Pepsi', 'soda', across('2', '2'), 'open:x2'),
      ans('Chicken breasts', 'meat', dept('meat'), 'dept:meat'),
      ans('Milk', 'dairy', dept('dairy'), 'dept:dairy'),
      ans('Greeting card', 'floral', wall('front', 'left'), 'dept:floral'),
      ans('Water', 'water', wall('front', 'right'), 'wall:front-right'),
      ans('Gum', undefined, checkout, 'checkout'),
      later('Lettuce', 'veg', dept('produce'), 'dept:produce'),
      later('Croissants', 'bakery', wall('right'), 'dept:bakery'),
      later('Granola', 'breakfast', aisle('1'), 'aisle:1'),
      later('Spaghetti', 'pasta', aisle('2'), 'aisle:2'),
      later('Popcorn', 'snacks', aisle('3'), 'aisle:3'), // snacks live in aisle 3, not on the stand
      later('Sprite', 'soda', aisle('1'), 'aisle:1'), // soda's real home hasn't been seen
      later('Juice', 'water', wall('front', 'right'), 'wall:front-right'),
      later('Steak', 'meat', dept('meat'), 'dept:meat'),
      later('Yogurt', 'dairy', dept('dairy'), 'dept:dairy'),
    ],
  },
  {
    name: '3: side-to-side block behind, tables and stands',
    gen: {
      aisleGroups: [{ from: '5', to: '7' }],
      directions: { 'aisles:5': 'horizontal' },
      placements: { 'aisles:5': { of: 'aisles:main', side: 'above' } },
    },
    items: [
      ans('Bananas', 'fruit', dept('produce'), 'dept:produce'),
      ans('Cereal', 'breakfast', aisle('1'), 'aisle:1'),
      ans('Pasta', 'pasta', aisle('2'), 'aisle:2'),
      ans('Chips', 'snacks', aisle('3'), 'aisle:3'),
      ans('Soup', 'canned', aisle('4'), 'aisle:4'),
      ans('Paper towels', 'paper', aisle('5'), 'aisle:5'),
      ans('Laundry detergent', 'laundry', aisle('6'), 'aisle:6'),
      ans('Shampoo', 'health', aisle('7'), 'aisle:7'),
      ans('Melon', 'fruit', open('back', 'stand'), 'open:back'),
      ans('Grapes', 'fruit', open('entrance', 'table'), 'open:t1'),
      ans('Pineapple', 'fruit', open('entrance', 'table', 2), 'open:t2'), // "Another table"
      ans('Mangoes', 'fruit', open('entrance', 'table'), 'open:t1'), // the same table as the grapes
      ans('Chicken breasts', 'meat', dept('meat'), 'dept:meat'),
      ans('Milk', 'dairy', dept('dairy'), 'dept:dairy'),
      ans('Frozen pizza', 'frozen', wall('left'), 'dept:frozen'),
      ans('Gum', undefined, checkout, 'checkout'),
      later('Lettuce', 'veg', dept('produce'), 'dept:produce'),
      later('Strawberries', 'fruit', dept('produce'), 'dept:produce'), // fruit's home is Produce, not the tables
      later('Granola', 'breakfast', aisle('1'), 'aisle:1'),
      later('Rice', 'pasta', aisle('2'), 'aisle:2'),
      later('Popcorn', 'snacks', aisle('3'), 'aisle:3'),
      later('Broth', 'canned', aisle('4'), 'aisle:4'),
      later('Napkins', 'paper', aisle('5'), 'aisle:5'),
      later('Dog food', 'laundry', aisle('6'), 'aisle:6'),
      later('Toothpaste', 'health', aisle('7'), 'aisle:7'),
      later('Steak', 'meat', dept('meat'), 'dept:meat'),
      later('Yogurt', 'dairy', dept('dairy'), 'dept:dairy'),
      later('Ice cream', 'icecream', wall('left'), 'dept:frozen'),
    ],
  },
  {
    name: '4: club store, sections of several shapes',
    labels: { example: 'B12', roles: ['section', 'shelf'], pairing: 'backToBack' },
    gen: {
      directions: { 'block:B': 'horizontal', 'block:C': 'horizontal' },
      shapes: { 'block:A': 'short', 'block:D': 'short', 'block:B': 'split' },
      placements: { 'block:C': { of: 'block:A', side: 'below' }, 'block:B': { of: 'block:C', side: 'right' }, 'block:D': { of: 'block:C', side: 'below' } },
    },
    items: [
      ans('Bananas', 'fruit', dept('produce'), 'dept:produce'),
      ans('Paper towels', 'paper', code('A2'), 'section:A'),
      ans('Water', 'water', code('A3'), 'section:A'),
      ans('Cereal', 'breakfast', code('B2'), 'section:B'),
      ans('Coffee', 'coffee', code('B5'), 'section:B'),
      ans('Nuts', 'snacks', code('C3'), 'section:C'),
      ans('Cookies', 'cookies', code('C8'), 'section:C'),
      ans('Shampoo', 'health', code('D2'), 'section:D'),
      ans('Melon', 'fruit', open('back', 'stand'), 'open:back'),
      ans('Milk', 'dairy', dept('dairy'), 'dept:dairy'),
      ans('Frozen pizza', 'frozen', wall('left'), 'dept:frozen'),
      ans('Gum', undefined, checkout, 'checkout'),
      later('Toilet paper', 'paper', code('A2'), 'section:A'),
      later('Juice', 'water', code('A3'), 'section:A'),
      later('Oatmeal', 'breakfast', code('B2'), 'section:B'),
      later('Tea', 'coffee', code('B5'), 'section:B'),
      later('Pretzels', 'snacks', code('C3'), 'section:C'),
      later('Crackers', 'cookies', code('C8'), 'section:C'),
      later('Toothpaste', 'health', code('D2'), 'section:D'),
      later('Lettuce', 'veg', dept('produce'), 'dept:produce'),
      later('Yogurt', 'dairy', dept('dairy'), 'dept:dairy'),
      later('Ice cream', 'icecream', wall('left'), 'dept:frozen'),
    ],
  },
];

/** What a place on the generated map is, in the samples' terms. */
function whereOf(placeId: string): Where {
  const m = (re: RegExp) => re.exec(placeId)?.[1];
  const a = m(/^g-shelf-([^-~]+)-[LR]/);
  if (a) return `aisle:${a}`;
  const d = m(/^g-dept-(\w+)/);
  if (d) return `dept:${d}`;
  const s = m(/^g-sec-([^-]+)-/);
  if (s) return `section:${s}`;
  const w = m(/^g-wall-(front-(?:left|right))/) ?? m(/^g-wall-(.+)/);
  if (w) return `wall:${w}`;
  if (placeId.startsWith('g-open-')) return 'open';
  if (placeId === 'g-checkout') return 'checkout';
  return placeId;
}

const blank = (s: Sample): StoreLayout => ({
  id: 's', name: s.name, width: 30, height: 24, places: [], entrance: { x: 15, y: 23 }, checkout: { x: 15, y: 23 },
  ...(s.labels && { labels: s.labels }),
  gen: { enabled: true, entrance: 'left', locked: [], ...s.gen },
});
const product = (it: Item, clue?: Clue): Product => ({ id: it.name, name: it.name, ...(it.cat && { categoryId: it.cat }), ...(clue && { clues: { s: clue } }) });

export interface Score {
  sample: string;
  right: number; wrong: number; unplaced: number; heldBack: number;
  sideClaims: number;
  merged: number;
  misses: string[];
  extraWalking: number;
  extraPlaced: number;
  cards: number;
}

export function scoreSample(s: Sample): Score {
  const firstProducts = s.items.map((it) => product(it, it.first));
  const trueProducts = s.items.map((it) => product(it, it.truth));
  const first = regenerate(blank(s), buildModel(firstProducts, 's'));
  const truth = regenerate(blank(s), buildModel(trueProducts, 's'));
  const firstCat = new Catalog(firstProducts, defaultCategories);
  const trueCat = new Catalog(trueProducts, defaultCategories);
  const at = (p: Product, l: StoreLayout, c: Catalog) => { const loc = locateProduct(p, l, c); return loc.kind === 'spot' ? loc.spot : undefined; };

  // Held-back items: where does the first-trip map send you?
  let right = 0, wrong = 0, unplaced = 0;
  const misses: string[] = [];
  s.items.forEach((it, i) => {
    if (it.first) return;
    const spot = at(firstProducts[i], first, firstCat);
    if (!spot) { unplaced++; misses.push(`${it.name}: unplaced (is ${it.where})`); }
    else if (whereOf(spot.placeId) === it.where) right++;
    else { wrong++; misses.push(`${it.name}: ${whereOf(spot.placeId)} (is ${it.where})`); }
  });

  // Side claims: answered "Aisle N" with no side, but its kind is on one side of aisle N only.
  let sideClaims = 0;
  for (const it of s.items) {
    const c = it.first;
    if (!c || c.kind !== 'aisle' || c.side || !it.cat) continue;
    const shelves = first.places.filter((p) => new RegExp(`^g-shelf-${c.aisle}-[LR]$`).test(p.id));
    // (An outer aisle with the wall as one side has one shelf of its own: nothing to claim.)
    if (shelves.length === 2 && shelves.filter((p) => p.categories.includes(it.cat!)).length === 1) sideClaims++;
  }

  // Tables and stands: different ones said alike must stay different.
  let merged = 0;
  const opens = s.items.map((it, i) => ({ it, spot: it.where.startsWith('open:') && it.first ? at(firstProducts[i], first, firstCat) : undefined })).filter((x) => x.spot);
  for (let i = 0; i < opens.length; i++) {
    for (let j = i + 1; j < opens.length; j++) {
      if (opens[i].it.where !== opens[j].it.where && opens[i].spot!.placeId === opens[j].spot!.placeId) merged++;
    }
  }

  // Extra walking: the order the first-trip map gives, walked on the true map, against the best order there.
  const floor = new Floor(truth);
  const dist = (a: Point, b: Point) => floor.distance(a, b);
  const truePoint = (i: number) => at(trueProducts[i], truth, trueCat)?.point;
  const stops = s.items.map((_, i) => {
    const spot = at(firstProducts[i], first, firstCat);
    return { i, point: spot?.point, placeId: spot?.placeId ?? '' };
  });
  const placed = stops.filter((x): x is { i: number; point: Point; placeId: string } => !!x.point);
  const order = [
    ...planGroupedRoute(first.entrance, placed, first.checkout, new Floor(first).distance.bind(new Floor(first)), (x) => x.point.y).map((x) => x.i),
    ...stops.filter((x) => !x.point).map((x) => x.i), // unplaced: fetched at the end
  ];
  const walk = (idx: number[]) => {
    let d = 0;
    let here = truth.entrance;
    for (const i of idx) { const p = truePoint(i); if (!p) continue; d += dist(here, p); here = p; }
    return d + dist(here, truth.checkout);
  };
  const trueStops = s.items.map((_, i) => ({ i, point: truePoint(i)!, placeId: at(trueProducts[i], truth, trueCat)?.placeId ?? '' })).filter((x) => x.point);
  const best = walk(planGroupedRoute(truth.entrance, trueStops, truth.checkout, dist, (x) => x.point.y).map((x) => x.i));
  const extraWalking = best ? walk(order) / best - 1 : 0;
  // The same, leaving out what the first-trip map couldn't place (fetched at the end above).
  const known = new Set(placed.map((x) => x.i));
  const bestKnown = walk(planGroupedRoute(truth.entrance, trueStops.filter((x) => known.has(x.i)), truth.checkout, dist, (x) => x.point.y).map((x) => x.i));
  const extraPlaced = bestKnown ? walk(order.filter((i) => known.has(i))) / bestKnown - 1 : 0;

  if (process.env.SAMPLE_DEBUG && s.name.startsWith(process.env.SAMPLE_DEBUG)) {
    const names = (idx: number[]) => idx.filter((i) => known.has(i)).map((i) => s.items[i].name).join(' > ');
    console.log('ORDER', names(order));
    console.log('BEST ', names(planGroupedRoute(truth.entrance, trueStops.filter((x) => known.has(x.i)), truth.checkout, dist, (x) => x.point.y).map((x) => x.i)));
    console.log('first', first.width, first.height, JSON.stringify(first.entrance), JSON.stringify(first.checkout), 'truth', truth.width, truth.height, JSON.stringify(truth.entrance), JSON.stringify(truth.checkout));
  }
  return {
    sample: s.name, right, wrong, unplaced, heldBack: s.items.filter((it) => !it.first).length,
    sideClaims, merged, misses, extraWalking, extraPlaced, cards: pendingPlacements(first, firstProducts).length,
  };
}

describe('the sample store layouts, scored', () => {
  const scores = SAMPLES.map(scoreSample);
  it('prints the scoreboard', () => {
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    console.log(['', 'sample | held back right / wrong / unplaced | side claims | merged areas | extra walking (placed only) | cards',
      ...scores.map((r) => `${r.sample} | ${r.right} / ${r.wrong} / ${r.unplaced} of ${r.heldBack} | ${r.sideClaims} | ${r.merged} | ${pct(r.extraWalking)} (${pct(r.extraPlaced)}) | ${r.cards}`),
      `TOTAL | ${scores.reduce((t, r) => t + r.right, 0)} / ${scores.reduce((t, r) => t + r.wrong, 0)} / ${scores.reduce((t, r) => t + r.unplaced, 0)} of ${scores.reduce((t, r) => t + r.heldBack, 0)} | ${scores.reduce((t, r) => t + r.sideClaims, 0)} | ${scores.reduce((t, r) => t + r.merged, 0)} | ${pct(scores.reduce((t, r) => t + r.extraWalking, 0) / scores.length)} avg | ${scores.reduce((t, r) => t + r.cards, 0)}`,
      ...scores.flatMap((r) => r.misses.map((m) => `  ${r.sample.split(':')[0]}: ${m}`)),
    ].join('\n'));
    expect(scores).toHaveLength(4);
  });

  // Today's scores: a change that makes the map worse at these fails here.
  const total = (k: 'right' | 'wrong' | 'sideClaims' | 'merged') => scores.reduce((t, r) => t + r[k], 0);
  it('sends no held-back item to the wrong place, and places nearly all of them', () => {
    expect(total('wrong')).toBe(0);
    expect(total('right')).toBeGreaterThanOrEqual(39);
  });
  it('claims no aisle side nobody gave, and keeps different tables apart', () => {
    expect(total('sideClaims')).toBe(0);
    expect(total('merged')).toBe(0);
  });
  it('walks little further than the best route, for what it could place', () => {
    for (const r of scores) expect(r.extraPlaced).toBeLessThanOrEqual(0.1);
  });
});
