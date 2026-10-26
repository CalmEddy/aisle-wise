import { describe, expect, it } from 'vitest';
import { blankStore, moveHere, pickUp } from './build';
import { Catalog } from './catalog';
import { defaultCategories, defaultProducts } from './categories';
import { resolveSpot } from './locate';
import type { ListItem, Point, Product, StoreLayout } from './types';

/**
 * A build-mode shopping trip in a blank store: after every pick-up, every
 * item picked so far must resolve to the square where it was picked up
 * (on a shelf: the shelf square level with you).
 */
describe('build mode pick-ups land where they were picked up', () => {
  type State = { items: ListItem[]; products: Product[]; layout: StoreLayout };
  let s: State = {
    items: ['Garlic Olives', 'Pickle Spears', 'Spaghetti', 'Penne', 'Kiwi', 'Bananas', 'Strawberries', 'Milk']
      .map((name, i) => ({ id: `i${i}`, name, done: false })),
    products: defaultProducts,
    layout: { ...blankStore('Trip'), id: 'trip', width: 30, height: 24 },
  };
  /** Where each picked item should be: name → square. */
  const expected = new Map<string, Point>();

  const pick = (name: string, at: Point, target: 'shelf' | 'area' = 'shelf', shouldBe: Point = at) => {
    const item = s.items.find((i) => i.name === name && !i.done);
    const r = pickUp({ ...s, catalog: new Catalog(s.products, defaultCategories) }, name, item?.id, at, target);
    s = { items: r.items, products: r.products, layout: r.layout };
    expected.set(name, shouldBe);
    return r.outcome;
  };
  const spotOf = (name: string) => {
    const catalog = new Catalog(s.products, defaultCategories);
    const product = s.products.find((p) => p.id === s.items.find((i) => i.name === name)!.productId)!;
    return resolveSpot(product.locations![s.layout.id], s.layout, catalog)!;
  };
  const allWhereTheyShouldBe = () => {
    for (const [name, at] of expected) expect([name, spotOf(name).point]).toEqual([name, at]);
  };

  it('creates a shelf for a brand-new item, keeping its own name', () => {
    const o = pick('Garlic Olives', { x: 10, y: 12 });
    expect(o).toMatchObject({ kind: 'built', action: 'create', itemName: 'Garlic Olives' });
    // Got its own master-list entry (not "Olives" or "Garlic"), with the closest match's category.
    const p = s.products.find((x) => x.name === 'Garlic Olives')!;
    expect(p.categoryId).toBe('veg');
    expect(s.products.find((x) => x.name === 'Olives')!.locations).toBeUndefined();
    allWhereTheyShouldBe();
  });

  it('adds items picked beside it, at their own height', () => {
    expect(pick('Pickle Spears', { x: 11, y: 11 }, 'shelf', { x: 10, y: 11 })).toMatchObject({ action: 'onShelf' });
    allWhereTheyShouldBe();
  });

  it('extends the shelf down and up without moving earlier items', () => {
    expect(pick('Spaghetti', { x: 10, y: 16 })).toMatchObject({ action: 'extend' });
    allWhereTheyShouldBe();
    expect(pick('Penne', { x: 9, y: 8 }, 'shelf', { x: 10, y: 8 })).toMatchObject({ action: 'extend' });
    allWhereTheyShouldBe();
  });

  it('creates and stretches an area without moving earlier items', () => {
    expect(pick('Kiwi', { x: 16, y: 12 }, 'area')).toMatchObject({ action: 'createArea' });
    allWhereTheyShouldBe();
    expect(pick('Bananas', { x: 20, y: 12 }, 'area')).toMatchObject({ action: 'extendArea' });
    allWhereTheyShouldBe();
    expect(pick('Strawberries', { x: 15, y: 13 }, 'area')).toMatchObject({ action: 'inArea' });
    allWhereTheyShouldBe();
  });

  it('moves an item picked again elsewhere in the same place to the new spot', () => {
    expect(pick('Garlic Olives', { x: 11, y: 15 }, 'shelf', { x: 10, y: 15 })).toMatchObject({ action: 'onShelf' });
    allWhereTheyShouldBe();
  });

  it('asks before moving an item saved in a different place, then moves it on request', () => {
    const before = spotOf('Kiwi').point;
    const o = pick('Kiwi', { x: 11, y: 9 }, 'shelf', before);
    expect(o.kind).toBe('conflict');
    allWhereTheyShouldBe();
    const catalog = new Catalog(s.products, defaultCategories);
    const r = moveHere({ ...s, catalog }, o.productId, { x: 11, y: 9 })!;
    s = { ...s, layout: r.layout, products: r.products };
    expected.set('Kiwi', { x: 10, y: 9 });
    allWhereTheyShouldBe();
  });

  it('ticks every picked item off the list', () => {
    pick('Milk', { x: 4, y: 4 });
    expect(s.items.every((i) => i.done && i.productId)).toBe(true);
    allWhereTheyShouldBe();
  });

  it('asks which shelf to extend when one is lined up further away, then places it there', () => {
    s.items = [...s.items, { id: 'far', name: 'Fusilli', done: false }];
    // Lined up below the long shelf (x=10, ends at y=16), 5 squares past its end.
    const o = pick('Fusilli', { x: 10, y: 21 }, 'shelf', { x: 10, y: 21 });
    expect(o.kind).toBe('choose');
    if (o.kind !== 'choose') return;
    expect(o.options.map((c) => c.direction)).toContain('down');
    // Nothing built yet, item already in the cart.
    expect(s.items.find((i) => i.name === 'Fusilli')!.done).toBe(true);
    const shelfId = o.options.find((c) => c.direction === 'down')!.shelfId;
    const r = moveHere({ ...s, catalog: new Catalog(s.products, defaultCategories) }, o.productId, o.at, { extend: shelfId })!;
    s = { ...s, layout: r.layout, products: r.products };
    allWhereTheyShouldBe();
  });
});

