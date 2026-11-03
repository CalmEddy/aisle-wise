import { describe, expect, it } from 'vitest';
import { Catalog } from '../core/catalog';
import { defaultCategories } from '../core/categories';
import { locateProduct } from '../core/locate';
import type { Category, Place, Product, StoreLayout } from '../core/types';
import { autoWhereText, noShelfText, whereText } from './whereText';

const shelf = (id: string, label: string, categories: string[]): Place =>
  ({ kind: 'shelf', id, label, orientation: 'vertical', x: 2, y: 2, length: 8, categories });
const layout = (places: Place[]): StoreLayout =>
  ({ id: 's', name: 'S', width: 30, height: 16, entrance: { x: 1, y: 15 }, checkout: { x: 5, y: 15 }, places });

describe('where text for missing top shelves', () => {
  it('names the missing top-level category efficiently', () => {
    const categories: Category[] = defaultCategories.map((c) =>
      c.id === 'breakfast_spreads' ? { ...c, parent: 'condiments_sauces' } : { ...c },
    );
    const pb: Product = { id: 'pb', name: 'Peanut butter', categoryId: 'breakfast_spreads' };
    const catalog = new Catalog([pb], categories);
    const loc = locateProduct(pb, layout([shelf('cereal', 'Cereal', ['breakfast_cereal'])]), catalog);
    expect(loc.kind).toBe('guess');
    expect(noShelfText('condiments_sauces', catalog)).toMatch(/Condiments/);
    expect(autoWhereText(loc, catalog)).toMatch(/No Condiments.*shelf on the map/);
    expect(whereText(pb, layout([shelf('cereal', 'Cereal', ['breakfast_cereal'])]), catalog)).toMatch(/No Condiments/);
  });
});
