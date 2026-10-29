import type { GeoPoint, StoreLayout } from './types';

/** Metres between two places (haversine). */
export function metresBetween(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** How far to trust "you're at this store": a big store's car park is about this wide. */
export const AT_STORE_METRES = 250;

/** Stores sorted nearest first (ones without a location last, in their usual order), with distances. */
export function storesByDistance(layouts: StoreLayout[], here?: GeoPoint): { layout: StoreLayout; metres?: number }[] {
  const rows = layouts.map((layout) => ({ layout, metres: here && layout.geo ? metresBetween(here, layout.geo) : undefined }));
  return rows.sort((a, b) => (a.metres ?? Infinity) - (b.metres ?? Infinity));
}

/** The store you're at, if one with a saved location is close enough. */
export function storeHere(layouts: StoreLayout[], here: GeoPoint, within = AT_STORE_METRES): StoreLayout | undefined {
  const [nearest] = storesByDistance(layouts, here);
  return nearest?.metres !== undefined && nearest.metres <= within ? nearest.layout : undefined;
}

/** "120 m", "1.4 km". */
export function distanceText(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
