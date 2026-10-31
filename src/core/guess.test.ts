import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { defaultCategories, defaultProducts } from './categories';
import { guessCategory } from './guess';
import { topOf } from './taxonomy';

const catalog = new Catalog(defaultProducts, defaultCategories);
const guess = (t: string) => guessCategory(t, catalog)?.categoryId;

describe('guessing categories', () => {
  it('known items, by name or another name', () => {
    expect(guessCategory('Bananas', catalog)).toEqual({ categoryId: 'produce_fruits', how: 'item' });
    expect(guess('scallions')).toBe('produce_vegetables');
    expect(guess('pepper')).toBe('spices_salt_pepper');
    expect(guess('peppers')).toBe('produce_vegetables');
  });

  it('a known kind of thing inside the name wins over the brand; a brand wins over a one-word match', () => {
    expect(guess('Barilla pasta sauce')).toBe('pasta_sauce');
    expect(guess('Dawn dish soap')).toBe('household_dish');
    expect(guess('Kraft mac and cheese')).toBe('grains_boxed_meals');
    expect(guess('Kraft singles')).toBe('cheese_sliced');
    expect(guess('Doritos cool ranch')).toBe('snacks_chips'); // not salad dressing
    expect(guess('Häagen-Dazs vanilla')).toBe('frozen_desserts_ice'); // not vanilla extract
    expect(guess("Ben & Jerry's cherry garcia")).toBe('frozen_desserts_ice');
  });

  it('frozen, canned and dried move it to that kind', () => {
    expect(guess('frozen blueberries')).toBe('frozen_fruit');
    expect(guess('frozen broccoli')).toBe('frozen_vegetables');
    expect(guess('canned peaches')).toBe('canned_fruit');
    expect(guess('dried mango')).toBe('snacks_nuts_dried_fruit');
    expect(guess('chicken soup')).toBe('canned_soup_broth'); // what it ends with, not the chicken
    expect(guess('frozen pizza')).toBe('frozen_pizza_appetizers'); // a starter item already
  });

  it('nothing to go on: no guess', () => {
    expect(guess('flux capacitor')).toBeUndefined();
    expect(guess('')).toBeUndefined();
  });
});

/**
 * Realistic list entries the starter list doesn't have (brands, store brands, descriptive names), each with
 * the category it belongs in. The guesses are scored on the category (the 22) and the subcategory.
 */
const LIST: [text: string, sub: string][] = [
  ['Cheerios', 'breakfast_cereal_sub'], ['Honey Nut Cheerios', 'breakfast_cereal_sub'], ['Tide pods', 'household_laundry'],
  ['Clorox wipes', 'household_cleaners'], ['Charmin', 'paper_toilet_tissue'], ['Bounty', 'paper_towels_napkins'], ['Doritos', 'snacks_chips'],
  ['Goldfish', 'snacks_crackers'], ['Oreos', 'snacks_cookies'], ['Coke Zero', 'beverages_soda'], ['Diet Coke', 'beverages_soda'],
  ['LaCroix', 'beverages_water'], ['Gatorade', 'beverages_sports_energy'], ['Red Bull', 'beverages_sports_energy'], ['Folgers', 'beverages_coffee'],
  ['K-Cups', 'beverages_coffee'], ['Chobani', 'dairy_yogurt'], ['Philadelphia cream cheese', 'dairy_cultured'], ['Coffee mate', 'dairy_cream'],
  ['Land O Lakes butter', 'dairy_butter'], ['Silk almond milk', 'dairy_plant_milk'], ['Fairlife milk', 'dairy_milk'], ['Tillamook cheddar', 'cheese_block'],
  ['Sargento shredded mozzarella', 'cheese_shredded'], ['Babybel', 'cheese_snack'], ["Dave's Killer Bread", 'bakery_sandwich_bread'],
  ["Thomas' English muffins", 'bakery_bagels_muffins'], ["King's Hawaiian rolls", 'bakery_buns_rolls'], ['Mission tortillas', 'bakery_tortillas_wraps'],
  ["Boar's Head turkey", 'deli_meats'], ['Sabra hummus', 'deli_dips_spreads'], ['Tyson chicken nuggets', 'frozen_pizza_appetizers'],
  ['Johnsonville brats', 'meat_bacon_sausage'], ['Oscar Mayer bacon', 'meat_bacon_sausage'], ['Jif', 'breakfast_spreads'],
  ["Smucker's strawberry jam", 'breakfast_spreads'], ['Pop-Tarts', 'breakfast_bars'], ['Nature Valley bars', 'breakfast_bars'],
  ['Quaker oats', 'breakfast_hot_cereal'], ['Prego', 'pasta_sauce'], ['Rao’s marinara', 'pasta_sauce'], ['Rice-A-Roni', 'grains_boxed_meals'],
  ['Campbell’s tomato soup', 'canned_soup_broth'], ['Progresso chicken noodle', 'canned_soup_broth'], ["Bush's baked beans", 'canned_beans'],
  ['Rotel', 'canned_tomatoes'], ['StarKist tuna', 'canned_meat_fish'], ['Heinz ketchup', 'condiments_table'], ['Hidden Valley ranch', 'condiments_dressings'],
  ["Sweet Baby Ray's", 'condiments_hot_bbq'], ['Frank’s RedHot', 'condiments_hot_bbq'], ['McCormick taco seasoning', 'spices_blends_mixes'],
  ['Old Bay', 'spices_blends_mixes'], ['Betty Crocker brownie mix', 'baking_mixes'], ['Toll House chocolate chips', 'baking_chocolate_nuts'],
  ['Kikkoman soy sauce', 'intl_asian'], ['Old El Paso taco shells', 'intl_mexican_latin'], ['Bud Light', 'alcohol_beer'], ['White Claw', 'alcohol_beer'],
  ['Josh cabernet', 'alcohol_wine'], ['Birds Eye steamfresh', 'frozen_vegetables'], ['DiGiorno', 'frozen_pizza_appetizers'], ['Eggo waffles', 'frozen_breakfast'],
  ['Ben & Jerry’s', 'frozen_desserts_ice'], ['Lean Cuisine', 'frozen_meals'], ['Crest toothpaste', 'personal_oral_care'], ['Dove body wash', 'personal_bath_body'],
  ['Tylenol', 'personal_health'], ['Advil', 'personal_health'], ['Pampers', 'baby_diapers_wipes'], ['Purina dog chow', 'pet_dog'], ['Fancy Feast', 'pet_cat'],
  ['Trader Joe’s everything bagels', 'bakery_bagels_muffins'], ['organic strawberries', 'produce_fruits'], ['family size frozen lasagna', 'frozen_meals'],
];

describe('guessing real list entries', () => {
  it('gets the category right for nearly all, and the subcategory for most', () => {
    let top = 0;
    let sub = 0;
    const misses: string[] = [];
    for (const [text, want] of LIST) {
      const got = guess(text);
      if (got === want) sub++;
      if (got && topOf(got) === topOf(want)) top++;
      else misses.push(`${text}: ${got ?? 'none'} (is ${want})`);
    }
    console.log(`guesses: category ${top}/${LIST.length}, subcategory ${sub}/${LIST.length}`, misses.length ? `\n  ${misses.join('\n  ')}` : '');
    expect(top / LIST.length).toBeGreaterThanOrEqual(0.95);
    expect(sub / LIST.length).toBeGreaterThanOrEqual(0.85);
  });
});
