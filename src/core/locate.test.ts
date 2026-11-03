import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { defaultCategories } from './categories';
import { locateProduct } from './locate';
import type { Category, Place, Product, StoreLayout } from './types';

const shelf = (id: string, label: string, categories: string[]): Place =>
  ({ kind: 'shelf', id, label, orientation: 'vertical', x: 2, y: 2, length: 8, categories });

const layout = (places: Place[]): StoreLayout =>
  ({ id: 's', name: 'S', width: 30, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 }, places });

function catsWithSpreadsUnderCondiments(): Category[] {
  return defaultCategories.map((c) =>
    c.id === 'breakfast_spreads' ? { ...c, parent: 'condiments_sauces' } : { ...c },
  );
}

describe('locateProduct top-level homes', () => {
  it('pins a subcategory item to the place stocking its live top category', () => {
    const categories = catsWithSpreadsUnderCondiments();
    const pb: Product = { id: 'pb', name: 'Peanut butter', categoryId: 'breakfast_spreads' };
    const places = [
      shelf('cereal', 'Cereal', ['breakfast_cereal']),
      shelf('condiments', 'Condiments', ['condiments_sauces']),
    ];
    const catalog = new Catalog([pb], categories);
    const loc = locateProduct(pb, layout(places), catalog);
    expect(loc.kind).toBe('spot');
    if (loc.kind === 'spot') {
      expect(loc.spot.placeId).toBe('condiments');
      expect(loc.exact).toBe(false);
    }
  });

  it('guesses by the live top when no matching shelf exists', () => {
    const categories = catsWithSpreadsUnderCondiments();
    const pb: Product = { id: 'pb', name: 'Peanut butter', categoryId: 'breakfast_spreads' };
    const places = [shelf('cereal', 'Cereal', ['breakfast_cereal'])];
    const catalog = new Catalog([pb], categories);
    const loc = locateProduct(pb, layout(places), catalog);
    expect(loc).toMatchObject({ kind: 'guess', categoryId: 'condiments_sauces' });
  });

  it('still finds a place that stocks only the subcategory id', () => {
    const categories = catsWithSpreadsUnderCondiments();
    const pb: Product = { id: 'pb', name: 'Peanut butter', categoryId: 'breakfast_spreads' };
    const places = [shelf('jams', 'Jams', ['breakfast_spreads'])];
    const catalog = new Catalog([pb], categories);
    const loc = locateProduct(pb, layout(places), catalog);
    expect(loc.kind).toBe('spot');
    if (loc.kind === 'spot') expect(loc.spot.placeId).toBe('jams');
  });

  it('does not follow a different subcategory under the same top', () => {
    const ketchup: Product = { id: 'k', name: 'Ketchup', categoryId: 'condiments_table', locations: { s: 'sauces' } };
    const oil: Product = { id: 'o', name: 'Olive oil', categoryId: 'condiments_oils_vinegars' };
    const places = [
      shelf('sauces', 'Sauces', ['condiments_table']),
      shelf('oils', 'Oils', ['condiments_oils_vinegars']),
    ];
    const catalog = new Catalog([ketchup, oil], defaultCategories);
    const loc = locateProduct(oil, layout(places), catalog);
    expect(loc.kind).toBe('spot');
    if (loc.kind === 'spot') expect(loc.spot.placeId).toBe('oils');
  });
});
