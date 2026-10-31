import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { resolveClue } from './clues';
import { Floor } from './floor';
import { buildModel, generateParts, newlyEdited, regenerate } from './generate';
import { footprint, parseExactKey } from './geometry';
import { locateProduct } from './locate';
import type { Product, Shelf, StoreLayout } from './types';

const products: Product[] = [
  { id: 'apples', name: 'Apples', categoryId: 'fruit', clues: { s: { kind: 'dept', dept: 'produce' } } },
  { id: 'bread', name: 'Bread', categoryId: 'bakery', clues: { s: { kind: 'aisle', aisle: '3', side: 'R', pos: 'front' } } },
  { id: 'cereal', name: 'Cheerios', categoryId: 'breakfast', clues: { s: { kind: 'aisle', aisle: '3', side: 'R', pos: 'back' } } },
  { id: 'milk', name: 'Milk', categoryId: 'dairy', clues: { s: { kind: 'dept', dept: 'dairy' } } },
  { id: 'peas', name: 'Peas', categoryId: 'icecream', clues: { s: { kind: 'freezer' } } },
  { id: 'gum', name: 'Gum', clues: { s: { kind: 'checkout' } } },
  { id: 'granola', name: 'Granola', categoryId: 'breakfast' },
];
const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
  gen: { enabled: true, entrance: 'left', locked: [] } };

describe('map from aisle answers', () => {
  it('models the store: aisles 1 to the highest heard, guesses for gaps', () => {
    const m = buildModel(products, 's');
    expect(m.aisles.map((a) => `${a.label}${a.seen ? '' : '?'}`)).toEqual(['1?', '2?', '3']);
    expect(m.depts.sort()).toEqual(['dairy', 'frozen', 'produce']);
    expect(m.checkout).toBe(true);
    const twelve = buildModel([{ id: 'x', name: 'X', clues: { s: { kind: 'aisle', aisle: '2B' } } }], 's');
    expect(twelve.aisles.map((a) => a.label)).toEqual(['1', '2B']);
  });

  it('draws every store the same way: back at the top, entrance mid-front, aisle 1 on the right', () => {
    const l = regenerate(blank, buildModel(products, 's'));
    const labels = l.places.map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(['1L', '2R', '3R', 'Produce', 'Frozen', 'Dairy', 'Checkout']));
    // The outer aisles' far sides are the walls: no end shelf with a walkway before the wall.
    expect(labels).not.toContain('1R');
    expect(labels).not.toContain('3L');
    expect(l.aisles!.map((a) => `${a.label}${a.guess ? '?' : ''}`)).toEqual(['Aisle 1?', 'Aisle 2?', 'Aisle 3']);
    const p = (id: string) => l.places.find((x) => x.id === id)!;
    // Aisle 1 on the right, numbers going up to the left.
    expect(p('g-shelf-1-L').x).toBeGreaterThan(p('g-shelf-3-R').x);
    // Produce up the right wall, Frozen down the left, Dairy along the back (top): the outermost shelves.
    expect(p('g-dept-produce')).toMatchObject({ kind: 'shelf', orientation: 'vertical', back: 1 });
    expect(p('g-dept-produce').x).toBe(p('g-shelf-1-L').x + 3); // aisle 1's right side
    expect(p('g-dept-frozen').x).toBe(p('g-shelf-3-R').x - 3); // aisle 3's left side
    expect(p('g-dept-dairy')).toMatchObject({ orientation: 'horizontal', y: 1, back: -1 });
    const xs = l.places.filter((x) => x.kind === 'shelf').map((x) => x.x);
    expect(p('g-dept-produce').x).toBe(Math.max(...xs));
    expect(p('g-dept-frozen').x).toBe(Math.min(...xs));
    // The entrance in the middle of the bottom line; the checkouts beside it.
    expect(l.entrance).toEqual({ x: Math.floor(l.width / 2), y: l.height - 1 });
    expect(p('g-checkout').y).toBeGreaterThan(p('g-shelf-1-L').y + 14);
    // Categories on the shelf, back of the store (top) first.
    expect((p('g-shelf-3-R') as Shelf).categories).toEqual(['breakfast', 'bakery']);
    // Everything reachable.
    const floor = new Floor(l);
    for (const q of l.places) expect(floor.reachable(l.entrance, { x: q.x, y: q.y })).toBe(true);
  });

  it('can number the aisles from the left and swap Produce and Frozen', () => {
    const l = regenerate({ ...blank, gen: { ...blank.gen!, aisleOne: 'far', produce: 'far' } }, buildModel(products, 's'));
    const x = (id: string) => l.places.find((p) => p.id === id)!.x;
    expect(x('g-shelf-1-R')).toBeLessThan(x('g-shelf-3-L'));
    expect(x('g-dept-produce')).toBeLessThan(x('g-shelf-1-R'));
    expect(x('g-dept-frozen')).toBeGreaterThan(x('g-shelf-3-L'));
    expect(l.gen!.key).toContain('"a1":"far"');
    expect(regenerate(blank, buildModel(products, 's')).gen!.key).not.toContain('a1');
  });

  it('answers land on the generated map, and one answer places the whole category', () => {
    const l = regenerate(blank, buildModel(products, 's'));
    const catalog = new Catalog(products, []);
    const bread = parseExactKey(resolveClue(products[1].clues!.s, l)!)!;
    expect(bread.placeId).toBe('g-shelf-3-R');
    expect(bread.spot.u).toBeGreaterThan(0.7); // front of the store = bottom of the shelf
    expect(resolveClue({ kind: 'checkout' }, l)).toBe('g-checkout');
    expect(resolveClue({ kind: 'freezer' }, l)).toMatch(/^g-dept-frozen/);
    // Granola has no answer, but Cheerios (same category) is on 3L.
    const g = locateProduct(products[6], l, catalog);
    expect(g.kind === 'spot' && g.spot.placeId).toBe('g-shelf-3-R');
  });

  it('keeps the shopper’s edits and own places when regenerating', () => {
    let l = regenerate(blank, buildModel(products, 's'));
    // The shopper renames 2R, deletes the Dairy area and adds their own shelf where aisle 4's shelf will go.
    const edited: StoreLayout = {
      ...l,
      places: [
        ...l.places.filter((p) => p.id !== 'g-dept-dairy').map((p) => (p.id === 'g-shelf-2-R' ? { ...p, label: 'Cereal' } : p)),
        { kind: 'shelf', id: 'mine', label: 'Mine', orientation: 'vertical', x: 4, y: 6, length: 14, categories: [] },
      ],
    };
    const locked = newlyEdited(l, edited);
    expect(locked.sort()).toEqual(['g-dept-dairy', 'g-shelf-2-R']);
    l = { ...edited, gen: { ...edited.gen!, locked } };
    // A new answer: aisle 4 exists.
    const more = [...products, { id: 'chips', name: 'Chips', categoryId: 'snacks', clues: { s: { kind: 'aisle' as const, aisle: '4', side: 'R' as const } } }];
    const r = regenerate(l, buildModel(more, 's'));
    expect(r.places.find((p) => p.id === 'g-shelf-2-R')!.label).toBe('Cereal');
    expect(r.places.some((p) => p.id === 'g-dept-dairy')).toBe(false);
    expect(r.places.some((p) => p.id === 'mine')).toBe(true);
    expect(r.places.some((p) => p.id === 'g-shelf-4-R')).toBe(false); // would overlap "Mine"
    expect(r.places.some((p) => p.id === 'g-shelf-1-L')).toBe(true);
    // Moving the whole store isn't an edit.
    const moved = { ...r, places: r.places.map((p) => ({ ...p, x: p.x + 5 })) };
    expect(newlyEdited(r, moved)).toEqual([]);
  });

  it('sizes the store to fit', () => {
    const parts = generateParts(buildModel(products, 's'));
    // Three aisles of 4, the walls standing where the outer aisles' end shelves would be, and a square of margin each side.
    expect(parts.width).toBe(4 * 3 + 2);
    expect(parts.places.every((p) => p.x >= 0 && p.x < parts.width)).toBe(true);
  });
});

describe('walls as chains of sections, and things out in the open', () => {
  // The example store: entrance front right; Produce then Bread up the right wall; Meat then
  // Refrigerated along the back; Refrigerated then Freezer down the left wall; produce tables
  // near the door and freezer cases in the middle; five aisles.
  const c = (id: string, categoryId: string | undefined, clue: Product['clues'] extends infer _ ? any : never): Product =>
    ({ id, name: id, ...(categoryId && { categoryId }), clues: { s: clue } });
  const shop: Product[] = [
    c('apples', 'fruit', { kind: 'wall', wall: 'right', part: 'front' }),
    c('bread', 'bakery', { kind: 'wall', wall: 'right', part: 'back' }),
    c('steak', 'meat', { kind: 'wall', wall: 'back', part: 'left' }),
    c('juice', 'water', { kind: 'wall', wall: 'back', part: 'right', temp: 'chilled' }),
    c('cheese', undefined, { kind: 'wall', wall: 'left', part: 'back', temp: 'chilled' }),
    c('pizza', 'frozen', { kind: 'wall', wall: 'left', part: 'front', temp: 'frozen' }),
    c('melon', 'fruit', { kind: 'open', near: 'entrance', fixture: 'table' }),
    c('icecream', 'icecream', { kind: 'open', near: 'middle', fixture: 'case', temp: 'frozen' }),
    c('cereal', 'breakfast', { kind: 'aisle', aisle: '5' }),
  ];
  const l = regenerate({ ...blank, gen: { enabled: true, entrance: 'right', locked: [] } }, buildModel(shop, 's'));
  const get = (id: string) => { const p = l.places.find((x) => x.id === id); if (!p) throw new Error(`no ${id}: ${l.places.map((x) => x.id)}`); return p; };

  it('puts each wall’s sections in the order said', () => {
    const produce = get('g-dept-produce');
    const bakery = get('g-dept-bakery');
    expect(produce.x).toBeGreaterThan(l.width / 2); // right wall
    expect(bakery.x).toBe(produce.x);
    expect(bakery.y).toBeLessThan(produce.y); // back of the store is up the map
    // Wall sections are shelves stocked from the store side (closed against the wall).
    expect(produce).toMatchObject({ kind: 'shelf', orientation: 'vertical', back: 1, x: l.width - 2 });
    expect(get('g-dept-meat')).toMatchObject({ kind: 'shelf', orientation: 'horizontal', back: -1, y: 1 });
    expect(get('g-dept-meat').x).toBeLessThan(get('g-wall-back-chilled').x);
    expect(get('g-wall-back-chilled')).toMatchObject({ kind: 'shelf', temp: 'chilled', y: 1, label: 'Refrigerated' });
    const leftFridge = get('g-wall-left-chilled');
    const freezer = get('g-wall-left-frozen');
    expect(leftFridge.x).toBe(1);
    expect(freezer.x).toBeLessThan(l.width / 2);
    expect(leftFridge.y).toBeLessThan(freezer.y);
    expect(freezer.temp).toBe('frozen');
  });

  it('puts tables and cases out in the open, between the aisles and the checkout', () => {
    const table = get('g-open-entrance-table-room');
    const fcase = get('g-open-middle-case-frozen');
    expect(table.label).toBe('Produce table');
    expect(fcase).toMatchObject({ label: 'Freezer case', temp: 'frozen' });
    // The table near the door is nearer the middle of the front (where the door is) than the case.
    const fromDoor = (p: { x: number; w?: number }) => Math.abs(p.x + 1.5 - l.entrance.x);
    expect(fromDoor(table)).toBeLessThanOrEqual(fromDoor(fcase));
    const shelfEnd = Math.max(...l.places.filter((p) => p.kind === 'shelf' && p.orientation === 'vertical' && p.id.startsWith('g-shelf')).map((p) => p.y + (p as Shelf).length));
    expect(table.y).toBeGreaterThan(shelfEnd);
  });

  it('answers land where they were said, and everything can be reached', () => {
    const catalog = new Catalog(shop, []);
    const where = (id: string) => { const r = locateProduct(shop.find((p) => p.id === id)!, l, catalog); return r.kind === 'spot' ? r.spot.placeId : r.kind; };
    expect(where('bread')).toBe('g-dept-bakery');
    expect(where('pizza')).toBe('g-wall-left-frozen');
    expect(where('cheese')).toBe('g-wall-left-chilled');
    expect(where('juice')).toBe('g-wall-back-chilled');
    expect(where('melon')).toBe('g-open-entrance-table-room');
    expect(where('icecream')).toBe('g-open-middle-case-frozen');
    const floor = new Floor(l);
    for (const p of l.places) {
      const f = p.kind === 'shelf' ? { x: p.x, y: p.y } : { x: p.x, y: p.y };
      expect(floor.reachable(l.entrance, f), p.id).toBe(true);
    }
  });
});

describe('what a rebuild changed', () => {
  it('lists new and changed parts, not the ones left as they were', async () => {
    const { changedParts } = await import('./generate');
    const before = regenerate(blank, buildModel(products, 's'));
    const more = [...products, { id: 'chips', name: 'Chips', categoryId: 'snacks', clues: { s: { kind: 'aisle' as const, aisle: '2', side: 'R' as const } } }];
    const after = regenerate(before, buildModel(more, 's'));
    const changed = changedParts(before, after);
    // Aisle 2 is no longer a guess, and its right-hand shelf now stocks snacks.
    expect(changed).toEqual(expect.arrayContaining(['g-shelf-2-R', 'g-aisle-2']));
    expect(changed).not.toContain('g-dept-produce');
  });
});

describe('the edges of the store', () => {
  const aisleAt = (id: string, n: string): Product => ({ id, name: id, categoryId: 'snacks', clues: { s: { kind: 'aisle', aisle: n } } });
  const blank2: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
    gen: { enabled: true, entrance: 'left', locked: [] } };

  it('keeps an outer aisle’s end shelf when nothing is on that wall', () => {
    const l = regenerate(blank2, buildModel([aisleAt('a', '1'), aisleAt('b', '2')], 's'));
    expect(l.places.map((p) => p.label)).toEqual(expect.arrayContaining(['1L', '1R', '2L', '2R']));
  });

  it('front wall shelving runs along the bottom row either side of the door; nothing below the door and checkouts', () => {
    const ps: Product[] = [
      aisleAt('a', '1'), aisleAt('b', '2'), aisleAt('c', '3'),
      { id: 'gum', name: 'Gum', clues: { s: { kind: 'checkout' } } },
      { id: 'cards', name: 'Cards', categoryId: 'cards', clues: { s: { kind: 'wall', wall: 'front', part: 'left' } } },
      { id: 'water', name: 'Water', categoryId: 'water', clues: { s: { kind: 'wall', wall: 'front', part: 'right' } } },
    ];
    const l = regenerate(blank2, buildModel(ps, 's'));
    const front = l.places.filter((p) => p.id.startsWith('g-wall-front'));
    expect(front).toHaveLength(2);
    const [left, right] = [...front].sort((a, b) => a.x - b.x);
    expect([left.y, right.y]).toEqual([l.height - 1, l.height - 1]);
    expect(left.kind === 'shelf' && left.x + left.length).toBeLessThan(l.entrance.x);
    expect(right.x).toBeGreaterThan(l.entrance.x);
    expect(left.categories).toEqual(['cards']);
    expect(right.categories).toEqual(['water']);
    // The door is on the bottom row, the checkouts just above it, nothing further down.
    expect(l.entrance.y).toBe(l.height - 1);
    const co = l.places.find((p) => p.id === 'g-checkout')!;
    expect(co.kind === 'area' && co.y + co.h).toBe(l.height - 1);
    expect(Math.max(...l.places.map((p) => footprint(p).y + footprint(p).h))).toBe(l.height);
    // Answers land there.
    expect(resolveClue({ kind: 'wall', wall: 'front', part: 'right' }, l)).toMatch(new RegExp(`^${right.id}`));
    const floor = new Floor(l);
    for (const q of l.places) expect(floor.reachable(l.entrance, { x: q.x, y: q.y })).toBe(true);
  });
});

describe('sample-store fixes', () => {
  const blank3: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
    gen: { enabled: true, entrance: 'left', locked: [] } };
  const aisleAt = (id: string, n: string, categoryId = 'snacks'): Product => ({ id, name: id, categoryId, clues: { s: { kind: 'aisle', aisle: n } } });

  it('the back wall stops at the outermost shelf on a side with nothing along its wall', () => {
    const ps: Product[] = [aisleAt('a', '1'), aisleAt('b', '2'), { id: 'milk', name: 'Milk', categoryId: 'dairy', clues: { s: { kind: 'dept', dept: 'dairy' } } }];
    const l = regenerate(blank3, buildModel(ps, 's'));
    const shelves = l.places.filter((p) => p.id.startsWith('g-shelf-')).map(footprint);
    const back = footprint(l.places.find((p) => p.id === 'g-dept-dairy')!);
    expect(back.x).toBe(Math.min(...shelves.map((r) => r.x)));
    expect(back.x + back.w).toBe(Math.max(...shelves.map((r) => r.x + r.w)));
  });

  it('a stand by the back wall goes in a strip under it, its answer finds it, and it doesn’t take the whole category', () => {
    const ps: Product[] = [
      aisleAt('a', '1'), aisleAt('b', '2'),
      { id: 'apples', name: 'Apples', categoryId: 'fruit', clues: { s: { kind: 'dept', dept: 'produce' } } },
      { id: 'melon', name: 'Melon', categoryId: 'fruit', clues: { s: { kind: 'open', near: 'back', fixture: 'stand' } } },
    ];
    let l = regenerate(blank3, buildModel(ps, 's'));
    const stand = l.places.find((p) => p.id.startsWith('g-open-'))!;
    const shelfTop = Math.min(...l.places.filter((p) => p.id.startsWith('g-shelf-')).map((p) => p.y));
    expect(stand.y + footprint(stand).h).toBeLessThan(shelfTop);
    expect(stand.categories).toEqual([]); // a display: other fruit stays in Produce
    expect(resolveClue(ps[3].clues!.s, l)).toMatch(new RegExp(`^${stand.id}`));
    // Put in the back right corner (the spot card's option): its answer still finds it.
    l = regenerate({ ...l, gen: { ...l.gen!, placements: { [`isl:${stand.id.slice(7)}`]: { of: 'back:right' } } } }, buildModel(ps, 's'));
    const moved = l.places.find((p) => p.id === stand.id)!;
    expect(moved.x + footprint(moved).w).toBe(l.width - 2); // against the right wall
    expect(resolveClue(ps[3].clues!.s, l)).toMatch(new RegExp(`^${stand.id}`));
  });

  it('sections can be short stubs, or split in two by a walkway', () => {
    const style = { example: 'B12', roles: ['section', 'shelf'] as ('section' | 'shelf')[], pairing: 'backToBack' as const };
    const code = (id: string, c: string): Product => ({ id, name: id, clues: { s: { kind: 'shelf', code: c, section: c[0], shelf: Number(c.slice(1)) } } });
    const ps = [code('x', 'A2'), code('y', 'B4')];
    const base = { ...blank3, labels: style };
    const long = regenerate(base, buildModel(ps, 's'));
    const len = (l: StoreLayout, id: string) => (l.places.find((p) => p.id === id) as Shelf).length;
    const short = regenerate({ ...base, gen: { ...base.gen!, shapes: { 'block:A': 'short' } } }, buildModel(ps, 's'));
    expect(len(short, 'g-sec-A-1')).toBeLessThan(len(long, 'g-sec-A-1'));
    const split = regenerate({ ...base, gen: { ...base.gen!, shapes: { 'block:B': 'split' } } }, buildModel(ps, 's'));
    const halves = split.places.filter((p) => p.id === 'g-sec-B-1' || p.id === 'g-sec-B-1~2') as Shelf[];
    expect(halves).toHaveLength(2);
    expect(halves.map((h) => h.label)).toEqual(['B1', 'B1']);
    expect(Math.abs(halves[1].y - halves[0].y)).toBeGreaterThan(halves[0].length); // a walkway between
  });
});
