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
  { id: 'steak', name: 'steak', categoryId: 'meat', clues: { s: { kind: 'dept', dept: 'meat' } } },
];
const catalog = new Catalog(products, []);
const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
  gen: { enabled: true, entrance: 'left', locked: [] } };
const store = regenerate(blank, buildModel(products, 's'));
const trip = (names: string[], start = 0): Trip => ({ layoutId: 's', start, picks: names.map((name, i) => ({ productId: name, name, at: start + i })) });

describe('learning the arrangement from trips', () => {
  it('needs a few picks first, and never asks about the entrance (it’s mid-front)', () => {
    const l = learnArrangement(store, products, [trip(['apples', 'a1'])], catalog);
    expect(l.apply).toEqual({});
    expect(l.question).toBeUndefined();
  });

  it('sees that aisle 1 is on the left when shoppers go from Produce (right wall) to aisle 6 first', () => {
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
    // Usually Dairy is at the left end of the back wall and Meat at the right, next to the bakery;
    // these shoppers come from the bakery (right wall) to the milk first, then the steak, then the far aisles.
    // (Aisle 1 settled already: ending at aisle 1 by a checkout on the left could also say "aisle 1 on the left".)
    const walk = ['apples', 'bread', 'milk', 'steak', 'a6', 'a5', 'a1'];
    const settled = { ...store, gen: { ...store.gen!, sure: ['aisleOne' as const] } };
    const l = learnArrangement(settled, products, [trip(walk), trip(walk, 1e9)], catalog);
    expect(l.apply.backWall).toBe('reversed');
  });

  it('never changes what the shopper said', () => {
    const walk = ['apples', 'a6', 'a5', 'a4', 'a3', 'a2', 'a1'];
    const sure = { ...store, gen: { ...store.gen!, sure: ['aisleOne' as const] } };
    expect(learnArrangement(sure, products, [trip(walk), trip(walk, 1e9)], catalog).apply.aisleOne).toBeUndefined();
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
    expect(describeArrangement({ aisleOne: 'far' })).toBe('aisle 1 is on the left');
    expect(describeArrangement({ produce: 'far' })).toBe('Produce is along the left wall');
  });

  it('asks instead of turning the map round after only one trip, or once it has been edited by hand', () => {
    const walk = ['apples', 'a6', 'a5', 'a4', 'a3', 'a2', 'a1'];
    const one = learnArrangement(store, products, [trip(walk)], catalog);
    expect(one.apply).toEqual({});
    expect(one.question?.setting).toBe('aisleOne');
    const edited = { ...store, gen: { ...store.gen!, locked: ['g-shelf-3-R'] } };
    const two = learnArrangement(edited, products, [trip(walk), trip(walk, 1e9)], catalog);
    expect(two.apply).toEqual({});
    expect(two.question?.setting).toBe('aisleOne');
  });

  it('counts only places the shopper gave, not ones the map guessed from an item’s kind', () => {
    // Oatmeal has no answer; the map guesses it's by the cereal (aisle 1). It isn't evidence.
    const more = [...products, { id: 'oatmeal', name: 'oatmeal', categoryId: 'breakfast' }];
    const l = learnArrangement(store, more, [trip(['apples', 'oatmeal', 'a6', 'oatmeal'])], new Catalog(more, []));
    expect(l.picks).toBe(2);
  });
});
