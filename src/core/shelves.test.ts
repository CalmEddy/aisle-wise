import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { categoryLook, defaultCategories, defaultProducts } from './categories';
import { demoLayout } from './demoLayout';
import { Floor } from './floor';
import { categorySpot, sectionShapes } from './geometry';
import { locateItem } from './locate';
import { hasOldAisles, migrateToShelves } from './migrate';
import { applyStoreShare, type StoreShare } from './share';
import type { Area, Product, Shelf, StoreLayout } from './types';

const catalog = new Catalog(defaultProducts, defaultCategories);
const shelf: Shelf = { kind: 'shelf', id: 's', label: 'Pantry', x: 10, y: 0, orientation: 'vertical', length: 20, categories: ['pasta_dry', 'baking_flour_sugar'] };

/** How stores were saved before shelves: aisles with a shelf on each side. */
const oldStore = (): StoreLayout => ({
  id: 'old', name: 'Old', width: 30, height: 30, entrance: { x: 0, y: 29 }, checkout: { x: 20, y: 29 },
  places: [
    { kind: 'aisle', id: 'a2', label: 'Aisle 2', x: 10, y: 3, orientation: 'vertical', length: 12, width: 2,
      categories: ['pasta_dry', 'canned_soup_broth'], sides: [['pasta_dry'], ['canned_soup_broth']] },
    { kind: 'aisle', id: 'fz', label: 'Frozen', x: 15, y: 20, orientation: 'horizontal', length: 8, width: 2, categories: ['frozen_meals'] },
    { kind: 'area', id: 'prod', label: 'Produce', x: 0, y: 0, w: 5, h: 10, categories: ['produce_fruits'] },
  ] as unknown as StoreLayout['places'],
});

describe('shelves', () => {
  it('puts categories in order along the shelf', () => {
    expect(categorySpot(shelf, 'pasta_dry')).toEqual({ u: 0.25, v: 0.5 });
    expect(categorySpot(shelf, 'baking_flour_sugar')).toEqual({ u: 0.75, v: 0.5 });
    expect(categorySpot(shelf, 'dairy')).toBeUndefined();
    expect(sectionShapes(shelf)).toEqual([
      { categoryId: 'pasta_dry', rect: { x: 10, y: 0, w: 1, h: 10 } },
      { categoryId: 'baking_flour_sugar', rect: { x: 10, y: 10, w: 1, h: 10 } },
    ]);
    const area: Area = { kind: 'area', id: 'p', label: 'Produce', x: 0, y: 0, w: 4, h: 12, categories: ['produce_vegetables', 'produce_fruits'] };
    expect(sectionShapes(area).map((s) => s.rect)).toEqual([{ x: 0, y: 0, w: 4, h: 6 }, { x: 0, y: 6, w: 4, h: 6 }]);
  });

  it('has pasta facing soup across a walkway in the demo store', () => {
    const floor = new Floor(demoLayout);
    const pasta = locateItem({ name: 'spaghetti' }, demoLayout, catalog);
    const soup = locateItem({ name: 'soup' }, demoLayout, catalog);
    if (pasta.kind !== 'spot' || soup.kind !== 'spot') throw new Error('not found');
    expect([pasta.spot.placeId, soup.spot.placeId]).toEqual(['pasta', 'soup']);
    // Same height, two squares apart, reachable from the same walkway with no walking.
    expect(soup.spot.point.y).toBe(pasta.spot.point.y);
    expect(floor.distance(pasta.spot.point, soup.spot.point)).toBe(1);
  });
});

describe('converting old aisles', () => {
  it('turns each aisle into two shelves in the same squares, keeping each side’s categories', () => {
    const { layouts } = migrateToShelves([oldStore()], []);
    expect(hasOldAisles(layouts)).toBe(false);
    const byId = Object.fromEntries(layouts[0].places.map((p) => [p.id, p]));
    expect(byId['a2']).toMatchObject({ kind: 'shelf', label: 'Aisle 2 – left', x: 10, y: 3, length: 12, categories: ['pasta_dry'] });
    expect(byId['a2-2']).toMatchObject({ kind: 'shelf', label: 'Aisle 2 – right', x: 13, y: 3, categories: ['canned_soup_broth'] });
    // Horizontal aisle with no sides: same categories top and bottom.
    expect(byId['fz']).toMatchObject({ label: 'Frozen – top', x: 15, y: 20, orientation: 'horizontal', categories: ['frozen_meals'] });
    expect(byId['fz-2']).toMatchObject({ label: 'Frozen – bottom', y: 23, categories: ['frozen_meals'] });
    expect(byId['prod']).toEqual(oldStore().places[2]);
  });

  it('keeps the walkways: the floor between the new shelves is still open', () => {
    const { layouts } = migrateToShelves([oldStore()], []);
    const floor = new Floor(layouts[0]);
    expect([10, 11, 12, 13].map((x) => floor.walkable({ x, y: 8 }))).toEqual([false, true, true, false]);
  });

  it('moves saved item locations to the right shelf', () => {
    const products: Product[] = [
      { id: '1', name: 'Soup', locations: { old: 'a2:canned_soup_broth', other: 'a2:canned_soup_broth' } },
      { id: '2', name: 'Penne', locations: { old: 'a2:pasta_dry' } },
      { id: '3', name: 'Ramen', locations: { old: 'a2@0.25,1' } },
      { id: '4', name: 'Orzo', locations: { old: 'a2@0.5,0' } },
      { id: '5', name: 'Peas', locations: { old: 'fz' } },
      { id: '6', name: 'Plums', locations: { old: 'prod@0.5,0.5' } },
    ];
    const { products: out } = migrateToShelves([oldStore()], products);
    expect(out.map((p) => p.locations)).toEqual([
      { old: 'a2-2:canned_soup_broth', other: 'a2:canned_soup_broth' }, // only the converted store changes
      { old: 'a2:pasta_dry' },
      { old: 'a2-2@0.25,0.5' },
      { old: 'a2@0.5,0.5' },
      { old: 'fz' },
      { old: 'prod@0.5,0.5' },
    ]);
    expect(out[4]).toBe(products[4]); // untouched items are left as they were
  });

  it('converts aisles in store links made before shelves existed', () => {
    const share: StoreShare = {
      v: 1, kind: 'store', layout: oldStore(),
      categories: defaultCategories.filter((c) => ['pasta_dry', 'canned_soup_broth', 'frozen', 'produce_fruits'].includes(c.id)),
      items: [{ name: 'Soup', category: 'Canned Goods & Soup', at: 'a2:canned_soup_broth' }],
    };
    const r = applyStoreShare(share, { items: [], products: defaultProducts, categories: defaultCategories, layouts: [] });
    expect(hasOldAisles(r.layouts)).toBe(false);
    expect(r.products.find((p) => p.name === 'Soup')!.locations?.[r.layoutId]).toBe('a2-2:canned_soup_broth');
  });
});

describe('category looks', () => {
  it('gives every starter category its own colour and an icon; subcategories share their category’s', () => {
    const tops = defaultCategories.filter((c) => !c.parent);
    expect(tops).toHaveLength(22);
    const looks = tops.map((c, i) => categoryLook(c, i));
    expect(new Set(looks.map((l) => l.color)).size).toBe(tops.length);
    expect(defaultCategories.map((c, i) => categoryLook(c, i)).every((l) => l.icon && l.icon !== '🛒')).toBe(true);
    expect(categoryLook({ id: 'produce_fruits', name: 'Fruits', parent: 'produce' })).toEqual(categoryLook({ id: 'produce', name: 'Produce' }));
    expect(categoryLook({ id: 'pasta_dry', name: 'Pasta' }).icon).toBe('🍝'); // saved before icons existed
  });

  it('falls back to a palette colour and a basket for new categories', () => {
    expect(categoryLook({ id: 'c-x', name: 'International' }, 2)).toEqual({ color: '#4f9fd8', icon: '🛒' });
    expect(categoryLook({ id: 'c-x', name: 'Intl', color: '#123456', icon: '🌮' })).toEqual({ color: '#123456', icon: '🌮' });
  });
});
