import { normalize } from './catalog';
import { defaultCategories, defaultProducts } from './categories';
import type { Category, Product, StoreLayout } from './types';

/**
 * Moving saved data from the app's first 26 categories ("fruit", "veg",
 * "canned"…) to the grocery taxonomy (22 store-section categories with
 * subcategories). Items get the subcategory of the starter item they are
 * ("Black beans" → Canned & Dried Beans) or, for items of the shopper's own,
 * the category their old one became. Shelves and areas keep stocking the same
 * things. Categories the shopper made are kept as they are.
 *
 * It runs when the old category list is there (on this phone, or arriving
 * from a household member's phone that hasn't updated), so running it again
 * changes nothing.
 */

/** Old category → where its things went (a subcategory where they all went to one, else a category). */
export const OLD_TO_NEW: Record<string, string> = {
  fruit: 'produce_fruits', veg: 'produce_vegetables', bakery: 'bakery_bread', deli: 'deli',
  dairy: 'dairy_eggs', eggs: 'dairy_eggs', meat: 'meat_seafood', seafood: 'meat_fish_seafood',
  floral: 'household_home_essentials', pharmacy: 'personal_health', breakfast: 'breakfast_cereal',
  coffee: 'beverages_coffee', pasta: 'pasta_rice_grains', canned: 'canned_jarred', baking: 'baking',
  condiments: 'condiments_sauces', snacks: 'snacks', cookies: 'snacks_cookies', soda: 'beverages_soda',
  water: 'beverages', paper: 'paper_goods', laundry: 'household_laundry', health: 'personal_care',
  baby: 'baby', frozen: 'frozen', icecream: 'frozen',
};

/** The first categories' names (in lists and stores shared from a phone that hasn't updated) → their ids. */
export const OLD_NAMES: Record<string, string> = {
  'fruit': 'fruit', 'vegetables': 'veg', 'bakery': 'bakery', 'deli & cheese': 'deli', 'dairy': 'dairy', 'eggs & butter': 'eggs',
  'meat': 'meat', 'seafood': 'seafood', 'floral & cards': 'floral', 'pharmacy': 'pharmacy', 'cereal & breakfast': 'breakfast',
  'coffee & tea': 'coffee', 'pasta & rice': 'pasta', 'canned goods & soup': 'canned', 'baking & spices': 'baking',
  'oils & condiments': 'condiments', 'snacks & chips': 'snacks', 'cookies & crackers': 'cookies', 'soda & sports drinks': 'soda',
  'water & juice': 'water', 'paper & cleaning': 'paper', 'laundry & pets': 'laundry', 'health & beauty': 'health', 'baby': 'baby',
  'frozen meals & pizza': 'frozen', 'ice cream & frozen veg': 'icecream',
};

/** Old ids no new category has (some, like "deli" and "frozen", are both). */
const OLD_ONLY = Object.keys(OLD_TO_NEW).filter((id) => !defaultCategories.some((c) => c.id === id));

/** Whether this data still has the old categories. */
export function hasOldCategories(categories: readonly Category[]): boolean {
  return categories.some((c) => OLD_ONLY.includes(c.id));
}

/** The starter items by name and other names (normalized). */
const SEED_BY_NAME = (() => {
  const m = new Map<string, Product>();
  for (const p of defaultProducts) {
    for (const n of [p.name, ...(p.aliases ?? [])]) {
      const k = normalize(n);
      if (k && !m.has(k)) m.set(k, p);
    }
  }
  return m;
})();

/** The starter item a name is (by its name or another name it goes by). */
export const seedItemNamed = (name: string): Product | undefined => SEED_BY_NAME.get(normalize(name));

/** An old category id as the new one (others as they are). */
export const newCategoryId = (id: string): string => OLD_TO_NEW[id] ?? id;

export function migrateCategories(data: { products: Product[]; categories: Category[]; layouts: StoreLayout[] }): {
  products: Product[]; categories: Category[]; layouts: StoreLayout[];
} {
  const old = new Set(Object.keys(OLD_TO_NEW));
  // Items: the starter item they are (its subcategory, other names, rank, unit), else their category moved.
  const seen = new Set<string>();
  const products = data.products.map((p) => {
    const seed = seedItemNamed(p.name);
    if (seed) seen.add(seed.id);
    const categoryId = p.categoryId && old.has(p.categoryId) ? (seed?.categoryId ?? newCategoryId(p.categoryId)) : p.categoryId;
    return {
      ...p,
      ...(categoryId !== undefined && { categoryId }),
      ...(seed && {
        ...(!p.aliases && seed.aliases && { aliases: seed.aliases }),
        ...(p.rank === undefined && { rank: seed.rank }),
        ...(!p.unit && seed.unit && { unit: seed.unit }),
      }),
    };
  });
  // The starter items this list didn't have yet.
  const names = new Set(products.flatMap((p) => [p.name, ...(p.aliases ?? [])].map(normalize)));
  const ids = new Set(products.map((p) => p.id));
  const added = defaultProducts.filter((s) => !seen.has(s.id) && !ids.has(s.id) && ![s.name, ...(s.aliases ?? [])].some((n) => names.has(normalize(n))));
  // Categories: the new list, then the shopper's own.
  const mine = data.categories.filter((c) => !old.has(c.id) && !defaultCategories.some((d) => d.id === c.id));
  // Shelves and areas: the same things, by their new ids.
  const layouts = data.layouts.map((l) => ({
    ...l,
    places: l.places.map((pl) => (pl.categories.some((c) => old.has(c))
      ? { ...pl, categories: [...new Set(pl.categories.map(newCategoryId))] }
      : pl)),
  }));
  return { products: [...products, ...added], categories: [...defaultCategories, ...mine], layouts };
}
