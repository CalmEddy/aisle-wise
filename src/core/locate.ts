import type { Catalog } from './catalog';
import { categorySpot, describeExact, exactMark, exactPoint, parseExactKey, spotPoint } from './geometry';
import type { Clue, ListItem, Product, Spot, Stop, StoreLayout } from './types';
import { clueRank, resolveClue, typicalRank } from './clues';

export { normalize } from './catalog';

/** Turns a spot key (`placeId`, `placeId:categoryId` or `placeId@u,v`) into a spot in this layout. */
export function resolveSpot(key: string, layout: StoreLayout, catalog: Catalog): Spot | undefined {
  const exact = parseExactKey(key);
  if (exact) {
    const place = layout.places.find((p) => p.id === exact.placeId);
    if (!place) return undefined;
    const detail = describeExact(place, exact.spot);
    return {
      key,
      placeId: place.id,
      placeLabel: place.label,
      detail,
      label: `${place.label} · ${detail}`,
      point: exactPoint(place, exact.spot),
      mark: exactMark(place, exact.spot),
    };
  }

  const [placeId, categoryId] = key.split(':');
  const place = layout.places.find((p) => p.id === placeId);
  if (!place) return undefined;
  const at = categoryId ? categorySpot(place, categoryId) : undefined;
  if (!at) {
    const point = spotPoint(place);
    return { key: place.id, placeId: place.id, placeLabel: place.label, label: place.label, point, mark: { x: point.x + 0.5, y: point.y + 0.5 } };
  }
  const cat = catalog.categoryById.get(categoryId);
  // Name the category only when it adds something ("Aisle 2 · Pasta & Rice", not "Bakery · Bakery").
  const detail = cat && place.categories.length > 1 && cat.name !== place.label ? cat.name : undefined;
  return {
    key,
    placeId: place.id,
    placeLabel: place.label,
    detail,
    label: detail ? `${place.label} · ${detail}` : place.label,
    point: exactPoint(place, at),
    mark: exactMark(place, at),
  };
}

export type Location =
  | { kind: 'spot'; spot: Spot; product?: Product; /** True when the user set it, not inferred from the category. */ exact: boolean }
  | { kind: 'not-sold'; product: Product }
  /** The shopper said where it is ("aisle 7"), but the map has nothing to put it on yet. */
  | { kind: 'clue'; clue: Clue; product: Product }
  /** Nothing known for this store: where its category usually is in a supermarket. */
  | { kind: 'guess'; categoryId: string; product: Product }
  | { kind: 'unknown'; product?: Product };

/** Where to find a product in a store. */
export function locateProduct(product: Product, layout: StoreLayout, catalog: Catalog): Location {
  if (product.notAt?.includes(layout.id)) return { kind: 'not-sold', product };
  const saved = product.locations?.[layout.id];
  const savedSpot = saved && resolveSpot(saved, layout, catalog);
  if (savedSpot) return { kind: 'spot', spot: savedSpot, product, exact: true };
  // Where the shopper said it is: on the map if the map can place it, otherwise as said.
  const clue = product.clues?.[layout.id];
  if (clue) {
    const key = resolveClue(clue, layout, product);
    const spot = key ? resolveSpot(key, layout, catalog) : undefined;
    if (spot) return { kind: 'spot', spot, product, exact: true };
    return { kind: 'clue', clue, product };
  }
  const cat = product.categoryId;
  // (Testing aid) its place here was cleared: not placed until it's answered again.
  if (product.clearedAt?.includes(layout.id) || product.mapClues?.[layout.id]) return cat ? { kind: 'guess', categoryId: cat, product } : { kind: 'unknown', product };
  // Something of the same kind was said to be somewhere here: this is most likely beside it.
  // (Not a table or stand: those are displays of a few things, not where the kind lives.)
  if (cat) {
    for (const other of catalog.products) {
      if (other.id === product.id || other.categoryId !== cat) continue;
      const key = other.locations?.[layout.id] ?? (() => {
        const c = other.clues?.[layout.id];
        if (!c || (c.kind === 'open' && (c.across || c.fixture === 'stand' || c.fixture === 'table'))) return undefined;
        return resolveClue(c, layout, other);
      })();
      const spot = key ? resolveSpot(key, layout, catalog) : undefined;
      if (spot) return { kind: 'spot', spot, product, exact: false };
    }
  }
  const place = cat ? layout.places.find((p) => p.categories.includes(cat)) : undefined;
  const spot = place && resolveSpot(`${place.id}:${cat}`, layout, catalog);
  if (spot) return { kind: 'spot', spot, product, exact: false };
  return cat ? { kind: 'guess', categoryId: cat, product } : { kind: 'unknown', product };
}

/** The master-list item for a list entry. */
export function productFor(item: Pick<ListItem, 'name' | 'productId'>, catalog: Catalog): Product | undefined {
  return (item.productId && catalog.productById.get(item.productId)) || catalog.match(item.name);
}

export function locateItem(item: Pick<ListItem, 'name' | 'productId'>, layout: StoreLayout, catalog: Catalog): Location {
  const product = productFor(item, catalog);
  return product ? locateProduct(product, layout, catalog) : { kind: 'unknown' };
}

/**
 * Groups unchecked items by pick-up spot. Items whose spots fall on the same
 * square of the same shelf or area share a stop – e.g. tomato soup and
 * vegetable soup saved a hair apart are picked up together.
 */
export function groupIntoStops(items: ListItem[], locate: (item: ListItem) => Location) {
  const byKey = new Map<string, Stop>();
  const unplaced: ListItem[] = [];
  const notSold: ListItem[] = [];
  /**
   * Items the map can't place yet, in walking order: ones the shopper has said
   * where they are ("aisle 9"), and ones placed where their category usually is.
   */
  const byClue: { item: ListItem; rank: number; clue?: Clue; categoryId?: string }[] = [];
  for (const item of items) {
    if (item.done) continue;
    const loc = locate(item);
    if (loc.kind === 'not-sold') notSold.push(item);
    else if (loc.kind === 'unknown') unplaced.push(item);
    else if (loc.kind === 'clue') byClue.push({ item, clue: loc.clue, rank: clueRank(loc.clue) });
    else if (loc.kind === 'guess') byClue.push({ item, categoryId: loc.categoryId, rank: typicalRank(loc.categoryId) });
    else {
      const square = `${loc.spot.placeId}#${loc.spot.point.x},${loc.spot.point.y}`;
      const stop = byKey.get(square) ?? { ...loc.spot, items: [] };
      stop.items.push(item);
      byKey.set(square, stop);
    }
  }
  byClue.sort((a, b) => a.rank - b.rank);
  return { stops: [...byKey.values()], unplaced, notSold, byClue };
}
