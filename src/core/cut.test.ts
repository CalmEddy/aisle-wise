import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { resolveClue } from './clues';
import { cutAisles, cutPreview, renumberAisles } from './cut';
import { Floor } from './floor';
import { buildModel, regenerate } from './generate';
import { parseExactKey } from './geometry';
import { locateProduct } from './locate';
import type { Product, Shelf, StoreLayout } from './types';

// Three aisles of up-and-down shelves from y=2 to y=22; entrance bottom left.
const shelf = (id: string, x: number, categories: string[] = []): Shelf => ({ kind: 'shelf', id, label: id, orientation: 'vertical', x, y: 2, length: 20, categories });
const store: StoreLayout = {
  id: 's', name: 'S', width: 20, height: 26, entrance: { x: 1, y: 25 }, checkout: { x: 10, y: 25 },
  places: [shelf('s1', 2, ['breakfast', 'coffee']), shelf('s2', 5, ['pasta', 'canned']), shelf('s3', 8), shelf('s4', 11)],
  aisles: [
    { id: 'a1', label: 'Aisle 1', x: 3, y: 2, w: 2, h: 20 },
    { id: 'a2', label: 'Aisle 2', x: 6, y: 2, w: 2, h: 20 },
    { id: 'a3', label: 'Aisle 3', x: 9, y: 2, w: 2, h: 20 },
  ],
};
// A cross aisle 2 squares wide, across all the shelves, at y 12–13.
const box = { x: 1, y: 12, w: 14, h: 2 };

describe('cutting aisles with a cross aisle', () => {
  it('previews the shelves and aisles crossed', () => {
    const p = cutPreview(store, box);
    expect(p.shelves.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(p.aisles.map((a) => a.label)).toEqual(['Aisle 1', 'Aisle 2', 'Aisle 3']);
    expect(p.removed[0]).toEqual({ x: 2, y: 12, w: 1, h: 2 });
  });

  it('splits each shelf in two; the back half keeps its id, categories and spots follow their half', () => {
    const milk: Product = { id: 'p', name: 'P', locations: { s: 's1@0.9,0.5' } };
    const coffee: Product = { id: 'c', name: 'C', locations: { s: 's1:coffee' } };
    const r = cutAisles(store, [milk, coffee], box, 'same');
    expect(r.cut).toBe(4);
    const pieces = r.layout.places.filter((p) => p.x === 2) as Shelf[];
    expect(pieces).toHaveLength(2);
    const back = pieces.find((p) => p.id === 's1')!;
    const front = pieces.find((p) => p.id !== 's1')!;
    expect(back).toMatchObject({ y: 2, length: 10, categories: ['breakfast'] });
    expect(front).toMatchObject({ y: 14, length: 8, categories: ['coffee'], label: 's1' });
    // Spots: 0.9 along the old shelf (y 20) is now near the end of the front half.
    const k = parseExactKey(r.products[0].locations!.s)!;
    expect(k.placeId).toBe(front.id);
    expect(k.spot.u).toBeCloseTo(0.75, 2);
    expect(r.products[1].locations!.s).toBe(`${front.id}:coffee`);
    // Same numbers: the aisle labels are untouched, and you can now walk across.
    expect(r.layout.aisles).toEqual(store.aisles);
    const floor = new Floor(r.layout);
    expect(floor.distance({ x: 3, y: 12 }, { x: 9, y: 12 })).toBe(6);
  });

  it('“Aisle 2, middle” still finds a shelf when the middle is now the cross aisle', () => {
    const r = cutAisles(store, [], box, 'same');
    const key = resolveClue({ kind: 'aisle', aisle: '2', side: 'L', pos: 'middle' }, r.layout);
    expect(parseExactKey(key!)!.placeId).toMatch(/^s2/);
  });

  it('new numbers: the front halves become aisles 4, 5, 6 in order', () => {
    const r = cutAisles(store, [], box, 'new');
    const labels = r.layout.aisles!.map((a) => `${a.label}@${a.y}+${a.h}`).sort();
    expect(labels).toEqual(['Aisle 1@2+10', 'Aisle 2@2+10', 'Aisle 3@2+10', 'Aisle 4@14+8', 'Aisle 5@14+8', 'Aisle 6@14+8']);
    expect(r.layout.aisles!.find((a) => a.label === 'Aisle 4')!.x).toBe(3);
    expect(r.renamed).toEqual(['Aisle 1 → Aisle 4', 'Aisle 2 → Aisle 5', 'Aisle 3 → Aisle 6']);
    // Shelves named for their aisle follow the new number; others are marked as the front half.
    const relabel = cutAisles({ ...store, places: store.places.map((p) => ({ ...p, label: p.id === 's2' ? '1R' : p.label })) }, [], box, 'new');
    expect(relabel.layout.places.filter((p) => p.x === 5).map((p) => p.label).sort()).toEqual(['1R', '4R']);
    expect(relabel.layout.places.filter((p) => p.x === 2).map((p) => p.label).sort()).toEqual(['s1', 's1 (front)']);
  });

  it('a tall box cuts side-to-side shelves only', () => {
    expect(cutPreview(store, { x: 2, y: 4, w: 2, h: 12 }).shelves).toEqual([]);
  });

  it('renumbers aisles: the back block from the door across, then the front block', () => {
    const r = cutAisles(store, [], box, 'new');
    const scrambled = { ...r.layout, aisles: r.layout.aisles!.map((a, i) => ({ ...a, label: `Aisle ${[9, 3, 7, 1, 5, 2][i]}` })) };
    const re = renumberAisles(scrambled);
    const at = (x: number, y: number) => re.aisles!.find((a) => a.x === x && a.y === y)!.label;
    expect([at(3, 2), at(6, 2), at(9, 2), at(3, 14), at(6, 14), at(9, 14)]).toEqual(['Aisle 1', 'Aisle 2', 'Aisle 3', 'Aisle 4', 'Aisle 5', 'Aisle 6']);
  });

  it('on a generated map, the cut is kept and new-numbered aisles aren’t generated twice', () => {
    const products: Product[] = [1, 2, 3].map((n) => ({ id: `p${n}`, name: `P${n}`, categoryId: 'snacks', clues: { s: { kind: 'aisle' as const, aisle: String(n) } } }));
    const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 }, gen: { enabled: true, entrance: 'left', locked: [] } };
    const g = regenerate(blank, buildModel(products, 's'));
    const r = cutAisles(g, products, { x: 0, y: 12, w: g.width, h: 2 }, 'new');
    // The shopper's cut locks the shelves it changed (as App does via newlyEdited).
    const locked = g.places.filter((p) => p.id.startsWith('g-shelf')).map((p) => p.id).concat(g.aisles!.map((a) => a.id));
    const cut = { ...r.layout, gen: { ...g.gen!, locked } };
    // A new answer for aisle 5 (the front half of aisle 2).
    const more = [...products, { id: 'p5', name: 'P5', categoryId: 'pasta', clues: { s: { kind: 'aisle' as const, aisle: '5' } } }];
    const again = regenerate(cut, buildModel(more, 's'));
    expect(again.aisles!.filter((a) => a.label === 'Aisle 5')).toHaveLength(1);
    expect(again.places.some((p) => p.id === 'g-shelf-5-L')).toBe(false);
    // The front halves are kept (they're the shopper's now), and aisle 5's answer lands on one.
    expect(again.places.filter((p) => p.id.startsWith('cut-'))).toHaveLength(6);
    const where = locateProduct(more[3], again, new Catalog(more, []));
    expect(where.kind).toBe('spot');
    expect(where.kind === 'spot' && where.spot.placeId).toMatch(/^cut-/);
  });
});

describe('an area put down over shelves', () => {
  it('splits every shelf under it, whichever way it runs', async () => {
    const { cutUnder, shelvesUnder } = await import('./cut');
    const l: StoreLayout = {
      ...store,
      places: [...store.places, { kind: 'shelf', id: 'h', label: 'h', orientation: 'horizontal', x: 1, y: 24, length: 14, categories: [] }],
      height: 30,
    };
    const area = { x: 4, y: 8, w: 5, h: 3 }; // over s2 (x 5) and s3 (x 8)
    expect(shelvesUnder(l, area)).toBe(2);
    const r = cutUnder(l, [], area);
    expect(r.cut).toBe(2);
    const s2 = r.layout.places.filter((p) => p.x === 5) as Shelf[];
    expect(s2.map((p) => [p.y, p.length]).sort((a, b) => a[0] - b[0])).toEqual([[2, 6], [11, 11]]);
    // A side-to-side shelf under a tall area is cut too.
    const r2 = cutUnder(l, [], { x: 6, y: 23, w: 2, h: 3 });
    expect(r2.layout.places.filter((p) => p.y === 24).map((p) => [p.x, (p as Shelf).length]).sort((a, b) => a[0] - b[0])).toEqual([[1, 5], [8, 7]]);
  });
});
