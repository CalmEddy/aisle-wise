import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { defaultCategories } from './categories';
import { categorySpot, exactKey } from './geometry';
import { withHoldings } from './holdings';
import { locateProduct } from './locate';
import { stocking } from './taxonomy';
import type { Place, Product, StoreLayout } from './types';

const shelf = (id: string, label: string, x: number, categories: string[] = []): Place =>
  ({ kind: 'shelf', id, label, orientation: 'vertical', x, y: 2, length: 8, categories });
const area = (id: string, label: string, x: number, categories: string[] = []): Place =>
  ({ kind: 'area', id, label, x, y: 12, w: 3, h: 2, categories });
const layout = (places: Place[]): StoreLayout =>
  ({ id: 's', name: 'S', width: 30, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 }, places });
const at = (name: string, categoryId: string, placeId: string): Product => ({ id: name, name, categoryId, locations: { s: placeId } });
const where = (p: Product, l: StoreLayout, ps: Product[]) => {
  const r = locateProduct(p, l, new Catalog(ps, defaultCategories));
  return r.kind === 'spot' ? r.spot.placeId : r.kind;
};

describe('what a place holds, from the items put there', () => {
  it('holds several categories; an app-given name gets the main one', () => {
    const l = layout([shelf('s3', 'Shelf 3', 2), shelf('mine', 'Taco aisle', 5)]);
    const ps = [at('Tortillas', 'bakery_tortillas_wraps', 's3'), at('Taco shells', 'intl_mexican_latin', 's3'),
      at('Enchilada sauce', 'intl_mexican_latin', 's3'), at('Salsa', 'condiments_salsa_dips', 's3')];
    const s3 = withHoldings(l, ps).places[0];
    expect(s3.categories).toEqual(['intl_mexican_latin', 'bakery_tortillas_wraps', 'condiments_salsa_dips']);
    expect(s3.label).toBe('Shelf 3 - International Foods');
    expect(s3.baseLabel).toBe('Shelf 3');
    expect(withHoldings(l, ps).places[1].label).toBe('Taco aisle'); // the shopper's name: left alone
  });

  it('keeps what was set by hand, and doesn’t count what was taken off', () => {
    const l = layout([{ ...shelf('a', 'Shelf 1', 2, ['canned_soup_broth']), hides: ['snacks_chips'] }]);
    const ps = [at('Chips', 'snacks_chips', 'a'), at('Salsa', 'condiments_salsa_dips', 'a')];
    const a = withHoldings(l, ps).places[0];
    expect(a.categories).toEqual(['canned_soup_broth', 'condiments_salsa_dips']);
    expect(a.own).toEqual(['canned_soup_broth']);
  });

  it('a table holds its things, but isn’t where their kind lives while there’s a real home', () => {
    const l = layout([shelf('produce', 'Produce', 2, ['produce']), area('t', 'Melon table', 10)]);
    const ps = [at('Melon', 'produce_fruits', 't'), at('Watermelon', 'produce_fruits', 't'), { id: 'g', name: 'Grapes', categoryId: 'produce_fruits' } as Product];
    const shown = withHoldings(l, ps);
    expect(shown.places[1]).toMatchObject({ display: true, categories: ['produce_fruits'] });
    expect(where(ps[2], shown, ps)).toBe('produce');
    // Only a table has fruit: offered (📍), not assumed — it's asked.
    const onlyTable = withHoldings(layout([area('t', 'Melon table', 10)]), ps);
    expect(stocking(onlyTable.places, 'produce_fruits').map((p) => p.id)).toEqual(['t']);
    expect(where(ps[2], onlyTable, ps)).toBe('guess');
  });

  it('one odd item doesn’t make a home when the kind has a better one', () => {
    const l = layout([shelf('a', 'Shelf 1', 2), shelf('b', 'Shelf 2', 5)]);
    const ps = [at('AA batteries', 'household_home_essentials', 'a'), at('AAA batteries', 'household_home_essentials', 'a'),
      at('9V batteries', 'household_home_essentials', 'b'), at('Pasta', 'pasta_dry', 'b'), at('Rice', 'pasta_dry', 'b')];
    const shown = withHoldings(l, ps);
    expect(stocking(shown.places, 'household_home_essentials').map((p) => p.id)).toEqual(['a']);
    expect(shown.places[1].label).toBe('Shelf 2 - Pasta, Rice & Grains');
  });

  it('the International aisle: each item where it was put, the rest of each kind in its own home', () => {
    const l = layout([shelf('intl', 'Shelf 1', 2), shelf('spices', 'Spices', 5, ['spices_seasonings']), shelf('bread', 'Bread', 8, ['bakery_bread'])]);
    const ps = [at('Taco seasoning', 'spices_blends_mixes', 'intl'), at('Tortillas', 'bakery_tortillas_wraps', 'intl'),
      at('Refried beans', 'intl_mexican_latin', 'intl'), at('Taco shells', 'intl_mexican_latin', 'intl'),
      { id: 'c', name: 'Chili powder', categoryId: 'spices_blends_mixes' } as Product, { id: 'w', name: 'Wraps', categoryId: 'bakery_tortillas_wraps' } as Product];
    const shown = withHoldings(l, ps);
    expect(shown.places[0].label).toBe('Shelf 1 - International Foods');
    expect(where(ps[0], shown, ps)).toBe('intl'); // its own answer always wins
    expect(where(ps[4], shown, ps)).toBe('spices'); // one taco seasoning there doesn't move the spices
    expect(where(ps[5], shown, ps)).toBe('bread');
  });

  it('one item in two places: where it was put here wins', () => {
    const l = layout([shelf('a', 'Shelf 1', 2, ['spices_seasonings']), shelf('b', 'Shelf 2', 5, ['intl_mexican_latin'])]);
    const salsa: Product = { id: 'x', name: 'Salsa', categoryId: 'condiments_salsa_dips', locations: { s: 'b', other: 'a' } };
    expect(where(salsa, withHoldings(l, [salsa]), [salsa])).toBe('b');
  });
});

describe('sections sized from where things were found', () => {
  const wall = (categories: string[]) => layout([{ ...shelf('w', 'Back wall', 2, categories), length: 10 } as Place]);
  const found = (name: string, categoryId: string, u: number): Product => ({ id: name, name, categoryId, locations: { s: exactKey('w', { u, v: 0.5 }) } });
  const near = (a: number | undefined, b: number) => expect(a).toBeCloseTo(b, 3);

  it('each section runs where its things were found; something new of a kind goes by them', () => {
    const ps = [found('Steak', 'meat_beef', 0.1), found('Ground beef', 'meat_beef', 0.2), found('Cheddar', 'cheese_block', 0.45), found('Milk', 'dairy_milk', 0.9)];
    const w = withHoldings(wall(['meat_beef', 'cheese_block', 'dairy_milk']), ps).places[0];
    const s = w.sections!;
    expect(s.map((x) => x.categoryId)).toEqual(['meat_beef', 'cheese_block', 'dairy_milk']);
    near(s[0].from, 0); near(s[0].to, 0.3); near(s[1].to, 0.675); near(s[2].to, 1);
    near(categorySpot(w, 'meat_beef')?.u, 0.15);
    const ribeye = { id: 'r', name: 'Ribeye', categoryId: 'meat_beef' } as Product;
    const r = locateProduct(ribeye, withHoldings(wall(['meat_beef', 'cheese_block', 'dairy_milk']), [...ps, ribeye]), new Catalog([...ps, ribeye], defaultCategories));
    expect(r.kind === 'spot' && r.spot.point.y).toBe(3); // 0.15 of the way along a 10-square shelf from y 2
  });

  it('one kind it holds goes in between, where its things are', () => {
    const ps = [found('Milk', 'dairy_milk', 0.9), found('Cheddar', 'cheese_block', 0.5)];
    const w = withHoldings(wall(['meat_beef', 'dairy_milk']), ps).places[0];
    expect(w.categories).toEqual(['meat_beef', 'cheese_block', 'dairy_milk']);
  });

  it('where things were found doesn’t fit the order set by hand: equal shares, in that order', () => {
    const ps = [found('Milk', 'dairy_milk', 0.9), found('Steak', 'meat_beef', 0.1)];
    const w = withHoldings(wall(['dairy_milk', 'meat_beef']), ps).places[0];
    expect(w.sections).toBeUndefined();
    expect(w.categories).toEqual(['dairy_milk', 'meat_beef']);
  });
});
