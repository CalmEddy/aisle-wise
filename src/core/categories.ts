export interface Category {
  id: string;
  name: string;
  keywords: string[];
}

const c = (id: string, name: string, words: string): Category => ({
  id,
  name,
  keywords: words.split(',').map((w) => w.trim()),
});

/** What a typical grocery store stocks, with words used to recognise items. */
export const categories: Category[] = [
  c('fruit', 'Fruit', 'apple, banana, orange, lemon, lime, grape, strawberry, blueberry, raspberry, berry, melon, watermelon, pear, peach, plum, mango, pineapple, avocado, kiwi, cherry'),
  c('veg', 'Vegetables', 'lettuce, spinach, kale, carrot, celery, onion, garlic, potato, sweet potato, tomato, cucumber, pepper, bell pepper, broccoli, cauliflower, zucchini, mushroom, corn, cilantro, parsley, basil, ginger, salad, herb, green bean'),
  c('bakery', 'Bakery', 'bread, bagel, baguette, croissant, muffin, roll, bun, tortilla, cake, donut, pita'),
  c('deli', 'Deli & Cheese', 'ham, turkey, salami, cheese, cheddar, mozzarella, parmesan, brie, hummus, rotisserie chicken, olive'),
  c('dairy', 'Dairy', 'milk, almond milk, oat milk, yogurt, cream, sour cream, cream cheese, cottage cheese, half and half, creamer'),
  c('eggs', 'Eggs & Butter', 'egg, butter, margarine'),
  c('meat', 'Meat', 'chicken, beef, ground beef, steak, pork, bacon, sausage, lamb, hot dog, ground turkey'),
  c('seafood', 'Seafood', 'fish, salmon, tuna steak, shrimp, cod, tilapia, crab, scallop'),
  c('floral', 'Floral & Cards', 'flower, card, balloon'),
  c('pharmacy', 'Pharmacy', 'prescription, vitamin, allergy, ibuprofen, tylenol, cold medicine'),
  c('breakfast', 'Cereal & Breakfast', 'cereal, oatmeal, granola, pancake mix, syrup, maple syrup, pop tart'),
  c('coffee', 'Coffee & Tea', 'coffee, tea, k cup, hot chocolate'),
  c('pasta', 'Pasta & Rice', 'pasta, spaghetti, penne, macaroni, rice, quinoa, noodle, couscous, ramen'),
  c('canned', 'Canned Goods & Soup', 'canned, soup, broth, stock, bean, black bean, chickpea, tuna, canned tomato, tomato sauce, pasta sauce'),
  c('baking', 'Baking & Spices', 'flour, sugar, brown sugar, baking soda, baking powder, yeast, vanilla, chocolate chip, salt, spice, cinnamon, cumin, paprika, oregano, black pepper'),
  c('condiments', 'Oils & Condiments', 'oil, olive oil, vegetable oil, vinegar, ketchup, mustard, mayo, mayonnaise, soy sauce, hot sauce, dressing, salad dressing, peanut butter, jelly, jam, honey'),
  c('snacks', 'Snacks & Chips', 'chip, tortilla chip, pretzel, popcorn, nut, almond, peanut, trail mix, salsa, granola bar'),
  c('cookies', 'Cookies & Crackers', 'cookie, cracker, oreo, graham cracker'),
  c('soda', 'Soda & Sports Drinks', 'soda, coke, pepsi, sprite, gatorade, energy drink, sparkling water, seltzer'),
  c('water', 'Water & Juice', 'water, juice, orange juice, apple juice, lemonade'),
  c('paper', 'Paper & Cleaning', 'paper towel, toilet paper, tissue, napkin, foil, plastic wrap, trash bag, zip bag, dish soap, sponge, cleaner, bleach'),
  c('laundry', 'Laundry & Pets', 'laundry, detergent, dryer sheet, fabric softener, dog food, cat food, cat litter, pet'),
  c('health', 'Health & Beauty', 'shampoo, conditioner, soap, body wash, toothpaste, toothbrush, floss, deodorant, razor, lotion, sunscreen'),
  c('baby', 'Baby', 'diaper, wipe, baby food, formula'),
  c('frozen', 'Frozen Meals & Pizza', 'frozen pizza, pizza, frozen meal, frozen dinner, frozen burrito, frozen waffle, fish stick'),
  c('icecream', 'Ice Cream & Frozen Veg', 'ice cream, frozen vegetable, frozen fruit, frozen pea, popsicle, ice'),
];

export const categoryById = new Map(categories.map((cat) => [cat.id, cat]));
