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

  it('a store it knows nothing about still gets a sensible order from categories', () => {
    const blank: StoreLayout = { id: 'new', name: 'New', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 } };
    const list: Product[] = [
      { id: '1', name: 'Ice cream', categoryId: 'icecream' }, { id: '2', name: 'Milk', categoryId: 'dairy' },
      { id: '3', name: 'Pasta', categoryId: 'pasta' }, { id: '4', name: 'Apples', categoryId: 'fruit' },
      { id: '5', name: 'Cereal', categoryId: 'breakfast' }, { id: '6', name: 'Bread', categoryId: 'bakery' },
      { id: '7', name: 'Chicken', categoryId: 'meat' }, { id: '8', name: 'Mystery' },
      // An answer beats the guess: aisle 2 comes before the centre-store guesses.
      { id: '9', name: 'Soup', categoryId: 'canned', clues: { new: { kind: 'aisle', aisle: '2' } } },
    ];
    const catalog = new Catalog(list, []);
    const items = list.map((p) => ({ id: p.id, name: p.name, done: false, productId: p.id }));
    const g = groupIntoStops(items, (i) => locateItem(i, blank, catalog));
    expect(g.byClue.map((b) => b.item.name)).toEqual(['Apples', 'Bread', 'Soup', 'Cereal', 'Pasta', 'Chicken', 'Milk', 'Ice cream']);
    expect(g.unplaced.map((i) => i.name)).toEqual(['Mystery']);
  });
});

describe('walls and open floor', () => {
  // Entrance front right; Bread and Produce up the right wall; fridges along the back; a freezer case and a produce table in the open.
  const l: StoreLayout = {
    id: 'w', name: 'W', width: 40, height: 30, entrance: { x: 37, y: 29 }, checkout: { x: 20, y: 29 },
    places: [
      { kind: 'area', id: 'bread', label: 'Bread', x: 35, y: 3, w: 4, h: 8, categories: ['bakery'] },
      { kind: 'area', id: 'produce', label: 'Produce', x: 35, y: 12, w: 4, h: 12, categories: ['fruit'] },
      { kind: 'shelf', id: 'fridge', label: 'Refrigerated', orientation: 'horizontal', x: 10, y: 0, length: 25, back: -1, categories: [], temp: 'chilled' },
      { kind: 'shelf', id: 'meat', label: 'Meat', orientation: 'horizontal', x: 1, y: 0, length: 8, back: -1, categories: ['meat'] },
      { kind: 'shelf', id: 'lfridge', label: 'Fridge', orientation: 'vertical', x: 0, y: 3, length: 12, back: -1, categories: [], temp: 'chilled' },
      { kind: 'shelf', id: 'lfreezer', label: 'Freezer', orientation: 'vertical', x: 0, y: 17, length: 8, back: -1, categories: [], temp: 'frozen' },
      { kind: 'shelf', id: 'a1', label: '1', orientation: 'vertical', x: 10, y: 4, length: 12, categories: [] },
      { kind: 'area', id: 'case', label: 'Freezer case', x: 9, y: 19, w: 2, h: 4, categories: [], temp: 'frozen' },
      { kind: 'area', id: 'table', label: 'Produce table', x: 28, y: 19, w: 3, h: 2, categories: ['fruit'] },
    ],
  };
  const at = (c: Clue) => resolveClue(c, l)?.split('@')[0];

  it('finds the place along the wall said, as you face in from the entrance', () => {
    expect(at({ kind: 'wall', wall: 'right', part: 'back' })).toBe('bread');
    expect(at({ kind: 'wall', wall: 'right', part: 'front' })).toBe('produce');
    expect(at({ kind: 'wall', wall: 'back', part: 'left' })).toBe('meat');
    expect(at({ kind: 'wall', wall: 'back' })).toBe('fridge');
    expect(at({ kind: 'wall', wall: 'left', part: 'front', temp: 'frozen' })).toBe('lfreezer');
    // A fridge asked for: the fridge, even if the freezer is nearer the part said.
    expect(at({ kind: 'wall', wall: 'left', part: 'front', temp: 'chilled' })).toBe('lfridge');
  });

  it('finds tables and cases out on the floor', () => {
    expect(at({ kind: 'open', near: 'entrance' })).toBe('table');
    expect(at({ kind: 'open', near: 'far', temp: 'frozen' })).toBe('case');
    expect(at({ kind: 'open', near: 'middle', temp: 'frozen' })).toBe('case');
  });

  it('describes and sorts them', () => {
    expect(describeClue({ kind: 'wall', wall: 'left', part: 'front', temp: 'frozen' })).toBe('Freezer, left wall · front');
    expect(describeClue({ kind: 'wall', wall: 'back' })).toBe('Back wall');
    expect(describeClue({ kind: 'open', fixture: 'table', near: 'entrance' })).toBe('Table near the door');
    expect(describeClue({ kind: 'open', fixture: 'case', temp: 'frozen' })).toBe('Freezer, case');
    expect(describeClue({ kind: 'open', aisle: '4' })).toBe('Out in the open by aisle 4');
    expect(describeClue({ kind: 'aisle', aisle: '7', temp: 'chilled', side: 'L' })).toBe('Fridge, aisle 7 · left');
    expect(clueRank({ kind: 'open', near: 'entrance' })).toBeLessThan(clueRank({ kind: 'aisle', aisle: '1' }));
    expect(clueRank({ kind: 'wall', wall: 'left', part: 'front' })).toBeLessThan(clueRank({ kind: 'wall', wall: 'back', part: 'left' }));
    expect(clueRank({ kind: 'wall', wall: 'back', part: 'right' })).toBeLessThan(clueRank({ kind: 'wall', wall: 'right', part: 'back' }));
    expect(clueRank({ kind: 'wall', wall: 'right', part: 'back' })).toBeLessThan(clueRank({ kind: 'wall', wall: 'right', part: 'front' }));
  });
});
