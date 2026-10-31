import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { defaultCategories, defaultProducts } from './categories';
import { guessDept } from './clues';
import { hasOldCategories, migrateCategories } from './recategorize';
import { orderOf, parentOf, SEED_CATEGORIES, stocking, stocks, topOf } from './taxonomy';
import type { Category, Product, StoreLayout } from './types';

describe('the grocery taxonomy', () => {
  it('has 22 categories in walking order, with their subcategories', () => {
    expect(SEED_CATEGORIES).toHaveLength(22);
    expect(SEED_CATEGORIES[0].id).toBe('produce');
    expect(SEED_CATEGORIES.flatMap((c) => c.subs)).toHaveLength(105);
    expect(parentOf('produce_fruits')).toBe('produce');
    expect(topOf('produce')).toBe('produce');
    expect(orderOf('produce_fruits')).toBeLessThan(orderOf('pet_cat'));
    expect(defaultCategories).toHaveLength(127);
  });

  it('every starter item, by its name or any other name, finds itself', () => {
    const catalog = new Catalog(defaultProducts, defaultCategories);
    for (const p of defaultProducts) {
      for (const n of [p.name, ...(p.aliases ?? [])]) expect(catalog.match(n)?.id, n).toBe(p.id);
      expect(parentOf(p.categoryId!), p.name).toBeDefined();
    }
  });

  it('a place stocking a category stocks its subcategories; exact ones come first', () => {
    expect(stocks(['canned_jarred'], 'canned_soup_broth')).toBe(true);
    expect(stocks(['canned_beans'], 'canned_soup_broth')).toBe(false);
    const meat = { id: 'meat', categories: ['meat_seafood'] };
    const fish = { id: 'fish', categories: ['meat_fish_seafood'] };
    expect(stocking([meat, fish], 'meat_fish_seafood').map((p) => p.id)).toEqual(['fish', 'meat']); // exact first
    expect(stocking([meat, fish], 'meat_beef').map((p) => p.id)).toEqual(['meat']);
  });

  it('departments: Fish & Seafood is Seafood, the rest of Meat & Seafood is Meat; cheese is Dairy', () => {
    expect(guessDept('meat_fish_seafood')).toBe('seafood');
    expect(guessDept('meat_beef')).toBe('meat');
    expect(guessDept('cheese_sliced')).toBe('dairy');
    expect(guessDept('personal_health')).toBe('pharmacy');
    expect(guessDept('snacks_chips')).toBeUndefined();
  });
});

describe('moving from the first categories', () => {
  const old: Category[] = [{ id: 'fruit', name: 'Fruit' }, { id: 'canned', name: 'Canned Goods & Soup' }, { id: 'c-mine', name: 'Camping' }];
  const products: Product[] = [
    { id: 'p-apples', name: 'Apples', categoryId: 'fruit', locations: { s: 'sh1:fruit' } },
    { id: 'p-black-beans', name: 'Black beans', categoryId: 'canned' },
    { id: 'p-x', name: 'Grandma’s chutney', categoryId: 'canned' },
    { id: 'p-tent', name: 'Tent pegs', categoryId: 'c-mine' },
  ];
  const layouts = [{ id: 's', name: 'S', width: 10, height: 10, entrance: { x: 0, y: 9 }, checkout: { x: 1, y: 9 },
    places: [{ kind: 'shelf', id: 'sh1', label: 'Fruit', orientation: 'vertical', x: 2, y: 2, length: 4, categories: ['fruit', 'canned', 'c-mine'] }] }] as StoreLayout[];

  it('gives items their starter item’s subcategory, or their old category’s new one; keeps the shopper’s own', () => {
    expect(hasOldCategories(old)).toBe(true);
    const r = migrateCategories({ products, categories: old, layouts });
    const cat = (id: string) => r.products.find((p) => p.id === id)!.categoryId;
    expect(cat('p-apples')).toBe('produce_fruits');
    expect(cat('p-black-beans')).toBe('canned_beans');
    expect(cat('p-x')).toBe('canned_jarred');
    expect(cat('p-tent')).toBe('c-mine');
    // Places and saved spots are untouched; shelves stock the same things by their new ids.
    expect(r.products.find((p) => p.id === 'p-apples')!.locations).toEqual({ s: 'sh1:fruit' });
    expect(r.layouts[0].places[0].categories).toEqual(['produce_fruits', 'canned_jarred', 'c-mine']);
    // The new categories, then the shopper's own; the starter items they didn't have.
    expect(r.categories.map((c) => c.id)).toEqual([...defaultCategories.map((c) => c.id), 'c-mine']);
    expect(r.products.some((p) => p.name === 'Kombucha')).toBe(true);
    expect(r.products.filter((p) => p.name === 'Apples')).toHaveLength(1);
    // Once moved, nothing more happens.
    expect(hasOldCategories(r.categories)).toBe(false);
  });
});
