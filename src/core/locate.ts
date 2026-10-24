import type { Catalog } from './catalog';
import { spotPoint } from './geometry';
import type { ListItem, Product, Spot, Stop, StoreLayout } from './types';

export { normalize } from './catalog';

/** Turns a spot key (`placeId` or `placeId:categoryId`) into a spot in this layout. */
export function resolveSpot(key: string, layout: StoreLayout, catalog: Catalog): Spot | undefined {
  const [placeId, categoryId] = key.split(':');
  const place = layout.places.find((p) => p.id === placeId);
  if (!place) return undefined;
  const index = categoryId ? place.categories.indexOf(categoryId) : -1;
  if (index < 0) return { key: place.id, placeId: place.id, label: place.label, point: spotPoint(place) };
  const cat = catalog.categoryById.get(categoryId);
  return {
    key,
    placeId: place.id,
    // Name the category only when it adds something ("Aisle 2 · Pasta & Rice", not "Bakery · Bakery").
    label: cat && place.categories.length > 1 && cat.name !== place.label ? `${place.label} · ${cat.name}` : place.label,
    point: spotPoint(place, index, place.categories.length),
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

/** Groups unchecked items by pick-up spot. */
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
      const stop = byKey.get(loc.spot.key) ?? { ...loc.spot, items: [] };
      stop.items.push(item);
      byKey.set(loc.spot.key, stop);
    }
  }
  return { stops: [...byKey.values()], unplaced, notSold };
}
