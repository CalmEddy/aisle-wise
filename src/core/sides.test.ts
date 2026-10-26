import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { categoryLook, defaultCategories, defaultProducts } from './categories';
import { demoLayout } from './demoLayout';
import { aisleSides, categorySpot, sectionShapes, withSides } from './geometry';
import { locateItem } from './locate';
import { applyStoreShare, buildStoreShare } from './share';
import type { Aisle, Area } from './types';

const base: Aisle = { kind: 'aisle', id: 'a', label: 'Aisle 2', x: 10, y: 0, orientation: 'vertical', length: 20, width: 2, categories: [] };
const catalog = new Catalog(defaultProducts, defaultCategories);

describe('aisle sides', () => {
  it('keeps the full category list in step with the sides', () => {
    const a = withSides(base, [['pasta', 'baking'], ['canned', 'pasta']]);
    expect(a.categories).toEqual(['pasta', 'baking', 'canned']);
    expect(aisleSides(a)).toEqual([['pasta', 'baking'], ['canned', 'pasta']]);
  });

  it('treats older aisles (no sides) as the same on both sides', () => {
    const old = { ...base, categories: ['pasta', 'canned'] };
    expect(aisleSides(old)).toEqual([['pasta', 'canned'], ['pasta', 'canned']]);
    expect(categorySpot(old, 'canned')).toEqual({ u: 0.75, v: 0.5 });
  });

  it('puts a one-sided category on its shelf, shared equally along that side', () => {
    const a = withSides(base, [['pasta', 'baking'], ['canned']]);
    expect(categorySpot(a, 'pasta')).toEqual({ u: 0.25, v: 0 });
    expect(categorySpot(a, 'baking')).toEqual({ u: 0.75, v: 0 });
    expect(categorySpot(a, 'canned')).toEqual({ u: 0.5, v: 1 });
    expect(categorySpot(a, 'dairy')).toBeUndefined();
  });

  it('finds soup across the aisle from pasta in the demo store', () => {
    const pasta = locateItem({ name: 'spaghetti' }, demoLayout, catalog);
    const soup = locateItem({ name: 'soup' }, demoLayout, catalog);
    if (pasta.kind !== 'spot' || soup.kind !== 'spot') throw new Error('not found');
    expect(pasta.spot.placeId).toBe('a2');
    expect(soup.spot.placeId).toBe('a2');
    expect(pasta.spot.point.y).toBe(soup.spot.point.y);
    // Different lanes, next to different shelves.
    expect(soup.spot.point.x - pasta.spot.point.x).toBe(1);
    expect(soup.spot.mark.x - pasta.spot.mark.x).toBe(3);
  });

  it('draws each side’s sections on its own shelf', () => {
    const a = withSides(base, [['pasta', 'baking'], ['canned']]);
    expect(sectionShapes(a)).toEqual([
      { categoryId: 'pasta', rect: { x: 10, y: 0, w: 1, h: 10 } },
      { categoryId: 'baking', rect: { x: 10, y: 10, w: 1, h: 10 } },
      { categoryId: 'canned', rect: { x: 13, y: 0, w: 1, h: 20 } },
    ]);
    const area: Area = { kind: 'area', id: 'p', label: 'Produce', x: 0, y: 0, w: 4, h: 12, categories: ['veg', 'fruit'] };
    expect(sectionShapes(area).map((s) => s.rect)).toEqual([{ x: 0, y: 0, w: 4, h: 6 }, { x: 0, y: 6, w: 4, h: 6 }]);
  });

  it('keeps sides when a store is shared, mapping categories by name', () => {
    const share = buildStoreShare(demoLayout, catalog);
    share.categories = share.categories.map((c) => ({ ...c, id: `their-${c.id}` }));
    share.layout = {
      ...share.layout,
      places: share.layout.places.map((p) => (p.kind === 'aisle'
        ? withSides(p, [aisleSides(p)[0].map((c) => `their-${c}`), aisleSides(p)[1].map((c) => `their-${c}`)])
        : { ...p, categories: p.categories.map((c) => `their-${c}`) })),
    };
    const r = applyStoreShare(share, { items: [], products: defaultProducts, categories: defaultCategories, layouts: [] });
    const a2 = r.layouts[0].places.find((p) => p.id === 'a2') as Aisle;
    expect(a2.sides).toEqual([['pasta'], ['canned']]);
  });
});

describe('category looks', () => {
  it('gives every starter category its own colour and an icon', () => {
    const looks = defaultCategories.map((c, i) => categoryLook(c, i));
    expect(new Set(looks.map((l) => l.color)).size).toBe(defaultCategories.length);
    expect(looks.every((l) => l.icon && l.icon !== '🛒')).toBe(true);
    expect(categoryLook({ id: 'pasta', name: 'Pasta' }).icon).toBe('🍝'); // saved before icons existed
  });

  it('falls back to a palette colour and a basket for new categories', () => {
    expect(categoryLook({ id: 'c-x', name: 'International' }, 2)).toEqual({ color: '#4f9fd8', icon: '🛒' });
    expect(categoryLook({ id: 'c-x', name: 'Intl', color: '#123456', icon: '🌮' })).toEqual({ color: '#123456', icon: '🌮' });
  });
});
