/**
 * The order things were picked up in, trip by trip, per store. Later this
 * tells us which way shoppers walk (where the entrance is, which way the
 * aisles are numbered). Kept on this phone only.
 */

export interface Pick {
  /** Master-list item, or the name if it isn't on the master list. */
  productId?: string;
  name: string;
  /** When it was checked off (ms). */
  at: number;
}

export interface Trip {
  layoutId: string;
  start: number;
  picks: Pick[];
}

/** A gap this long between check-offs starts a new trip. */
export const TRIP_GAP = 3 * 60 * 60 * 1000;
/** Trips kept per store. */
export const TRIPS_KEPT = 30;

/** Adds a check-off to the store's current trip, starting a new trip after a long gap. */
export function recordPick(trips: Trip[], layoutId: string, pick: Pick): Trip[] {
  const mine = trips.filter((t) => t.layoutId === layoutId);
  const last = mine[mine.length - 1];
  const lastAt = last?.picks[last.picks.length - 1]?.at ?? last?.start;
  let next: Trip[];
  if (last && lastAt !== undefined && pick.at - lastAt < TRIP_GAP) {
    next = trips.map((t) => (t === last ? { ...t, picks: [...t.picks.filter((p) => p.name !== pick.name), pick] } : t));
  } else {
    next = [...trips, { layoutId, start: pick.at, picks: [pick] }];
  }
  // Keep the most recent trips for each store.
  const counts = new Map<string, number>();
  return next.reverse().filter((t) => {
    const n = (counts.get(t.layoutId) ?? 0) + 1;
    counts.set(t.layoutId, n);
    return n <= TRIPS_KEPT;
  }).reverse();
}

/** Starts a new trip at this store now (e.g. the cart was cleared), even if the last check-off was recent. */
export function startTrip(trips: Trip[], layoutId: string, at: number): Trip[] {
  const mine = trips.filter((t) => t.layoutId === layoutId);
  const last = mine[mine.length - 1];
  if (last && !last.picks.length) return trips;
  return [...trips, { layoutId, start: at, picks: [] }];
}

/** Takes back a check-off (unticked by mistake) from the store's latest trip. */
export function unrecordPick(trips: Trip[], layoutId: string, name: string): Trip[] {
  const mine = trips.filter((t) => t.layoutId === layoutId);
  const last = mine[mine.length - 1];
  if (!last) return trips;
  return trips.map((t) => (t === last ? { ...t, picks: t.picks.filter((p) => p.name !== name) } : t)).filter((t) => t.picks.length);
}

/** Something bought before, for "Buy again". */
export interface Usual {
  productId?: string;
  name: string;
  /** Trips it was bought on. */
  count: number;
  /** When it was last bought (ms). */
  last: number;
}

/**
 * Things bought before, most likely to be wanted again first: how many
 * trips they were on, with a boost for the last few trips (all stores).
 */
export function usuals(trips: Trip[], limit = 24): Usual[] {
  const byName = new Map<string, Usual & { score: number }>();
  const recent = [...trips].sort((a, b) => b.start - a.start);
  recent.forEach((t, rank) => {
    const seen = new Set<string>();
    for (const p of t.picks) {
      const key = p.productId ?? p.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const u = byName.get(key) ?? { ...(p.productId && { productId: p.productId }), name: p.name, count: 0, last: 0, score: 0 };
      u.count++;
      u.last = Math.max(u.last, p.at);
      // Each trip counts 1; the last three count a bit more.
      u.score += 1 + (rank < 3 ? (3 - rank) * 0.5 : 0);
      byName.set(key, u);
    }
  });
  return [...byName.values()]
    .sort((a, b) => b.score - a.score || b.last - a.last)
    .slice(0, limit)
    .map(({ score: _score, ...u }) => u);
}
