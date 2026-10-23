import { walkDistance } from './distance';
import type { ListItem, Point, Section, Stop, StoreLayout } from './types';

/** Above this many stops we switch from an exact solve to a heuristic. */
const EXACT_LIMIT = 12;

/**
 * Orders the stops so that walking from `start`, visiting every stop, and
 * ending at the checkout is as short as possible.
 */
export function planRoute(
  start: Point,
  stops: Stop[],
  store: StoreLayout,
): Stop[] {
  if (stops.length <= 1) return stops;

  const points = stops.map((s) => s.section.point);
  const order =
    stops.length <= EXACT_LIMIT
      ? exactOrder(start, points, store.checkout, store)
      : heuristicOrder(start, points, store.checkout, store);
  return order.map((i) => stops[i]);
}

/** Groups unchecked items by their section. Items without a section are returned separately. */
export function groupIntoStops(
  items: ListItem[],
  locate: (item: ListItem) => Section | undefined,
): { stops: Stop[]; unplaced: ListItem[] } {
  const bySection = new Map<string, Stop>();
  const unplaced: ListItem[] = [];
  for (const item of items) {
    if (item.done) continue;
    const section = locate(item);
    if (!section) {
      unplaced.push(item);
      continue;
    }
    const stop = bySection.get(section.id) ?? { section, items: [] };
    stop.items.push(item);
    bySection.set(section.id, stop);
  }
  return { stops: [...bySection.values()], unplaced };
}

export function routeLength(start: Point, stops: Stop[], store: StoreLayout): number {
  let total = 0;
  let here = start;
  for (const s of stops) {
    total += walkDistance(here, s.section.point, store);
    here = s.section.point;
  }
  return total + walkDistance(here, store.checkout, store);
}

/** Held–Karp dynamic programming: exact shortest open path start → all → end. */
function exactOrder(start: Point, pts: Point[], end: Point, store: StoreLayout): number[] {
  const n = pts.length;
  const d = (a: Point, b: Point) => walkDistance(a, b, store);
  const full = (1 << n) - 1;
  const cost: Float64Array[] = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(Infinity));
  const prev: Int8Array[] = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));

  for (let i = 0; i < n; i++) cost[1 << i][i] = d(start, pts[i]);

  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < n; last++) {
      const c = cost[mask][last];
      if (!(mask & (1 << last)) || c === Infinity) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const nm = mask | (1 << next);
        const nc = c + d(pts[last], pts[next]);
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

/** Nearest-neighbour tour improved with 2-opt. Good enough for big lists. */
function heuristicOrder(start: Point, pts: Point[], end: Point, store: StoreLayout): number[] {
  const d = (a: Point, b: Point) => walkDistance(a, b, store);
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
