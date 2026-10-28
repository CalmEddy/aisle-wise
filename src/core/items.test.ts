import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { itemMatches, quickAddItems } from './items';
import type { Category, Product, StoreLayout } from './types';

const cats: Category[] = [{ id: 'dairy', name: 'Dairy' }, { id: 'bakery', name: 'Bakery' }];
const products: Product[] = [
  { id: 'milk', name: 'Milk', categoryId: 'dairy' },
  { id: 'bread', name: 'Bread', categoryId: 'bakery', notAt: ['s'] },
  { id: 'odd', name: 'Mystery' },
];
const catalog = new Catalog(products, cats);
const layout = { id: 's', name: 'S', width: 10, height: 10, entrance: { x: 0, y: 0 }, checkout: { x: 1, y: 0 },
  places: [{ kind: 'area', id: 'a', label: 'Dairy', x: 2, y: 2, w: 3, h: 3, categories: ['dairy'] }] } as StoreLayout;

describe('quick add on the Items tab', () => {
  it('adds new names, finds existing ones, guesses categories', () => {
    const r = quickAddItems(' oat milk , kombucha,MILK, Kombucha ,', catalog);
    expect(r.existing.map((p) => p.id)).toEqual(['milk']);
    expect(r.created.map((p) => [p.name, p.categoryId])).toEqual([['Oat milk', 'dairy'], ['Kombucha', undefined]]);
  });

  it('filters', () => {
    const ids = (f: Parameters<typeof itemMatches>[1], onList = new Set<string>()) =>
      products.filter((p) => itemMatches(p, f, layout, catalog, onList)).map((p) => p.id);
    expect(ids('all')).toEqual(['milk', 'bread', 'odd']);
    expect(ids('place')).toEqual(['odd']); // bread isn't sold here; milk is in Dairy
    expect(ids('nocat')).toEqual(['odd']);
    expect(ids('notsold')).toEqual(['bread']);
    expect(ids('list', new Set(['bread']))).toEqual(['bread']);
  });
});
