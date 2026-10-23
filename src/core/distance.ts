import type { Point, StoreLayout } from './types';

/**
 * Walking distance between two points in a store with parallel aisles.
 *
 * Shoppers can walk along the front cross-aisle (y = 0), the back cross-aisle
 * (y = depth), and up/down any aisle. Two points in the same aisle are a
 * straight walk apart; otherwise you leave by the front or the back,
 * whichever is shorter, and walk across.
 */
export function walkDistance(a: Point, b: Point, store: Pick<StoreLayout, 'depth' | 'aisleXs'>): number {
  const sameCorridor = a.x === b.x && store.aisleXs.includes(a.x);
  if (sameCorridor) return Math.abs(a.y - b.y);

  const viaFront = a.y + b.y;
  const viaBack = store.depth - a.y + (store.depth - b.y);
  return Math.min(viaFront, viaBack) + Math.abs(a.x - b.x);
}
