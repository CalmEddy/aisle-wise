import type { Catalog } from './catalog';
import { categorySpot, describeExact, exactMark, exactPoint, parseExactKey, spotPoint } from './geometry';
import type { ListItem, Product, Spot, Stop, StoreLayout } from './types';

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
  | { kind: 'unknown'; product?: Product };

/** Where to find a product in a store. */
export function locateProduct(product: Product, layout: StoreLayout, catalog: Catalog): Location {
  if (product.notAt?.includes(layout.id)) return { kind: 'not-sold', product };
  const saved = product.locations?.[layout.id];
  const savedSpot = saved && resolveSpot(saved, layout, catalog);
  if (savedSpot) return { kind: 'spot', spot: savedSpot, product, exact: true };
  const cat = product.categoryId;
  const place = cat ? layout.places.find((p) => p.categories.includes(cat)) : undefined;
  const spot = place && resolveSpot(`${place.id}:${cat}`, layout, catalog);
  return spot ? { kind: 'spot', spot, product, exact: false } : { kind: 'unknown', product };
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
  for (const item of items) {
    if (item.done) continue;
    const loc = locate(item);
    if (loc.kind === 'not-sold') notSold.push(item);
    else if (loc.kind === 'unknown') unplaced.push(item);
    else {
      const square = `${loc.spot.placeId}#${loc.spot.point.x},${loc.spot.point.y}`;
      const stop = byKey.get(square) ?? { ...loc.spot, items: [] };
      stop.items.push(item);
      byKey.set(square, stop);
    }
  }
  return { stops: [...byKey.values()], unplaced, notSold };
}
