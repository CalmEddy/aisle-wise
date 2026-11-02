import type { LabelStyle } from '../core/labels';
import type { AislePos, AisleSide, Clue, GeneratedMap, Temp } from '../core/types';

/**
 * Default store maps: a starting guess for a new store, before any answers.
 *
 * A template is a few map settings and a seed for each kind of thing ("cereal
 * is usually about halfway through the aisles"). Seeds are weak answers: the
 * map is drawn from them where nothing's been answered, and the first real
 * answer for a kind replaces its seed. Only seeds the app is fairly sure of
 * (see PIN_CONFIDENCE) put things on the map; the rest are left to the usual
 * walking order.
 *
 * Aisle seeds are a fraction of the way through the aisles (0 = aisle 1,
 * 1 = the last), so a template fits a store with any number of aisles.
 *
 * Researched from industry layout guides and chain store maps (sources below);
 * where stores vary a lot, the confidence is low.
 */

/** "About this far through the aisles": aisle 1 is 0, the last aisle 1. */
export interface AisleAt { kind: 'aisleAt'; at: number; side?: AisleSide; pos?: AislePos; temp?: Temp }

export interface Seed {
  /** A category or subcategory id. */
  category: string;
  clue: Clue | AisleAt;
  /** How often a store of this kind has it there, 0–1. */
  confidence: number;
}

export interface StoreTemplate {
  id: string;
  name: string;
  /** One line for the shopper. */
  description: string;
  icon: string;
  /** Usual number of aisles (the shopper can change it); 0 for a store with lettered sections. */
  aisles: number;
  /** The range offered when adjusting it. */
  aisleRange: [number, number];
  gen: Partial<Pick<GeneratedMap, 'aisleOne' | 'produce' | 'backWall' | 'door' | 'wallOrder' | 'aisleGroups' | 'directions'>>;
  labels?: LabelStyle;
  seeds: Seed[];
  /** What answers point to this kind of store. */
  hints: { rule: { kind: 'maxAisleAtLeast'; n: number } | { kind: 'maxAisleAtMost'; n: number } | { kind: 'usesShelfLabels' }; weight: number }[];
  sources: string[];
}

/** Seeds at least this sure put things on the map; below it they don't. */
export const PIN_CONFIDENCE = 0.7;

const dept = (d: Extract<Clue, { kind: 'dept' }>['dept']): Clue => ({ kind: 'dept', dept: d });
const at = (x: number, pos?: AislePos, temp?: Temp): AisleAt => ({ kind: 'aisleAt', at: x, ...(pos && { pos }), ...(temp && { temp }) });

export const STORE_TEMPLATES: StoreTemplate[] = [
  {
    id: 'conventional',
    name: 'Typical supermarket',
    description: 'Produce by the door, meat and dairy across the back, about a dozen aisles.',
    icon: '🛒',
    aisles: 12,
    aisleRange: [8, 20],
    gen: { wallOrder: { right: ['produce', 'floral', 'deli', 'bakery'], back: ['dairy', 'seafood', 'meat'], left: ['frozen'] } },
    seeds: [
      { category: 'produce', clue: dept('produce'), confidence: 0.92 },
      { category: 'bakery_bread', clue: dept('bakery'), confidence: 0.85 },
      { category: 'deli', clue: dept('deli'), confidence: 0.8 },
      { category: 'meat_seafood', clue: dept('meat'), confidence: 0.88 },
      { category: 'meat_fish_seafood', clue: dept('seafood'), confidence: 0.75 },
      { category: 'dairy_eggs', clue: dept('dairy'), confidence: 0.9 },
      { category: 'cheese', clue: dept('dairy'), confidence: 0.8 },
      { category: 'frozen', clue: dept('frozen'), confidence: 0.85 },
      { category: 'international', clue: at(0.15), confidence: 0.55 },
      { category: 'canned_jarred', clue: at(0.25), confidence: 0.6 },
      { category: 'condiments_sauces', clue: at(0.3), confidence: 0.55 },
      { category: 'pasta_rice_grains', clue: at(0.35), confidence: 0.6 },
      { category: 'breakfast_cereal', clue: at(0.45), confidence: 0.6 },
      { category: 'baking', clue: at(0.55), confidence: 0.6 },
      { category: 'spices_seasonings', clue: at(0.55), confidence: 0.55 },
      { category: 'snacks', clue: at(0.65), confidence: 0.6 },
      { category: 'beverages', clue: at(0.72), confidence: 0.6 },
      { category: 'beer_wine', clue: at(0.78, 'back'), confidence: 0.4 },
      { category: 'personal_care', clue: at(0.82), confidence: 0.55 },
      { category: 'baby', clue: at(0.85), confidence: 0.5 },
      { category: 'household_cleaning', clue: at(0.92), confidence: 0.6 },
      { category: 'paper_goods', clue: at(1), confidence: 0.6 },
      { category: 'pet', clue: at(1, 'back'), confidence: 0.5 },
    ],
    hints: [{ rule: { kind: 'maxAisleAtLeast', n: 9 }, weight: 0.6 }],
    sources: [
      'foodindustry.com: How a typical U.S. grocery store is organized',
      'itretail.com: How are grocery stores organized?',
      'Kroger / Albertsons / Publix store maps',
    ],
  },
  {
    id: 'small',
    name: 'Small store',
    description: 'A neighbourhood or city store: the same pattern squeezed into a few aisles.',
    icon: '🏪',
    aisles: 7,
    aisleRange: [3, 10],
    gen: { wallOrder: { right: ['produce', 'bakery'], back: ['dairy', 'meat'], left: ['frozen'] } },
    seeds: [
      { category: 'produce', clue: dept('produce'), confidence: 0.85 },
      { category: 'bakery_bread', clue: dept('bakery'), confidence: 0.7 },
      { category: 'deli', clue: dept('deli'), confidence: 0.55 },
      { category: 'meat_seafood', clue: dept('meat'), confidence: 0.75 },
      { category: 'dairy_eggs', clue: dept('dairy'), confidence: 0.8 },
      { category: 'cheese', clue: dept('dairy'), confidence: 0.7 },
      { category: 'frozen', clue: dept('frozen'), confidence: 0.75 },
      { category: 'canned_jarred', clue: at(0.17), confidence: 0.6 },
      { category: 'condiments_sauces', clue: at(0.17, 'front'), confidence: 0.55 },
      { category: 'international', clue: at(0.17, 'back'), confidence: 0.45 },
      { category: 'pasta_rice_grains', clue: at(0.33), confidence: 0.6 },
      { category: 'breakfast_cereal', clue: at(0.33, 'back'), confidence: 0.55 },
      { category: 'spices_seasonings', clue: at(0.5, 'front'), confidence: 0.5 },
      { category: 'baking', clue: at(0.5), confidence: 0.55 },
      { category: 'snacks', clue: at(0.67), confidence: 0.6 },
      { category: 'beverages', clue: at(0.67, 'front'), confidence: 0.6 },
      { category: 'beer_wine', clue: { kind: 'wall', wall: 'left', part: 'front', temp: 'chilled' }, confidence: 0.4 },
      { category: 'personal_care', clue: at(0.83), confidence: 0.5 },
      { category: 'baby', clue: at(0.83, 'front'), confidence: 0.45 },
      { category: 'household_cleaning', clue: at(0.83, 'back'), confidence: 0.55 },
      { category: 'paper_goods', clue: at(1), confidence: 0.55 },
      { category: 'pet', clue: at(1, 'back'), confidence: 0.5 },
    ],
    hints: [{ rule: { kind: 'maxAisleAtMost', n: 8 }, weight: 0.5 }],
    sources: ['itretail.com: How are grocery stores organized?', 'planohero.com: Grocery store layout strategy'],
  },
  {
    id: 'discount',
    name: 'Discount store',
    description: 'Aldi or Lidl style: a few long aisles, coolers along the back, no service counters.',
    icon: '🏷️',
    aisles: 6,
    aisleRange: [4, 8],
    gen: { wallOrder: { right: ['produce'], back: ['dairy', 'meat'], left: ['frozen'] } },
    seeds: [
      { category: 'produce', clue: dept('produce'), confidence: 0.8 },
      { category: 'dairy_eggs', clue: { kind: 'wall', wall: 'back', part: 'left', temp: 'chilled' }, confidence: 0.8 },
      { category: 'cheese', clue: { kind: 'wall', wall: 'back', part: 'middle', temp: 'chilled' }, confidence: 0.7 },
      { category: 'meat_seafood', clue: { kind: 'wall', wall: 'back', part: 'right', temp: 'chilled' }, confidence: 0.7 },
      { category: 'frozen', clue: dept('frozen'), confidence: 0.75 },
      { category: 'bakery_bread', clue: at(0, 'front'), confidence: 0.6 },
      { category: 'deli', clue: { kind: 'wall', wall: 'back', part: 'middle', temp: 'chilled' }, confidence: 0.4 },
      { category: 'pasta_rice_grains', clue: at(0.2), confidence: 0.6 },
      { category: 'canned_jarred', clue: at(0.2, 'back'), confidence: 0.6 },
      { category: 'condiments_sauces', clue: at(0.2, 'front'), confidence: 0.55 },
      { category: 'breakfast_cereal', clue: at(0.4), confidence: 0.6 },
      { category: 'spices_seasonings', clue: at(0.4, 'front'), confidence: 0.5 },
      { category: 'baking', clue: at(0.4, 'back'), confidence: 0.5 },
      { category: 'snacks', clue: at(0.6), confidence: 0.6 },
      { category: 'international', clue: at(0.6, 'back'), confidence: 0.4 },
      { category: 'baby', clue: at(0.6, 'back'), confidence: 0.4 },
      { category: 'beverages', clue: at(0.8), confidence: 0.6 },
      { category: 'beer_wine', clue: at(0.8, 'back'), confidence: 0.45 },
      { category: 'household_cleaning', clue: at(1), confidence: 0.55 },
      { category: 'paper_goods', clue: at(1, 'back'), confidence: 0.55 },
      { category: 'personal_care', clue: at(1, 'front'), confidence: 0.5 },
      { category: 'pet', clue: at(1), confidence: 0.45 },
    ],
    hints: [{ rule: { kind: 'maxAisleAtMost', n: 7 }, weight: 0.5 }],
    sources: ['mashed.com: The reason Aldi stores have so few aisles', 'businessinsider.com: Aldi vs Lidl store layout'],
  },
  {
    id: 'supercenter',
    name: 'Supercenter',
    description: 'The grocery side of a Walmart or Target: many aisles, frozen in aisles of its own.',
    icon: '🏬',
    aisles: 16,
    aisleRange: [10, 30],
    gen: { wallOrder: { right: ['produce', 'bakery', 'deli'], back: ['meat', 'seafood', 'dairy'], left: [] }, backWall: 'reversed' },
    seeds: [
      { category: 'produce', clue: dept('produce'), confidence: 0.85 },
      { category: 'bakery_bread', clue: dept('bakery'), confidence: 0.75 },
      { category: 'deli', clue: dept('deli'), confidence: 0.7 },
      { category: 'meat_seafood', clue: dept('meat'), confidence: 0.8 },
      { category: 'dairy_eggs', clue: dept('dairy'), confidence: 0.8 },
      { category: 'cheese', clue: dept('dairy'), confidence: 0.7 },
      // Frozen in aisles with doors near the dairy end, not along a wall.
      { category: 'frozen', clue: at(0.95, undefined, 'frozen'), confidence: 0.6 },
      { category: 'beer_wine', clue: at(0.05), confidence: 0.4 },
      { category: 'international', clue: at(0.15), confidence: 0.45 },
      { category: 'canned_jarred', clue: at(0.25), confidence: 0.5 },
      { category: 'condiments_sauces', clue: at(0.3), confidence: 0.5 },
      { category: 'pasta_rice_grains', clue: at(0.3), confidence: 0.5 },
      { category: 'baking', clue: at(0.4), confidence: 0.5 },
      { category: 'spices_seasonings', clue: at(0.4), confidence: 0.45 },
      { category: 'breakfast_cereal', clue: at(0.5), confidence: 0.5 },
      { category: 'snacks', clue: at(0.6), confidence: 0.5 },
      { category: 'beverages', clue: at(0.7), confidence: 0.5 },
      { category: 'paper_goods', clue: at(0.8), confidence: 0.45 },
      { category: 'household_cleaning', clue: at(0.8), confidence: 0.45 },
      { category: 'pet', clue: at(0.85), confidence: 0.4 },
      { category: 'baby', clue: at(0.85), confidence: 0.4 },
      { category: 'personal_care', clue: at(0.9), confidence: 0.4 },
    ],
    hints: [{ rule: { kind: 'maxAisleAtLeast', n: 15 }, weight: 0.6 }],
    sources: ['groceryDive: Walmart Supercenter grocery zone', 'businessinsider.com: Walmart vs Target grocery tours', 'Walmart in-store maps'],
  },
  {
    id: 'warehouse',
    name: 'Warehouse club',
    description: 'Costco or Sam’s Club style: lettered sections like B12, fresh food across the back.',
    icon: '📦',
    aisles: 0,
    aisleRange: [0, 0],
    gen: { wallOrder: { right: [], back: ['meat', 'dairy', 'bakery'], left: ['frozen'] } },
    labels: { example: 'B12', roles: ['section', 'shelf'], pairing: 'backToBack' },
    seeds: [
      { category: 'produce', clue: { kind: 'open', near: 'far', fixture: 'table' }, confidence: 0.75 },
      { category: 'meat_seafood', clue: dept('meat'), confidence: 0.8 },
      { category: 'dairy_eggs', clue: dept('dairy'), confidence: 0.75 },
      { category: 'cheese', clue: dept('dairy'), confidence: 0.7 },
      { category: 'bakery_bread', clue: dept('bakery'), confidence: 0.7 },
      { category: 'deli', clue: { kind: 'wall', wall: 'back', part: 'right', temp: 'chilled' }, confidence: 0.6 },
      { category: 'frozen', clue: dept('frozen'), confidence: 0.7 },
      { category: 'household_cleaning', clue: { kind: 'shelf', code: 'A5', section: 'A', shelf: 5 }, confidence: 0.5 },
      { category: 'paper_goods', clue: { kind: 'shelf', code: 'A8', section: 'A', shelf: 8 }, confidence: 0.55 },
      { category: 'personal_care', clue: { kind: 'shelf', code: 'A12', section: 'A', shelf: 12 }, confidence: 0.45 },
      { category: 'baby', clue: { kind: 'shelf', code: 'A15', section: 'A', shelf: 15 }, confidence: 0.4 },
      { category: 'pet', clue: { kind: 'shelf', code: 'A18', section: 'A', shelf: 18 }, confidence: 0.4 },
      { category: 'spices_seasonings', clue: { kind: 'shelf', code: 'B4', section: 'B', shelf: 4 }, confidence: 0.45 },
      { category: 'condiments_sauces', clue: { kind: 'shelf', code: 'B7', section: 'B', shelf: 7 }, confidence: 0.5 },
      { category: 'canned_jarred', clue: { kind: 'shelf', code: 'B10', section: 'B', shelf: 10 }, confidence: 0.55 },
      { category: 'baking', clue: { kind: 'shelf', code: 'C3', section: 'C', shelf: 3 }, confidence: 0.45 },
      { category: 'pasta_rice_grains', clue: { kind: 'shelf', code: 'C5', section: 'C', shelf: 5 }, confidence: 0.5 },
      { category: 'breakfast_cereal', clue: { kind: 'shelf', code: 'C8', section: 'C', shelf: 8 }, confidence: 0.5 },
      { category: 'international', clue: { kind: 'shelf', code: 'C12', section: 'C', shelf: 12 }, confidence: 0.4 },
      { category: 'snacks', clue: { kind: 'shelf', code: 'D6', section: 'D', shelf: 6 }, confidence: 0.55 },
      { category: 'beverages', clue: { kind: 'shelf', code: 'D10', section: 'D', shelf: 10 }, confidence: 0.6 },
      { category: 'beer_wine', clue: { kind: 'open', near: 'middle', fixture: 'stand' }, confidence: 0.4 },
    ],
    hints: [{ rule: { kind: 'usesShelfLabels' }, weight: 0.9 }],
    sources: ['theproducenews.com: The Costco shopping experience', 'thekitchn.com: Costco explained'],
  },
];

export const DEFAULT_TEMPLATE_ID = 'conventional';

export const templateById = (id?: string) => STORE_TEMPLATES.find((t) => t.id === id);
