import { describe, expect, it } from 'vitest';
import { addCategory, productCategoryIds, removeCategory, withCategories } from './productCategories';
import type { Product } from './types';

const base: Product = { id: 'p1', name: 'Peanut butter', categoryId: 'breakfast_spreads' };

describe('product categories', () => {
  it('lists primary then extras without duplicates', () => {
    expect(productCategoryIds(base)).toEqual(['breakfast_spreads']);
    expect(productCategoryIds({
      ...base,
      extraCategoryIds: ['condiments', 'breakfast_spreads', 'snacks_nuts_dried_fruit'],
    })).toEqual(['breakfast_spreads', 'condiments', 'snacks_nuts_dried_fruit']);
  });

  it('sets, adds and removes categories, promoting the next primary', () => {
    const two = withCategories(base, ['breakfast_spreads', 'condiments']);
    expect(two).toMatchObject({ categoryId: 'breakfast_spreads', extraCategoryIds: ['condiments'] });
    expect(addCategory(two, 'condiments')).toEqual(two);
    const three = addCategory(two, 'snacks_nuts_dried_fruit');
    expect(productCategoryIds(three)).toEqual(['breakfast_spreads', 'condiments', 'snacks_nuts_dried_fruit']);
    const after = removeCategory(three, 'breakfast_spreads');
    expect(after.categoryId).toBe('condiments');
    expect(after.extraCategoryIds).toEqual(['snacks_nuts_dried_fruit']);
    expect(withCategories(base, [])).toEqual({ id: 'p1', name: 'Peanut butter' });
  });
});
