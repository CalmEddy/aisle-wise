import type { Catalog } from './catalog';
import { locateProduct } from './locate';
import type { Trip } from './trips';
import type { StoreLayout } from './types';

/**
 * Where the door is along the front of a store built from answers. It starts
 * in the middle; the first things picked up on each trip are near the door,
 * so they make a good guess, and the shopper confirms it once with a tap.
 */

/** The spots offered along the front: left to right. */
export const DOOR_SPOTS = [0.1, 0.3, 0.5, 0.7, 0.9];
export const DOOR_NAMES = ['Left end', 'Left of middle', 'Middle', 'Right of middle', 'Right end'];

/** Where trips here tend to start, 0 (left) to 1 (right): the average spot of each trip's first pick-up the map can place. */
export function guessDoor(layout: StoreLayout, trips: Trip[], catalog: Catalog): number | undefined {
  const xs: number[] = [];
  for (const t of trips.filter((x) => x.layoutId === layout.id)) {
    for (const p of t.picks.slice(0, 2)) {
      const product = (p.productId && catalog.productById.get(p.productId)) || catalog.match(p.name);
      const at = product && locateProduct(product, layout, catalog);
      if (at?.kind === 'spot') { xs.push(at.spot.point.x / Math.max(1, layout.width - 1)); break; }
    }
  }
  if (!xs.length) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** The spot nearest a guess. */
export const nearestSpot = (f: number) => DOOR_SPOTS.reduce((best, s) => (Math.abs(s - f) < Math.abs(best - f) ? s : best), DOOR_SPOTS[0]);

/**
 * Whether to ask where the door is (once per store, after a trip with a few
 * pick-ups the map can place), and the likely spot.
 */
export function doorQuestion(layout: StoreLayout, trips: Trip[], catalog: Catalog): { guess: number } | undefined {
  const gen = layout.gen;
  if (!gen?.enabled || gen.sure?.includes('entrance') || gen.skipped?.includes('entrance')) return undefined;
  const mine = trips.filter((t) => t.layoutId === layout.id);
  if (!mine.some((t) => t.picks.length >= 3)) return undefined;
  const g = guessDoor(layout, trips, catalog);
  return g === undefined ? undefined : { guess: nearestSpot(g) };
}
