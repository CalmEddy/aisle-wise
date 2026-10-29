import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { buildModel, regenerate } from './generate';
import { describeArrangement, learnArrangement } from './learn';
import type { Trip } from './trips';
import type { Product, StoreLayout } from './types';

const aisle = (id: string, n: string, categoryId = 'snacks'): Product => ({ id, name: id, categoryId, clues: { s: { kind: 'aisle', aisle: n, pos: 'middle' } } });
const products: Product[] = [
  { id: 'apples', name: 'apples', categoryId: 'fruit', clues: { s: { kind: 'dept', dept: 'produce' } } },
  aisle('a1', '1', 'breakfast'), aisle('a2', '2', 'coffee'), aisle('a3', '3', 'baking'), aisle('a4', '4', 'pasta'), aisle('a5', '5', 'canned'), aisle('a6', '6', 'condiments'),
  { id: 'milk', name: 'milk', categoryId: 'dairy', clues: { s: { kind: 'dept', dept: 'dairy' } } },
  { id: 'bread', name: 'bread', categoryId: 'bakery', clues: { s: { kind: 'dept', dept: 'bakery' } } },
];
const catalog = new Catalog(products, []);
const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
  gen: { enabled: true, entrance: 'left', locked: [] } };
const store = regenerate(blank, buildModel(products, 's'));
const trip = (names: string[], start = 0): Trip => ({ layoutId: 's', start, picks: names.map((name, i) => ({ productId: name, name, at: start + i })) });

describe('learning the arrangement from trips', () => {
  it('needs a few picks first, but asks about the entrance once there are trips', () => {
    const l = learnArrangement(store, products, [trip(['apples', 'a1'])], catalog);
    expect(l.apply).toEqual({});
    expect(l.question?.setting).toBe('entrance');
  });

  it('sees that aisle 1 is the far end when shoppers walk 6 → 1', () => {
    const walk = ['apples', 'a6', 'a5', 'a4', 'a3', 'a2', 'a1'];
    const l = learnArrangement(store, products, [trip(walk), trip(walk, 1e9)], catalog);
    expect(l.apply).toEqual({ aisleOne: 'far' });
    expect(l.picks).toBe(14);
  });

  it('leaves it alone when the walks fit the map as it is', () => {
    const walk = ['apples', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    const l = learnArrangement(store, products, [trip(walk)], catalog);
    expect(l.apply).toEqual({});
  });

  it('learns the back wall runs the other way', () => {
    // Usual order puts Bakery on the entrance side, Dairy far; these shoppers get milk first.
    const walk = ['apples', 'milk', 'bread', 'a6', 'a1'];
    const l = learnArrangement(store, products, [trip(walk), trip(walk, 1e9)], catalog);
    expect(l.apply.backWall).toBe('reversed');
  });

  it('never changes what the shopper said', () => {
    const walk = ['apples', 'a6', 'a5', 'a4', 'a3', 'a2', 'a1'];
    const sure = { ...store, gen: { ...store.gen!, sure: ['aisleOne' as const] } };
    expect(learnArrangement(sure, products, [trip(walk), trip(walk, 1e9)], catalog).apply).toEqual({});
  });

  it('asks one question when the walks can’t tell', () => {
    // Back and forth between the middle aisles: barely says which end aisle 1 is.
    const walk = ['a3', 'a4', 'a3', 'a4', 'a3', 'a4'];
    const l = learnArrangement(store, products, [trip(walk.slice(0, 2)), trip(walk, 1e9)], catalog);
    expect(l.apply).toEqual({});
    expect(l.question?.setting).toBe('aisleOne');
    expect(l.question?.options.map((o) => o.patch)).toEqual([{ aisleOne: 'near' }, { aisleOne: 'far' }]);
  });

  it('describes changes in plain words', () => {
    expect(describeArrangement({ aisleOne: 'far' })).toBe('aisle 1 is the farthest from the door');
  });
});
