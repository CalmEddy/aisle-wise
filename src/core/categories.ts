import { parentOf, SEED_CATEGORIES, SEED_ITEMS } from './taxonomy';
import type { Category, Product } from './types';


/** Colour and icon for each category (subcategories share their category's). */
const looks: Record<string, [color: string, icon: string]> = {
  produce: ['#3fa34d', '🥬'],
  bakery_bread: ['#c8963e', '🍞'],
  deli: ['#e8b931', '🥪'],
  meat_seafood: ['#c0392b', '🥩'],
  dairy_eggs: ['#4f9fd8', '🥛'],
  cheese: ['#f2d06b', '🧀'],
  breakfast_cereal: ['#e9a03b', '🥣'],
  pasta_rice_grains: ['#f0b429', '🍝'],
  canned_jarred: ['#d2691e', '🥫'],
  condiments_sauces: ['#9aa63a', '🫒'],
  spices_seasonings: ['#b5651d', '🧂'],
  baking: ['#b08968', '🧁'],
  international: ['#e76f51', '🌮'],
  snacks: ['#ff8c42', '🥨'],
  beverages: ['#48cae4', '🥤'],
  beer_wine: ['#8e3b46', '🍷'],
  frozen: ['#4361ee', '🧊'],
  household_cleaning: ['#5c7cfa', '🧽'],
  paper_goods: ['#90a4ae', '🧻'],
  personal_care: ['#2ec4b6', '🧴'],
  baby: ['#ffafcc', '🍼'],
  pet: ['#a0522d', '🐾'],
};

/** Subcategories with an icon of their own (the rest use their category's); colours are the category's. */
const SUB_ICONS: Record<string, string> = {
  produce_fruits: '🍎', produce_vegetables: '🥦', produce_salad_greens: '🥬', produce_fresh_herbs: '🌿', produce_potatoes_onions: '🥔',
  bakery_bagels_muffins: '🥯', bakery_desserts: '🍰', bakery_tortillas_wraps: '🫓',
  meat_beef: '🥩', meat_poultry: '🍗', meat_pork: '🥓', meat_bacon_sausage: '🌭', meat_fish_seafood: '🐟', meat_plant_based: '🌱',
  dairy_milk: '🥛', dairy_plant_milk: '🥛', dairy_eggs_sub: '🥚', dairy_butter: '🧈', dairy_yogurt: '🥄',
  breakfast_spreads: '🍯', breakfast_pancakes_syrup: '🥞', pasta_sauce: '🍅', grains_rice: '🍚',
  canned_soup_broth: '🍲', canned_beans: '🫘', canned_pickles_olives: '🥒', condiments_oils_vinegars: '🫒',
  snacks_chips: '🍟', snacks_cookies: '🍪', snacks_candy_gum: '🍬', snacks_nuts_dried_fruit: '🥜', snacks_popcorn_pretzels: '🥨',
  beverages_water: '💧', beverages_soda: '🥤', beverages_juice: '🧃', beverages_coffee: '☕', beverages_tea: '🍵', beverages_sports_energy: '⚡',
  alcohol_beer: '🍺', alcohol_wine: '🍷', frozen_pizza_appetizers: '🍕', frozen_desserts_ice: '🍦', frozen_vegetables: '🥦', frozen_fruit: '🍓',
  household_laundry: '🧺', household_trash_storage: '🗑️', household_home_essentials: '🔋', paper_toilet_tissue: '🧻',
  personal_oral_care: '🪥', personal_health: '💊', personal_shaving: '🪒', baby_diapers_wipes: '🧷', baby_feeding: '🍼', pet_dog: '🐶', pet_cat: '🐱',
};

/** Colours for new categories, in order. */
export const PALETTE = [
  '#e4572e', '#3fa34d', '#4f9fd8', '#f0b429', '#8e7cc3', '#2ec4b6', '#e07aa8', '#ff8c42',
  '#1f7a8c', '#c0392b', '#9aa63a', '#5c7cfa', '#b08968', '#e63946', '#48cae4', '#7b4b2a',
];

/** Icons offered when choosing one for a category. */
export const ICON_CHOICES = [
  '🍎', '🍌', '🍇', '🍓', '🥑', '🥦', '🥕', '🌽', '🧅', '🥔', '🍞', '🥐', '🥖', '🧀', '🥛', '🥚',
  '🧈', '🥩', '🍗', '🥓', '🐟', '🦐', '🍝', '🍚', '🥫', '🍲', '🧂', '🫒', '🍯', '🥜', '🥨', '🍿',
  '🍪', '🍫', '🍬', '🥤', '🧃', '💧', '☕', '🍵', '🍷', '🍺', '🥣', '🧇', '🍕', '🍦', '🧊', '🌮',
  '🍜', '🌶️', '🧻', '🧺', '🧽', '🧴', '🪥', '💊', '🍼', '🐶', '🐱', '💐', '🎁', '🕯️', '🔋', '🛒',
];

/** The categories (in walking order), each followed by its subcategories. */
export const defaultCategories: Category[] = SEED_CATEGORIES.flatMap((c) => [
  { id: c.id, name: c.name, color: looks[c.id][0], icon: looks[c.id][1], order: c.order },
  ...c.subs.map(([id, name]) => ({ id, name, parent: c.id, ...(SUB_ICONS[id] && { icon: SUB_ICONS[id] }) })),
]);

/** A category's colour and icon, falling back to sensible defaults. */
export function categoryLook(cat: Category | undefined, index = 0): { color: string; icon: string } {
  const d = cat ? looks[cat.id] ?? looks[cat.parent ?? parentOf(cat.id) ?? ''] : undefined;
  return {
    color: cat?.color || d?.[0] || PALETTE[Math.abs(index) % PALETTE.length],
    icon: cat?.icon || d?.[1] || '🛒',
  };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The starter master list: the most common grocery-list items, with their subcategory, aliases and unit. */
export const defaultProducts: Product[] = SEED_ITEMS.map(([name, rank, sub, aliases, unit]) => ({
  id: `p-${slug(name)}`, name, categoryId: sub, rank, ...(aliases.length && { aliases }), unit,
}));
