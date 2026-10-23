import type { Section, StoreLayout } from './types';

/**
 * A typical supermarket: produce down the left wall, dairy and deli along the
 * back, meat and seafood on the right wall, and eight center aisles.
 * Units are roughly metres.
 */
const sections: Section[] = [
  { id: 'fruit', name: 'Produce – Fruit', short: 'Fruit', point: { x: 0, y: 15 } },
  { id: 'veg', name: 'Produce – Vegetables', short: 'Veg', point: { x: 0, y: 40 } },
  { id: 'bakery', name: 'Bakery', short: 'Bakery', point: { x: 8, y: 60 } },
  { id: 'deli', name: 'Deli & Cheese', short: 'Deli', point: { x: 30, y: 60 } },
  { id: 'dairy', name: 'Dairy', short: 'Dairy', point: { x: 50, y: 60 } },
  { id: 'eggs', name: 'Eggs & Butter', short: 'Eggs', point: { x: 62, y: 60 } },
  { id: 'meat', name: 'Meat', short: 'Meat', point: { x: 100, y: 45 } },
  { id: 'seafood', name: 'Seafood', short: 'Fish', point: { x: 100, y: 22 } },
  { id: 'floral', name: 'Floral & Cards', short: 'Floral', point: { x: 10, y: 0 } },
  { id: 'pharmacy', name: 'Pharmacy', short: 'Rx', point: { x: 92, y: 0 } },
  ...aisle(1, 'Cereal & Breakfast', 'Coffee & Tea'),
  ...aisle(2, 'Pasta & Rice', 'Canned Goods & Soup'),
  ...aisle(3, 'Baking & Spices', 'Oils & Condiments'),
  ...aisle(4, 'Snacks & Chips', 'Cookies & Crackers'),
  ...aisle(5, 'Soda & Sports Drinks', 'Water & Juice'),
  ...aisle(6, 'Paper & Cleaning', 'Laundry & Pets'),
  ...aisle(7, 'Health & Beauty', 'Baby'),
  ...aisle(8, 'Frozen Meals & Pizza', 'Ice Cream & Frozen Veg'),
];

function aisle(n: number, front: string, back: string): Section[] {
  const x = 5 + n * 10;
  return [
    { id: `a${n}f`, name: `Aisle ${n} – ${front}`, short: `A${n}`, point: { x, y: 15 } },
    { id: `a${n}b`, name: `Aisle ${n} – ${back}`, short: `A${n}`, point: { x, y: 45 } },
  ];
}

const catalog: Record<string, string> = {};
const put = (sectionId: string, words: string) =>
  words.split(',').forEach((w) => (catalog[w.trim()] = sectionId));

put('fruit', 'apple, banana, orange, lemon, lime, grape, strawberry, blueberry, raspberry, berry, melon, watermelon, pear, peach, plum, mango, pineapple, avocado, kiwi, cherry');
put('veg', 'lettuce, spinach, kale, carrot, celery, onion, garlic, potato, sweet potato, tomato, cucumber, pepper, bell pepper, broccoli, cauliflower, zucchini, mushroom, corn, cilantro, parsley, basil, ginger, salad, herb, green bean');
put('bakery', 'bread, bagel, baguette, croissant, muffin, roll, bun, tortilla, cake, donut, pita');
put('deli', 'ham, turkey, salami, cheese, cheddar, mozzarella, parmesan, brie, hummus, rotisserie chicken, olive');
put('dairy', 'milk, almond milk, oat milk, yogurt, cream, sour cream, cream cheese, cottage cheese, half and half, creamer');
put('eggs', 'egg, butter, margarine');
put('meat', 'chicken, beef, ground beef, steak, pork, bacon, sausage, lamb, hot dog, ground turkey');
put('seafood', 'fish, salmon, tuna steak, shrimp, cod, tilapia, crab, scallop');
put('floral', 'flower, card, balloon');
put('pharmacy', 'prescription, vitamin, allergy, ibuprofen, tylenol, cold medicine');
put('a1f', 'cereal, oatmeal, granola, pancake mix, syrup, maple syrup, pop tart');
put('a1b', 'coffee, tea, k cup, hot chocolate');
put('a2f', 'pasta, spaghetti, penne, macaroni, rice, quinoa, noodle, couscous, ramen');
put('a2b', 'canned, soup, broth, stock, bean, black bean, chickpea, tuna, canned tomato, tomato sauce, pasta sauce');
put('a3f', 'flour, sugar, brown sugar, baking soda, baking powder, yeast, vanilla, chocolate chip, salt, spice, cinnamon, cumin, paprika, oregano, black pepper');
put('a3b', 'oil, olive oil, vegetable oil, vinegar, ketchup, mustard, mayo, mayonnaise, soy sauce, hot sauce, dressing, salad dressing, peanut butter, jelly, jam, honey');
put('a4f', 'chip, tortilla chip, pretzel, popcorn, nut, almond, peanut, trail mix, salsa, granola bar');
put('a4b', 'cookie, cracker, oreo, graham cracker');
put('a5f', 'soda, coke, pepsi, sprite, gatorade, energy drink, sparkling water, seltzer');
put('a5b', 'water, juice, orange juice, apple juice, lemonade');
put('a6f', 'paper towel, toilet paper, tissue, napkin, foil, plastic wrap, trash bag, zip bag, dish soap, sponge, cleaner, bleach');
put('a6b', 'laundry, detergent, dryer sheet, fabric softener, dog food, cat food, cat litter, pet');
put('a7f', 'shampoo, conditioner, soap, body wash, toothpaste, toothbrush, floss, deodorant, razor, lotion, sunscreen');
put('a7b', 'diaper, wipe, baby food, formula');
put('a8f', 'frozen pizza, pizza, frozen meal, frozen dinner, frozen burrito, frozen waffle, fish stick');
put('a8b', 'ice cream, frozen vegetable, frozen fruit, frozen pea, popsicle, ice');

export const demoStore: StoreLayout = {
  id: 'demo',
  name: 'Demo Market',
  width: 100,
  depth: 60,
  aisleXs: [0, 15, 25, 35, 45, 55, 65, 75, 85, 100],
  entrance: { x: 5, y: 0 },
  checkout: { x: 60, y: 0 },
  sections,
  catalog,
};
