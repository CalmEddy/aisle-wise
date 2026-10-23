import type { Aisle, Area, StoreLayout } from './types';

const area = (id: string, label: string, x: number, y: number, w: number, h: number, categories: string[] = []): Area => ({
  kind: 'area', id, label, x, y, w, h, categories,
});

const aisle = (
  id: string, label: string, x: number, y: number,
  orientation: Aisle['orientation'], length: number, categories: string[],
): Aisle => ({ kind: 'aisle', id, label, x, y, orientation, length, width: 2, categories });

/**
 * A typical supermarket on a 60 × 40 grid: produce down the left, bakery,
 * deli and dairy along the back, meat on the right, seven center aisles
 * and two cross-wise frozen aisles.
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
    aisle('a1', 'Aisle 1', 10, 8, 'vertical', 22, ['coffee', 'breakfast']),
    aisle('a2', 'Aisle 2', 14, 8, 'vertical', 22, ['canned', 'pasta']),
    aisle('a3', 'Aisle 3', 18, 8, 'vertical', 22, ['condiments', 'baking']),
    aisle('a4', 'Aisle 4', 22, 8, 'vertical', 22, ['cookies', 'snacks']),
    aisle('a5', 'Aisle 5', 26, 8, 'vertical', 22, ['water', 'soda']),
    aisle('a6', 'Aisle 6', 30, 8, 'vertical', 22, ['laundry', 'paper']),
    aisle('a7', 'Aisle 7', 34, 8, 'vertical', 22, ['baby', 'health']),
    aisle('f1', 'Frozen A', 40, 10, 'horizontal', 9, ['frozen']),
    aisle('f2', 'Frozen B', 40, 16, 'horizontal', 9, ['icecream']),
  ],
};
