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

/** Above this many places, grouped routes use a heuristic instead of an exact solve. */
const EXACT_GROUPS = 12;

/**
 * Plans a route that never splits a place: all the stops on one shelf (or in
 * one area) are picked up in a single pass, walked end to end. `along` puts
 * a place's stops in order (e.g. top to bottom of a shelf); each place can be
 * walked in either direction. Only the order of places, and which way each is
 * walked, is optimised.
 */
export function planGroupedRoute<T extends { point: Point; placeId: string }>(
  start: Point, stops: T[], end: Point, d: Distance, along: (stop: T) => number,
  /** Most places to solve exactly (tests compare the quick way with the exact one). */
  exactUpTo = EXACT_GROUPS,
): T[] {
  const byPlace = new Map<string, T[]>();
  for (const s of stops) byPlace.set(s.placeId, [...(byPlace.get(s.placeId) ?? []), s]);
  const paths = [...byPlace.values()].map((g) => [...g].sort((a, b) => along(a) - along(b)));
  const n = paths.length;
  if (n === 0) return [];

  const inner = paths.map((p) => p.slice(1).reduce((sum, s, i) => sum + d(p[i].point, s.point), 0));
  const first = (i: number, o: number) => (o ? paths[i][paths[i].length - 1] : paths[i][0]).point;
  const last = (i: number, o: number) => (o ? paths[i][0] : paths[i][paths[i].length - 1]).point;
  const walk = (order: [number, number][]) => order.flatMap(([i, o]) => (o ? [...paths[i]].reverse() : paths[i]));

  if (n > exactUpTo) {
    // Nearest place next, entering at whichever end is closer.
    const left = new Set(paths.map((_, i) => i));
    let order: [number, number][] = [];
    let here = start;
    while (left.size) {
      let best: [number, number] = [-1, 0];
      let bestD = Infinity;
      for (const i of left) {
        for (const o of [0, 1]) {
          const dist = d(here, first(i, o));
          if (dist < bestD) {
            bestD = dist;
            best = [i, o];
          }
        }
      }
      order.push(best);
      left.delete(best[0]);
      here = last(best[0], best[1]);
    }
    // Then tidy it: nearest-next strands things (aisle 9, 11, then back to 7). Reverse a stretch,
    // or move a stretch of one to three places elsewhere (either way round), whenever the walk gets shorter.
    const length = (o: [number, number][]) => {
      let total = 0;
      let at = start;
      for (const [i, w] of o) { total += d(at, first(i, w)); at = last(i, w); }
      return total + d(at, end);
    };
    const flip = (seg: [number, number][]) => seg.reverse().map(([i, w]) => [i, 1 - w] as [number, number]);
    let best = length(order);
    for (let round = 0; round < 50; round++) {
      let improved = false;
      for (let a = 0; a < n - 1; a++) {
        for (let b = a + 1; b < n; b++) {
          const next = [...order.slice(0, a), ...flip(order.slice(a, b + 1)), ...order.slice(b + 1)];
          const len = length(next);
          if (len < best - 1e-9) { order = next; best = len; improved = true; }
        }
      }
      for (let k = 1; k <= 3; k++) {
        for (let a = 0; a + k <= n; a++) {
          const seg = order.slice(a, a + k);
          const rest = [...order.slice(0, a), ...order.slice(a + k)];
          for (let at = 0; at <= rest.length; at++) {
            if (at === a) continue;
            for (const piece of [seg, flip([...seg])]) {
              const next = [...rest.slice(0, at), ...piece, ...rest.slice(at)];
              const len = length(next);
              if (len < best - 1e-9) { order = next; best = len; improved = true; break; }
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (!improved) break;
    }
    return walk(order);
  }

  // Held–Karp over places, with the direction each is walked as part of the state.
  const full = (1 << n) - 1;
  const cost = Array.from({ length: 1 << n }, () => new Float64Array(n * 2).fill(Infinity));
  const prev = Array.from({ length: 1 << n }, () => new Int16Array(n * 2).fill(-1));
  for (let i = 0; i < n; i++) {
    for (const o of [0, 1]) cost[1 << i][i * 2 + o] = d(start, first(i, o)) * legWeight(0, n) + inner[i];
  }
  for (let mask = 1; mask <= full; mask++) {
    const w = legWeight(popcount(mask), n);
    for (let s = 0; s < n * 2; s++) {
      const c = cost[mask][s];
      const i = s >> 1;
      if (!(mask & (1 << i)) || c === Infinity) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        for (const o of [0, 1]) {
          const nm = mask | (1 << j);
          const nc = c + d(last(i, s & 1), first(j, o)) * w + inner[j];
          if (nc < cost[nm][j * 2 + o]) {
            cost[nm][j * 2 + o] = nc;
            prev[nm][j * 2 + o] = s;
          }
        }
      }
    }
  }
  let best = 0;
  let bestCost = Infinity;
  for (let s = 0; s < n * 2; s++) {
    const c = cost[full][s] + d(last(s >> 1, s & 1), end);
    if (c < bestCost) {
      bestCost = c;
      best = s;
    }
  }
  const order: [number, number][] = [];
  let mask = full;
  let cur = best;
  while (cur !== -1) {
    order.push([cur >> 1, cur & 1]);
    const p = prev[mask][cur];
    mask &= ~(1 << (cur >> 1));
    cur = p;
  }
  return walk(order.reverse());
}
