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
    area('bakery', 'Bakery', 1, 1, 9, 4, ['bakery_bread']),
    area('deli', 'Deli', 11, 1, 12, 4, ['deli']),
    area('dairy', 'Dairy', 24, 1, 16, 4, ['dairy_eggs', 'cheese']),
    area('meat', 'Meat & Seafood', 51, 1, 8, 24, ['meat_fish_seafood', 'meat_seafood']),
    area('produce', 'Produce', 1, 6, 8, 24, ['produce']),
    area('floral', 'Floral', 1, 33, 7, 5, ['household_home_essentials']),
    area('pharmacy', 'Pharmacy', 50, 30, 9, 8, ['personal_health']),
    row('coffee', 'Coffee & Tea', 10, ['beverages_coffee', 'beverages_tea']),
    row('cereal', 'Cereal', 13, ['breakfast_cereal']),
    row('pasta', 'Pasta & Rice', 14, ['pasta_rice_grains']),
    row('soup', 'Soup & Cans', 17, ['canned_jarred']),
    row('baking', 'Baking', 18, ['baking', 'spices_seasonings']),
    row('oils', 'Oils & Sauces', 21, ['condiments_sauces', 'international']),
    row('snacks', 'Snacks', 22, ['snacks_chips', 'snacks_popcorn_pretzels', 'snacks_nuts_dried_fruit', 'snacks_candy_gum']),
    row('cookies', 'Cookies', 25, ['snacks_cookies', 'snacks_crackers']),
    row('soda', 'Soda', 26, ['beverages_soda', 'beverages_sports_energy']),
    row('juice', 'Water & Juice', 29, ['beverages_water', 'beverages_juice']),
    row('paper', 'Paper', 30, ['paper_goods', 'household_trash_storage']),
    row('laundry', 'Laundry & Pets', 33, ['household_laundry', 'household_cleaners', 'household_dish', 'pet']),
    row('health', 'Health', 34, ['personal_care']),
    row('baby', 'Baby', 37, ['baby']),
    shelf('frozen1', 'Frozen meals', 40, 10, 'horizontal', 9, ['frozen_meals', 'frozen_breakfast']),
    shelf('frozen2', 'Pizza', 40, 13, 'horizontal', 9, ['frozen_pizza_appetizers', 'frozen_potatoes_sides']),
    shelf('icecream1', 'Ice cream', 40, 16, 'horizontal', 9, ['frozen_desserts_ice']),
    shelf('icecream2', 'Frozen veg', 40, 19, 'horizontal', 9, ['frozen_vegetables', 'frozen_fruit', 'frozen_meat_seafood']),
  ],
};
