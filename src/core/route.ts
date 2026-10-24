import type { Point } from './types';

export type Distance = (a: Point, b: Point) => number;

/** Above this many stops we switch from an exact solve to a heuristic. */
const EXACT_LIMIT = 12;

/**
 * Tie-breaker. Many routes through a store are exactly the same length
 * (walking on a grid, and every route ends at the checkout). Among those,
 * shoppers expect the nearest stop first, so earlier legs are weighted a
 * hair more than later ones. The weight is far too small to ever pick a
 * route that is actually longer.
 */
const EARLY = 1e-6;
const legWeight = (leg: number, n: number) => 1 + EARLY * (n - leg);

/**
 * Orders the stops so that walking from `start`, visiting every stop, and
 * ending at `end` (the checkout) is as short as possible.
 */
export function planRoute<T extends { point: Point }>(start: Point, stops: T[], end: Point, dist: Distance): T[] {
  if (stops.length <= 1) return stops;
  const pts = stops.map((s) => s.point);
  const order = stops.length <= EXACT_LIMIT ? exactOrder(start, pts, end, dist) : heuristicOrder(start, pts, end, dist);
  return order.map((i) => stops[i]);
}

export function routeLength(start: Point, stops: { point: Point }[], end: Point, dist: Distance): number {
  let total = 0;
  let here = start;
  for (const s of stops) {
    total += dist(here, s.point);
    here = s.point;
  }
  return total + dist(here, end);
}

/** Held–Karp dynamic programming: exact shortest open path start → all → end. */
function exactOrder(start: Point, pts: Point[], end: Point, d: Distance): number[] {
  const n = pts.length;
  const m = pts.map((a) => pts.map((b) => d(a, b)));
  const full = (1 << n) - 1;
  const cost = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(Infinity));
  const prev = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));

  for (let i = 0; i < n; i++) cost[1 << i][i] = d(start, pts[i]) * legWeight(0, n);

  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      const c = cost[mask][last];
      if (!(mask & (1 << last)) || c === Infinity) continue;
      const w = legWeight(popcount(mask), n);
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nm = mask | (1 << next);
        const nc = c + m[last][next] * w;
        if (nc < cost[nm][next]) {
          cost[nm][next] = nc;
          prev[nm][next] = last;
        }
      }
    }
  }

  let best = 0;
  let bestCost = Infinity;
  for (let i = 0; i < n; i++) {
    const c = cost[full][i] + d(pts[i], end);
    if (c < bestCost) {
      bestCost = c;
      best = i;
    }
  }

  const order: number[] = [];
  let mask = full;
  let cur = best;
  while (cur !== -1) {
    order.push(cur);
    const p = prev[mask][cur];
    mask &= ~(1 << cur);
    cur = p;
  }
  return order.reverse();
}

function popcount(x: number): number {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
}

/** Nearest-neighbour tour improved with 2-opt. Good enough for big lists. */
function heuristicOrder(start: Point, pts: Point[], end: Point, d: Distance): number[] {
  const remaining = new Set(pts.map((_, i) => i));
  const order: number[] = [];
  let here = start;
  while (remaining.size) {
    let best = -1;
    let bestD = Infinity;
    for (const i of remaining) {
      const dist = d(here, pts[i]);
      if (dist < bestD) {
        bestD = dist;
        best = i;
      }
    }
    order.push(best);
    remaining.delete(best);
    here = pts[best];
  }

  const at = (k: number) => (k < 0 ? start : k >= order.length ? end : pts[order[k]]);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const before = d(at(i - 1), at(i)) + d(at(j), at(j + 1));
        const after = d(at(i - 1), at(j)) + d(at(i), at(j + 1));
        if (after < before - 1e-9) {
          order.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return order;
}

/** One numbered stop on the shopping route: a place, with the pick-up spots in it in walking order. */
export interface Visit<T extends { placeId: string }> {
  number: number;
  placeId: string;
  stops: T[];
}

/**
 * Groups a planned route into visits: back-to-back stops in the same aisle
 * or area share one number, so a busy aisle shows as "3" with several items
 * rather than "3, 4, 5, 6".
 */
export function groupVisits<T extends { placeId: string }>(route: T[]): Visit<T>[] {
  const visits: Visit<T>[] = [];
  for (const stop of route) {
    const last = visits[visits.length - 1];
    if (last && last.placeId === stop.placeId) last.stops.push(stop);
    else visits.push({ number: visits.length + 1, placeId: stop.placeId, stops: [stop] });
  }
  return visits;
}
