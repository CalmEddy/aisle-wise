import type { Area, Shelf, StoreLayout } from './types';

const area = (id: string, label: string, x: number, y: number, w: number, h: number, categories: string[] = []): Area => ({
  kind: 'area', id, label, x, y, w, h, categories,
});

const shelf = (
  id: string, label: string, x: number, y: number, orientation: Shelf['orientation'], length: number, categories: string[],
): Shelf => ({ kind: 'shelf', id, label, x, y, orientation, length, categories });

/** Shelves in pairs of rows: back-to-back shelves with a two-square walkway between pairs. */
const row = (id: string, label: string, x: number, categories: string[]) => shelf(id, label, x, 8, 'vertical', 22, categories);

/**
 * A typical supermarket on a 60 × 40 grid: produce down the left, bakery,
 * deli and dairy along the back, meat on the right, rows of shelves in the
 * middle and two cross-wise frozen cases. Pasta faces soup across a walkway.
 */
export const demoLayout: StoreLayout = {
  id: 'demo',
  name: 'Demo Market',
  width: 60,
  height: 40,
  entrance: { x: 10, y: 38 },
  checkout: { x: 30, y: 36 },
  places: [
    area('bakery', 'Bakery', 1, 1, 9, 4, ['bakery']),
    area('deli', 'Deli', 11, 1, 12, 4, ['deli']),
    area('dairy', 'Dairy', 24, 1, 16, 4, ['dairy', 'eggs']),
    area('meat', 'Meat & Seafood', 51, 1, 8, 24, ['seafood', 'meat']),
    area('produce', 'Produce', 1, 6, 8, 24, ['veg', 'fruit']),
    area('floral', 'Floral', 1, 33, 7, 5, ['floral']),
    area('pharmacy', 'Pharmacy', 50, 30, 9, 8, ['pharmacy']),
    row('coffee', 'Coffee & Tea', 10, ['coffee']),
    row('cereal', 'Cereal', 13, ['breakfast']),
    row('pasta', 'Pasta & Rice', 14, ['pasta']),
    row('soup', 'Soup & Cans', 17, ['canned']),
    row('baking', 'Baking', 18, ['baking']),
    row('oils', 'Oils & Sauces', 21, ['condiments']),
    row('snacks', 'Snacks', 22, ['snacks']),
    row('cookies', 'Cookies', 25, ['cookies']),
    row('soda', 'Soda', 26, ['soda']),
    row('juice', 'Water & Juice', 29, ['water']),
    row('paper', 'Paper', 30, ['paper']),
    row('laundry', 'Laundry & Pets', 33, ['laundry']),
    row('health', 'Health', 34, ['health']),
    row('baby', 'Baby', 37, ['baby']),
    shelf('frozen1', 'Frozen meals', 40, 10, 'horizontal', 9, ['frozen']),
    shelf('frozen2', 'Pizza', 40, 13, 'horizontal', 9, ['frozen']),
    shelf('icecream1', 'Ice cream', 40, 16, 'horizontal', 9, ['icecream']),
    shelf('icecream2', 'Frozen veg', 40, 19, 'horizontal', 9, ['icecream']),
  ],
};
