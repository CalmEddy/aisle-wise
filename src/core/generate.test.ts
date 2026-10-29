import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { resolveClue } from './clues';
import { Floor } from './floor';
import { buildModel, generateParts, newlyEdited, regenerate } from './generate';
import { parseExactKey } from './geometry';
import { locateProduct } from './locate';
import type { Product, Shelf, StoreLayout } from './types';

const products: Product[] = [
  { id: 'apples', name: 'Apples', categoryId: 'fruit', clues: { s: { kind: 'dept', dept: 'produce' } } },
  { id: 'bread', name: 'Bread', categoryId: 'bakery', clues: { s: { kind: 'aisle', aisle: '3', side: 'L', pos: 'front' } } },
  { id: 'cereal', name: 'Cheerios', categoryId: 'breakfast', clues: { s: { kind: 'aisle', aisle: '3', side: 'L', pos: 'back' } } },
  { id: 'milk', name: 'Milk', categoryId: 'dairy', clues: { s: { kind: 'dept', dept: 'dairy' } } },
  { id: 'peas', name: 'Peas', categoryId: 'icecream', clues: { s: { kind: 'freezer' } } },
  { id: 'gum', name: 'Gum', clues: { s: { kind: 'checkout' } } },
  { id: 'granola', name: 'Granola', categoryId: 'breakfast' },
];
const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
  gen: { enabled: true, entrance: 'left', locked: [] } };

describe('map from aisle answers', () => {
  it('models the store: aisles 1 to the highest heard, guesses for gaps', () => {
    const m = buildModel(products, 's');
    expect(m.aisles.map((a) => `${a.label}${a.seen ? '' : '?'}`)).toEqual(['1?', '2?', '3']);
    expect(m.depts.sort()).toEqual(['dairy', 'frozen', 'produce']);
    expect(m.checkout).toBe(true);
    const twelve = buildModel([{ id: 'x', name: 'X', clues: { s: { kind: 'aisle', aisle: '2B' } } }], 's');
    expect(twelve.aisles.map((a) => a.label)).toEqual(['1', '2B']);
  });

  it('generates a supermarket: aisles from the entrance side, departments round the walls', () => {
    const l = regenerate(blank, buildModel(products, 's'));
    const labels = l.places.map((p) => p.label);
    expect(labels).toEqual(expect.arrayContaining(['1L', '1R', '3L', '3R', 'Produce', 'Frozen', 'Dairy', 'Checkout']));
    expect(l.aisles!.map((a) => `${a.label}${a.guess ? '?' : ''}`)).toEqual(['Aisle 1?', 'Aisle 2?', 'Aisle 3']);
    // Aisle 1 nearest the entrance (left); Produce on the entrance side, Frozen on the far side.
    const x = (id: string) => l.places.find((p) => p.id === id)!.x;
    expect(x('g-shelf-1-L')).toBeLessThan(x('g-shelf-3-L'));
    expect(x('g-dept-produce')).toBeLessThan(x('g-shelf-1-L'));
    expect(x('g-dept-frozen')).toBeGreaterThan(x('g-shelf-3-R'));
    expect(l.entrance.x).toBeLessThan(l.width / 2);
    // Categories on the shelf, back of the store (top) first.
    expect((l.places.find((p) => p.id === 'g-shelf-3-L') as Shelf).categories).toEqual(['breakfast', 'bakery']);
    // Everything reachable.
    const floor = new Floor(l);
    for (const p of l.places) expect(floor.reachable(l.entrance, { x: p.x, y: p.y })).toBe(true);
  });

  it('entrance on the right mirrors it', () => {
    const l = regenerate({ ...blank, gen: { ...blank.gen!, entrance: 'right' } }, buildModel(products, 's'));
    const x = (id: string) => l.places.find((p) => p.id === id)!.x;
    expect(x('g-shelf-1-L')).toBeGreaterThan(x('g-shelf-3-L'));
    expect(x('g-dept-produce')).toBeGreaterThan(x('g-shelf-1-R'));
    expect(l.entrance.x).toBeGreaterThan(l.width / 2);
  });

  it('answers land on the generated map, and one answer places the whole category', () => {
    const l = regenerate(blank, buildModel(products, 's'));
    const catalog = new Catalog(products, []);
    const bread = parseExactKey(resolveClue(products[1].clues!.s, l)!)!;
    expect(bread.placeId).toBe('g-shelf-3-L');
    expect(bread.spot.u).toBeGreaterThan(0.7); // front of the store = bottom of the shelf
    expect(resolveClue({ kind: 'checkout' }, l)).toBe('g-checkout');
    expect(resolveClue({ kind: 'freezer' }, l)).toMatch(/^g-dept-frozen/);
    // Granola has no answer, but Cheerios (same category) is on 3L.
    const g = locateProduct(products[6], l, catalog);
    expect(g.kind === 'spot' && g.spot.placeId).toBe('g-shelf-3-L');
  });

  it('keeps the shopper’s edits and own places when regenerating', () => {
    let l = regenerate(blank, buildModel(products, 's'));
    // The shopper renames 3L, deletes the Dairy area and adds their own shelf where aisle 4 would go.
    const edited: StoreLayout = {
      ...l,
      places: [
        ...l.places.filter((p) => p.id !== 'g-dept-dairy').map((p) => (p.id === 'g-shelf-3-L' ? { ...p, label: 'Cereal' } : p)),
        { kind: 'shelf', id: 'mine', label: 'Mine', orientation: 'vertical', x: 18, y: 6, length: 14, categories: [] },
      ],
    };
    const locked = newlyEdited(l, edited);
    expect(locked.sort()).toEqual(['g-dept-dairy', 'g-shelf-3-L']);
    l = { ...edited, gen: { ...edited.gen!, locked } };
    // A new answer: aisle 4 exists.
    const more = [...products, { id: 'chips', name: 'Chips', categoryId: 'snacks', clues: { s: { kind: 'aisle' as const, aisle: '4', side: 'R' as const } } }];
    const r = regenerate(l, buildModel(more, 's'));
    expect(r.places.find((p) => p.id === 'g-shelf-3-L')!.label).toBe('Cereal');
    expect(r.places.some((p) => p.id === 'g-dept-dairy')).toBe(false);
    expect(r.places.some((p) => p.id === 'mine')).toBe(true);
    expect(r.places.some((p) => p.id === 'g-shelf-4-L')).toBe(false); // would overlap "Mine"
    expect(r.places.some((p) => p.id === 'g-shelf-4-R')).toBe(true);
    // Moving the whole store isn't an edit.
    const moved = { ...r, places: r.places.map((p) => ({ ...p, x: p.x + 5 })) };
    expect(newlyEdited(r, moved)).toEqual([]);
  });

  it('sizes the store to fit', () => {
    const parts = generateParts(buildModel(products, 's'), 'left');
    expect(parts.width).toBe(4 * 3 + 12);
    expect(parts.places.every((p) => p.x >= 0 && p.x < parts.width)).toBe(true);
  });
});
