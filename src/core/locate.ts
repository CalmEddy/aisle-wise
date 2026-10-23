import { categories, categoryById, type Category } from './categories';
import { spotPoint } from './geometry';
import type { Learned, ListItem, Spot, Stop, StoreLayout } from './types';

/** Lowercases, strips punctuation and numbers, and singularises each word. */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(' ');
}

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (/(ches|shes|xes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('ss')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

const keywordIndex = categories
  .flatMap((cat) => cat.keywords.map((k) => ({ keyword: normalize(k), cat })))
  .sort((a, b) => b.keyword.length - a.keyword.length);

/** The category an item belongs to. The longest matching keyword wins, so "almond milk" is Dairy. */
export function matchCategory(itemName: string): Category | undefined {
  const padded = ` ${normalize(itemName)} `;
  return keywordIndex.find(({ keyword }) => padded.includes(` ${keyword} `))?.cat;
}

/** Turns a spot key (`placeId` or `placeId:categoryId`) into a spot in this layout. */
export function resolveSpot(key: string, layout: StoreLayout): Spot | undefined {
  const [placeId, categoryId] = key.split(':');
  const place = layout.places.find((p) => p.id === placeId);
  if (!place) return undefined;
  const index = categoryId ? place.categories.indexOf(categoryId) : -1;
  if (index < 0) return { key: place.id, placeId: place.id, label: place.label, point: spotPoint(place) };
  const cat = categoryById.get(categoryId);
  return {
    key,
    placeId: place.id,
    // Name the category only when it adds something ("Aisle 2 · Pasta & Rice", not "Bakery · Bakery").
    label: cat && place.categories.length > 1 && cat.name !== place.label ? `${place.label} · ${cat.name}` : place.label,
    point: spotPoint(place, index, place.categories.length),
  };
}

/**
 * Where to pick up an item: a spot the user taught for this layout,
 * otherwise wherever the layout stocks the item's category.
 */
export function locateItem(name: string, layout: StoreLayout, learned: Learned = {}): Spot | undefined {
  const taught = learned[normalize(name)];
  if (taught) {
    const spot = resolveSpot(taught, layout);
    if (spot) return spot;
  }
  const cat = matchCategory(name);
  if (!cat) return undefined;
  const place = layout.places.find((p) => p.categories.includes(cat.id));
  return place ? resolveSpot(`${place.id}:${cat.id}`, layout) : undefined;
}

/** Groups unchecked items by pick-up spot. Items with no spot are returned separately. */
export function groupIntoStops(
  items: ListItem[],
  locate: (item: ListItem) => Spot | undefined,
): { stops: Stop[]; unplaced: ListItem[] } {
  const byKey = new Map<string, Stop>();
  const unplaced: ListItem[] = [];
  for (const item of items) {
    if (item.done) continue;
    const spot = locate(item);
    if (!spot) {
      unplaced.push(item);
      continue;
    }
    const stop = byKey.get(spot.key) ?? { ...spot, items: [] };
    stop.items.push(item);
    byKey.set(spot.key, stop);
  }
  return { stops: [...byKey.values()], unplaced };
}
