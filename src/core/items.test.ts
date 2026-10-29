import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { itemMatches, quickAddItems, swipeDirection, swipeRelease } from './items';
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

describe('swipes', () => {
  it('tells swipes from scrolling', () => {
    expect(swipeDirection(4, 3)).toBe('undecided');
    expect(swipeDirection(20, 4)).toBe('swipe');
    expect(swipeDirection(-20, 6)).toBe('swipe');
    expect(swipeDirection(8, 30)).toBe('scroll');
    expect(swipeDirection(15, 15)).toBe('scroll');
  });
  it('decides what letting go does', () => {
    expect(swipeRelease(90)).toBe('right');
    expect(swipeRelease(30)).toBe('none');
    expect(swipeRelease(-20)).toBe('none');
    expect(swipeRelease(-50)).toBe('reveal');
  });
});

describe('amounts and notes', () => {
  it('reads counts, units and notes off typed names', async () => {
    const { parseAmount, withAmount } = await import('./items');
    expect(parseAmount('2 milk')).toEqual({ name: 'milk', qty: 2 });
    expect(parseAmount('milk x3')).toEqual({ name: 'milk', qty: 3 });
    expect(parseAmount('2x Milk')).toEqual({ name: 'Milk', qty: 2 });
    expect(parseAmount('Eggs ×12')).toEqual({ name: 'Eggs', qty: 12 });
    expect(parseAmount('2 lb ground beef')).toEqual({ name: 'ground beef', note: '2 lb' });
    expect(parseAmount('1 bag of flour')).toEqual({ name: 'flour', note: '1 bag' });
    expect(parseAmount('bread (wholemeal)')).toEqual({ name: 'bread', note: 'wholemeal' });
    expect(parseAmount('3 yogurt (vanilla)')).toEqual({ name: 'yogurt', qty: 3, note: 'vanilla' });
    // Names that only look like amounts.
    expect(parseAmount('2% milk')).toEqual({ name: '2% milk' });
    expect(parseAmount('1 milk')).toEqual({ name: 'milk' });
    expect(parseAmount('7up')).toEqual({ name: '7up' });
    expect(parseAmount('V8')).toEqual({ name: 'V8' });
    expect(withAmount('Milk', { qty: 2, note: 'skim' })).toBe('2 Milk (skim)');
    expect(parseAmount(withAmount('Ground beef', { note: '2 lb' }))).toEqual({ name: 'Ground beef', note: '2 lb' });
  });
});
