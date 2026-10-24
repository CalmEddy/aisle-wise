import type { Category, Product } from './types';

const groups: [id: string, name: string, items: string][] = [
  ['fruit', 'Fruit', 'Apples, Bananas, Oranges, Lemons, Limes, Grapes, Strawberries, Blueberries, Raspberries, Melon, Watermelon, Pears, Peaches, Plums, Mangoes, Pineapple, Avocados, Kiwi, Cherries'],
  ['veg', 'Vegetables', 'Lettuce, Spinach, Kale, Carrots, Celery, Onions, Garlic, Potatoes, Sweet potatoes, Tomatoes, Cucumbers, Bell peppers, Broccoli, Cauliflower, Zucchini, Mushrooms, Corn, Cilantro, Parsley, Basil, Ginger, Salad mix, Green beans'],
  ['bakery', 'Bakery', 'Bread, Bagels, Baguette, Croissants, Muffins, Dinner rolls, Hamburger buns, Tortillas, Cake, Donuts, Pita'],
  ['deli', 'Deli & Cheese', 'Ham, Sliced turkey, Salami, Cheese, Cheddar, Mozzarella, Parmesan, Brie, Hummus, Rotisserie chicken, Olives'],
  ['dairy', 'Dairy', 'Milk, Almond milk, Oat milk, Yogurt, Heavy cream, Sour cream, Cream cheese, Cottage cheese, Half and half, Coffee creamer'],
  ['eggs', 'Eggs & Butter', 'Eggs, Butter, Margarine'],
  ['meat', 'Meat', 'Chicken, Chicken breasts, Ground beef, Steak, Pork chops, Bacon, Sausage, Lamb, Hot dogs, Ground turkey'],
  ['seafood', 'Seafood', 'Fish, Salmon, Tuna steak, Shrimp, Cod, Tilapia, Crab, Scallops'],
  ['floral', 'Floral & Cards', 'Flowers, Greeting card, Balloons'],
  ['pharmacy', 'Pharmacy', 'Prescription, Vitamins, Allergy medicine, Ibuprofen, Tylenol, Cold medicine'],
  ['breakfast', 'Cereal & Breakfast', 'Cereal, Oatmeal, Granola, Pancake mix, Maple syrup, Pop-Tarts'],
  ['coffee', 'Coffee & Tea', 'Coffee, Tea, K-Cups, Hot chocolate'],
  ['pasta', 'Pasta & Rice', 'Pasta, Spaghetti, Penne, Macaroni, Rice, Quinoa, Noodles, Couscous, Ramen'],
  ['canned', 'Canned Goods & Soup', 'Soup, Broth, Chicken stock, Beans, Black beans, Chickpeas, Tuna, Canned tomatoes, Tomato sauce, Pasta sauce'],
  ['baking', 'Baking & Spices', 'Flour, Sugar, Brown sugar, Baking soda, Baking powder, Yeast, Vanilla, Chocolate chips, Salt, Cinnamon, Cumin, Paprika, Oregano, Black pepper'],
  ['condiments', 'Oils & Condiments', 'Olive oil, Vegetable oil, Vinegar, Ketchup, Mustard, Mayonnaise, Soy sauce, Hot sauce, Salad dressing, Peanut butter, Jelly, Jam, Honey'],
  ['snacks', 'Snacks & Chips', 'Chips, Tortilla chips, Pretzels, Popcorn, Nuts, Almonds, Peanuts, Trail mix, Salsa, Granola bars'],
  ['cookies', 'Cookies & Crackers', 'Cookies, Crackers, Oreos, Graham crackers'],
  ['soda', 'Soda & Sports Drinks', 'Soda, Coke, Pepsi, Sprite, Gatorade, Energy drinks, Sparkling water, Seltzer'],
  ['water', 'Water & Juice', 'Water, Juice, Orange juice, Apple juice, Lemonade'],
  ['paper', 'Paper & Cleaning', 'Paper towels, Toilet paper, Tissues, Napkins, Aluminum foil, Plastic wrap, Trash bags, Zip bags, Dish soap, Sponges, All-purpose cleaner, Bleach'],
  ['laundry', 'Laundry & Pets', 'Laundry detergent, Dryer sheets, Fabric softener, Dog food, Cat food, Cat litter'],
  ['health', 'Health & Beauty', 'Shampoo, Conditioner, Hand soap, Body wash, Toothpaste, Toothbrush, Floss, Deodorant, Razors, Lotion, Sunscreen'],
  ['baby', 'Baby', 'Diapers, Baby wipes, Baby food, Formula'],
  ['frozen', 'Frozen Meals & Pizza', 'Frozen pizza, Frozen meals, Frozen burritos, Frozen waffles, Fish sticks'],
  ['icecream', 'Ice Cream & Frozen Veg', 'Ice cream, Frozen vegetables, Frozen fruit, Frozen peas, Popsicles, Ice'],
];

export const defaultCategories: Category[] = groups.map(([id, name]) => ({ id, name }));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The starter master list of grocery items. */
export const defaultProducts: Product[] = groups.flatMap(([categoryId, , items]) =>
  items.split(',').map((raw) => {
    const name = raw.trim();
    return { id: `p-${slug(name)}`, name, categoryId };
  }),
);
