import { BRANDS } from '../data/brands';
import { type Catalog, normalize } from './catalog';
import { topOf } from './taxonomy';

/**
 * Guessing the category of something typed on a list that isn't a known item
 * ("Cheerios", "Tide pods", "Trader Joe's frozen dumplings"). In order:
 *
 * 1. the item itself, by name or another name it goes by;
 * 2. a known item inside it, two words or more ("Barilla pasta sauce", "Dawn dish soap");
 * 3. a brand ("Doritos cool ranch" is chips, not salad dressing);
 * 4. what it ends with ("chicken soup" is soup, "… detergent");
 * 5. a one-word known item anywhere in it ("organic kale salad").
 *
 * "Frozen", "canned" and "dried" then move it to that kind ("frozen
 * blueberries" → Frozen Fruit). Nothing here leaves it without a category.
 */

export interface Guess {
  categoryId: string;
  /** How it was worked out (the first two are sure; the rest worth a glance). */
  how: 'item' | 'contains' | 'brand' | 'word';
}

/** Lowercase words, accents, apostrophes and possessives gone ("Nature's Own" → "nature own"), & as "and", digits kept, simple plurals singular. */
function words(text: string): string[] {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]s\b/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Brands by their words, longest first (so "kraft singles" beats "kraft"). */
const BRAND_KEYS = Object.entries(BRANDS)
  .map(([name, sub]) => ({ key: words(name).join(' '), sub }))
  .sort((a, b) => b.key.split(' ').length - a.key.split(' ').length || b.key.length - a.key.length);

function brandIn(text: string): string | undefined {
  const padded = ` ${words(text).join(' ')} `;
  return BRAND_KEYS.find((b) => b.key && padded.includes(` ${b.key} `))?.sub;
}

/** What a thing's name ending says it is: the last word (or two). */
const ENDINGS: [ending: string, sub: string][] = [
  ['chip', 'snacks_chips'], ['crisp', 'snacks_chips'], ['puff', 'snacks_chips'], ['cracker', 'snacks_crackers'], ['cookie', 'snacks_cookies'],
  ['candy', 'snacks_candy_gum'], ['gum', 'snacks_candy_gum'], ['chocolate', 'snacks_candy_gum'], ['bar', 'breakfast_bars'], ['jerky', 'snacks_popcorn_pretzels'],
  ['pretzel', 'snacks_popcorn_pretzels'], ['popcorn', 'snacks_popcorn_pretzels'], ['nut', 'snacks_nuts_dried_fruit'], ['seed', 'snacks_nuts_dried_fruit'],
  ['cereal', 'breakfast_cereal_sub'], ['granola', 'breakfast_cereal_sub'], ['oat', 'breakfast_hot_cereal'], ['syrup', 'breakfast_pancakes_syrup'],
  ['jam', 'breakfast_spreads'], ['jelly', 'breakfast_spreads'], ['butter', 'dairy_butter'], ['spread', 'breakfast_spreads'],
  ['soda', 'beverages_soda'], ['pop', 'beverages_soda'], ['cola', 'beverages_soda'], ['water', 'beverages_water'], ['seltzer', 'beverages_water'],
  ['juice', 'beverages_juice'], ['lemonade', 'beverages_juice'], ['coffee', 'beverages_coffee'], ['espresso', 'beverages_coffee'], ['latte', 'beverages_coffee'],
  ['tea', 'beverages_tea'], ['kombucha', 'beverages_tea'], ['drink', 'beverages_sports_energy'], ['shake', 'beverages_sports_energy'],
  ['beer', 'alcohol_beer'], ['ale', 'alcohol_beer'], ['ipa', 'alcohol_beer'], ['lager', 'alcohol_beer'], ['cider', 'alcohol_beer'], ['wine', 'alcohol_wine'],
  ['milk', 'dairy_milk'], ['yogurt', 'dairy_yogurt'], ['creamer', 'dairy_cream'], ['cheese', 'cheese_block'], ['egg', 'dairy_eggs_sub'],
  ['bread', 'bakery_sandwich_bread'], ['bun', 'bakery_buns_rolls'], ['roll', 'bakery_buns_rolls'], ['bagel', 'bakery_bagels_muffins'],
  ['muffin', 'bakery_bagels_muffins'], ['tortilla', 'bakery_tortillas_wraps'], ['wrap', 'bakery_tortillas_wraps'], ['cake', 'bakery_desserts'], ['pie', 'bakery_desserts'],
  ['pasta', 'pasta_dry'], ['noodle', 'pasta_dry'], ['rice', 'grains_rice'], ['sauce', 'condiments_hot_bbq'], ['dressing', 'condiments_dressings'],
  ['vinaigrette', 'condiments_dressings'], ['oil', 'condiments_oils_vinegars'], ['vinegar', 'condiments_oils_vinegars'], ['salsa', 'condiments_salsa_dips'],
  ['dip', 'deli_dips_spreads'], ['hummus', 'deli_dips_spreads'], ['soup', 'canned_soup_broth'], ['broth', 'canned_soup_broth'], ['stock', 'canned_soup_broth'],
  ['bean', 'canned_beans'], ['pickle', 'canned_pickles_olives'], ['olive', 'canned_pickles_olives'], ['seasoning', 'spices_blends_mixes'],
  ['spice', 'spices_herbs_spices'], ['powder', 'spices_herbs_spices'], ['mix', 'baking_mixes'], ['flour', 'baking_flour_sugar'], ['sugar', 'baking_flour_sugar'],
  ['extract', 'baking_essentials'], ['frosting', 'baking_mixes'], ['sausage', 'meat_bacon_sausage'], ['bacon', 'meat_bacon_sausage'], ['hot dog', 'meat_bacon_sausage'],
  ['chicken', 'meat_poultry'], ['turkey', 'meat_poultry'], ['beef', 'meat_beef'], ['steak', 'meat_beef'], ['pork', 'meat_pork'], ['fish', 'meat_fish_seafood'],
  ['shrimp', 'meat_fish_seafood'], ['salmon', 'meat_fish_seafood'], ['pizza', 'frozen_pizza_appetizers'], ['ice cream', 'frozen_desserts_ice'],
  ['gelato', 'frozen_desserts_ice'], ['lasagna', 'frozen_meals'], ['burrito', 'frozen_meals'], ['nugget', 'frozen_pizza_appetizers'],
  ['dumpling', 'frozen_meals'], ['potsticker', 'frozen_meals'], ['enchilada', 'frozen_meals'], ['meal', 'frozen_meals'], ['sorbet', 'frozen_desserts_ice'], ['popsicle', 'frozen_desserts_ice'], ['dinner', 'frozen_meals'], ['entree', 'frozen_meals'],
  ['detergent', 'household_laundry'], ['softener', 'household_laundry'], ['dryer sheet', 'household_laundry'], ['pod', 'household_laundry'],
  ['dish soap', 'household_dish'], ['dishwasher', 'household_dish'], ['sponge', 'household_dish'], ['cleaner', 'household_cleaners'], ['wipe', 'household_cleaners'],
  ['spray', 'household_cleaners'], ['bleach', 'household_laundry'], ['bag', 'household_trash_storage'], ['foil', 'household_trash_storage'], ['wrap film', 'household_trash_storage'],
  ['battery', 'household_home_essentials'], ['bulb', 'household_home_essentials'], ['candle', 'household_home_essentials'], ['card', 'household_home_essentials'],
  ['flower', 'household_home_essentials'], ['towel', 'paper_towels_napkins'], ['napkin', 'paper_towels_napkins'], ['tissue', 'paper_toilet_tissue'],
  ['toilet paper', 'paper_toilet_tissue'], ['plate', 'paper_tableware'], ['cup', 'paper_tableware'], ['toothpaste', 'personal_oral_care'],
  ['toothbrush', 'personal_oral_care'], ['floss', 'personal_oral_care'], ['mouthwash', 'personal_oral_care'], ['shampoo', 'personal_hair_care'],
  ['conditioner', 'personal_hair_care'], ['soap', 'personal_bath_body'], ['body wash', 'personal_bath_body'], ['lotion', 'personal_bath_body'],
  ['deodorant', 'personal_bath_body'], ['sunscreen', 'personal_bath_body'], ['razor', 'personal_shaving'], ['tampon', 'personal_feminine_care'],
  ['pad', 'personal_feminine_care'], ['vitamin', 'personal_health'], ['medicine', 'personal_health'], ['tablet', 'personal_health'], ['capsule', 'personal_health'],
  ['gummy', 'personal_health'], ['diaper', 'baby_diapers_wipes'], ['formula', 'baby_feeding'], ['baby food', 'baby_feeding'], ['dog food', 'pet_dog'],
  ['dog treat', 'pet_dog'], ['cat food', 'pet_cat'], ['litter', 'pet_cat'], ['cat treat', 'pet_cat'],
].map(([e, sub]) => [words(e).join(' '), sub] as [string, string]);

function endingOf(text: string): string | undefined {
  const w = words(text);
  for (const n of [2, 1]) {
    if (w.length < n) continue;
    const tail = w.slice(-n).join(' ');
    const hit = ENDINGS.find(([e]) => e === tail);
    if (hit) return hit[1];
  }
  return undefined;
}

/** "Frozen", "canned", "dried": the same kind of thing, kept that way. */
function kept(text: string, sub: string): string {
  const w = new Set(words(text));
  const top = topOf(sub);
  if (w.has('frozen') && top !== 'frozen') {
    if (sub === 'produce_fruits') return 'frozen_fruit';
    if (top === 'produce') return 'frozen_vegetables';
    if (top === 'meat_seafood') return 'frozen_meat_seafood';
    if (top === 'breakfast_cereal' || sub === 'bakery_bagels_muffins') return 'frozen_breakfast';
    if (top === 'snacks' || top === 'bakery_bread') return 'frozen_desserts_ice';
    return 'frozen_meals';
  }
  if ((w.has('canned') || w.has('can')) && top !== 'canned_jarred') {
    if (sub === 'produce_fruits') return 'canned_fruit';
    if (top === 'produce') return 'canned_vegetables';
    if (top === 'meat_seafood') return 'canned_meat_fish';
  }
  if (w.has('dried') && sub === 'produce_fruits') return 'snacks_nuts_dried_fruit';
  return sub;
}

/** The likeliest category for something typed, or undefined if nothing says. */
export function guessCategory(text: string, catalog: Catalog): Guess | undefined {
  if (!normalize(text)) return undefined;
  const exact = catalog.exact(text);
  if (exact?.categoryId) return { categoryId: exact.categoryId, how: 'item' };
  const inside = catalog.match(text);
  const padded = ` ${normalize(text)} `;
  const insideWords = inside ? Math.max(...[inside.name, ...(inside.aliases ?? [])]
    .filter((n) => padded.includes(` ${normalize(n)} `))
    .map((n) => normalize(n).split(' ').length), 0) : 0;
  // A known item's own name ending the text ("Oscar Mayer bacon") says what it is, more than the brand does.
  const endsWithName = !!inside && padded.endsWith(` ${normalize(inside.name)} `);
  const brand = brandIn(text);
  let base: Guess | undefined;
  const end = endingOf(text);
  if (inside?.categoryId && (insideWords >= 2 || endsWithName)) base = { categoryId: inside.categoryId, how: 'contains' };
  else if (brand) base = { categoryId: brand, how: 'brand' };
  // What it ends with ("chicken soup" is soup) before a one-word item somewhere in it.
  else if (end) base = { categoryId: end, how: 'word' };
  else if (inside?.categoryId) base = { categoryId: inside.categoryId, how: 'contains' };
  return base && { ...base, categoryId: kept(text, base.categoryId) };
}
