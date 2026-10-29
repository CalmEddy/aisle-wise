import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { aisleNumber, aislesUsed, clueRank, describeClue, guessDept, resolveClue } from './clues';
import { parseExactKey } from './geometry';
import { groupIntoStops, locateItem } from './locate';
import type { Clue, Product, Shelf, StoreLayout } from './types';

const v = (id: string, x: number): Shelf => ({ kind: 'shelf', id, label: id, x, y: 4, orientation: 'vertical', length: 10, categories: [] });
// Entrance at the bottom: the front of each aisle is its bottom end (y 13).
const store: StoreLayout = {
  id: 's', name: 'S', width: 20, height: 20, entrance: { x: 1, y: 19 }, checkout: { x: 10, y: 19 },
  places: [v('a', 3), v('b', 6), { kind: 'area', id: 'prod', label: 'Produce', x: 12, y: 2, w: 4, h: 4, categories: ['fruit'] }],
  aisles: [{ id: 'x', label: 'Aisle 7', x: 4, y: 4, w: 2, h: 10 }],
};

describe('plain-language locations', () => {
  it('sorts the way you walk a typical store', () => {
    const clues: Clue[] = [
      { kind: 'checkout' }, { kind: 'dept', dept: 'dairy' }, { kind: 'aisle', aisle: '12', pos: 'back' },
      { kind: 'aisle', aisle: '3' }, { kind: 'endcap', aisle: '12', end: 'front' }, { kind: 'dept', dept: 'produce' },
      { kind: 'aisle', aisle: '12', pos: 'front' }, { kind: 'aisle', aisle: '12B' },
    ];
    const order = [...clues].sort((a, b) => clueRank(a) - clueRank(b)).map(describeClue);
    expect(order).toEqual([
      'Produce', 'Aisle 3', 'End of aisle 12 (front)', 'Aisle 12 · front', 'Aisle 12 · back', 'Aisle 12B', 'Dairy', 'Checkout',
    ]);
    expect(aisleNumber('12B')).toBeCloseTo(12.2);
    expect(guessDept('fruit')).toBe('produce');
    expect(guessDept('eggs')).toBe('dairy');
    expect(guessDept('pasta')).toBeUndefined();
  });

  it('lands on the map where there is an aisle label: left/right as you walk in from the front', () => {
    // Walking up the aisle from the bottom: left is x 3 (shelf a), right is x 6 (shelf b).
    const left = parseExactKey(resolveClue({ kind: 'aisle', aisle: '7', side: 'L', pos: 'front' }, store)!)!;
    expect(left.placeId).toBe('a');
    expect(left.spot.u).toBeGreaterThan(0.8); // the front is the bottom end of the shelf
    expect(parseExactKey(resolveClue({ kind: 'aisle', aisle: '07', side: 'R', pos: 'back' }, store)!)!.placeId).toBe('b');
    // Entrance at the top instead: sides swap.
    const flipped = { ...store, entrance: { x: 1, y: 0 } };
    expect(parseExactKey(resolveClue({ kind: 'aisle', aisle: '7', side: 'L' }, flipped)!)!.placeId).toBe('b');
    // Departments by name or category; nothing to place an unknown aisle on.
    expect(resolveClue({ kind: 'dept', dept: 'produce' }, store)).toBe('prod');
    expect(resolveClue({ kind: 'aisle', aisle: '9' }, store)).toBeUndefined();
    expect(resolveClue({ kind: 'checkout' }, store)).toBeUndefined();
  });

  it('items with a clue but nowhere on the map are listed in walking order, not as "no location"', () => {
    const products: Product[] = [
      { id: 'milk', name: 'Milk', clues: { s: { kind: 'dept', dept: 'dairy' } } },
      { id: 'bread', name: 'Bread', clues: { s: { kind: 'aisle', aisle: '9', side: 'L' } } },
      { id: 'apples', name: 'Apples', clues: { s: { kind: 'dept', dept: 'produce' } } },
      { id: 'jam', name: 'Jam' },
    ];
    const catalog = new Catalog(products, []);
    const items = products.map((p) => ({ id: p.id, name: p.name, done: false, productId: p.id }));
    const g = groupIntoStops(items, (i) => locateItem(i, store, catalog));
    expect(g.stops.map((s) => s.placeId)).toEqual(['prod']); // apples: Produce is on the map
    expect(g.byClue.map((b) => b.item.name)).toEqual(['Bread', 'Milk']);
    expect(g.unplaced.map((i) => i.name)).toEqual(['Jam']);
    expect(aislesUsed(products, 's')).toEqual(['9']);
  });
});
