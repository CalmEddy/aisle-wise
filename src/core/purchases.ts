import type { ItemUnit, ListItem } from './types';

/**
 * One thing bought on one trip. Written when the cart is cleared (the trip
 * is over), one per product, and shared with the household. This is the
 * record "Buy again" is built from.
 */
export interface Purchase {
  id: string;
  /** Master-list item, or missing if it was only ever a typed name. */
  productId?: string;
  name: string;
  qty?: number;
  unit?: ItemUnit;
  /** Price for one unit, if it was entered. */
  price?: number;
  /** The store it was bought at. */
  storeId?: string;
  storeName?: string;
  /** Everything bought when the cart was cleared shares a trip id. */
  tripId: string;
  /** When the cart was cleared (ms). */
  at: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Purchases older than this are dropped (long enough to learn a yearly buy). */
export const PURCHASE_KEEP_DAYS = 400;
/** Hard cap, newest kept. */
export const PURCHASE_KEEP_MAX = 2500;

const newId = () => Math.random().toString(36).slice(2, 10);

/** The purchases made by clearing a cart holding `cart` (one per row). */
export function purchasesFromCart(
  cart: ListItem[],
  store: { id?: string; name?: string },
  at: number,
  productIdOf: (i: ListItem) => string | undefined = (i) => i.productId,
): Purchase[] {
  const tripId = `t-${at.toString(36)}-${newId()}`;
  return cart.map((i) => {
    const productId = productIdOf(i);
    return {
      id: `p-${tripId}-${i.id}`,
      ...(productId && { productId }),
      name: i.name,
      ...(i.qty && i.qty > 1 && { qty: i.qty }),
      ...(i.unit && { unit: i.unit }),
      ...(i.price !== undefined && { price: i.price }),
      ...(store.id && { storeId: store.id }),
      ...(store.name && { storeName: store.name }),
      tripId,
      at,
    };
  });
}

/** Adds purchases and drops the oldest ones (by age, then by count). */
export function addPurchases(existing: Purchase[], added: Purchase[], now = Date.now()): Purchase[] {
  if (!added.length) return existing;
  const cutoff = now - PURCHASE_KEEP_DAYS * DAY_MS;
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const p of added) byId.set(p.id, p);
  return [...byId.values()]
    .filter((p) => p.at >= cutoff)
    .sort((a, b) => b.at - a.at)
    .slice(0, PURCHASE_KEEP_MAX);
}

/** A product bought before, with how often. */
export interface Usual {
  productId?: string;
  name: string;
  /** Trips it was bought on. */
  count: number;
  /** When it was last bought (ms). */
  last: number;
  /** How many the last time (missing means one). */
  qty?: number;
  unit?: ItemUnit;
  /** Median days between buys when bought on at least two trips. */
  intervalDays?: number;
  /** Past its usual interval. */
  due?: boolean;
}

export interface BuyAgain {
  /** Past their usual interval, most overdue first. */
  due: Usual[];
  /** Bought on several trips, most often first (not repeating `due`). */
  often: Usual[];
  /** Everything from the most recent trip. */
  lastTrip: Usual[];
  lastTripAt?: number;
  lastTripStore?: string;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const keyOf = (p: { productId?: string; name: string }) => p.productId ?? p.name.trim().toLowerCase();

/** A buy is "due" once this much of its usual interval has passed. */
const DUE_AT = 0.85;
/** At least this many trips to count as "often bought". */
export const OFTEN_MIN = 2;

/**
 * What to suggest buying again: items past their usual buying rhythm, items
 * bought on several trips, and everything from the last trip.
 */
export function buyAgain(purchases: Purchase[], now = Date.now(), limit = 12): BuyAgain {
  type Acc = Usual & { trips: Map<string, number>; lastQty?: number; lastUnit?: ItemUnit };
  const byKey = new Map<string, Acc>();
  for (const p of purchases) {
    const k = keyOf(p);
    const u: Acc = byKey.get(k) ?? { ...(p.productId && { productId: p.productId }), name: p.name, count: 0, last: 0, trips: new Map() };
    const seen = u.trips.get(p.tripId);
    u.trips.set(p.tripId, seen === undefined ? p.at : Math.max(seen, p.at));
    if (p.at >= u.last) {
      u.last = p.at;
      u.name = p.name;
      u.lastQty = p.qty;
      u.lastUnit = p.unit;
    }
    byKey.set(k, u);
  }
  const usuals: Usual[] = [...byKey.values()].map(({ trips, lastQty, lastUnit, ...u }) => {
    const times = [...trips.values()].sort((a, b) => a - b);
    let intervalDays: number | undefined;
    if (times.length >= 2) {
      const gaps = times.slice(1).map((t, i) => (t - times[i]!) / DAY_MS);
      intervalDays = Math.max(1, Math.round(median(gaps)));
    }
    const due = intervalDays !== undefined && now - u.last >= intervalDays * DAY_MS * DUE_AT;
    return {
      ...u,
      count: times.length,
      ...(lastQty && { qty: lastQty }),
      ...(lastUnit && { unit: lastUnit }),
      ...(intervalDays !== undefined && { intervalDays }),
      ...(due && { due: true }),
    };
  });
  const overdue = (u: Usual) => (now - u.last) / DAY_MS / (u.intervalDays ?? 1);
  const due = usuals.filter((u) => u.due).sort((a, b) => overdue(b) - overdue(a) || b.count - a.count).slice(0, limit);
  const dueKeys = new Set(due.map(keyOf));
  const often = usuals
    .filter((u) => u.count >= OFTEN_MIN && !dueKeys.has(keyOf(u)))
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit);

  // Most recent trip.
  const latest = purchases.reduce<Purchase | undefined>((m, p) => (!m || p.at > m.at ? p : m), undefined);
  const lastRows = latest ? purchases.filter((p) => p.tripId === latest.tripId) : [];
  const seen = new Set<string>();
  const lastTrip: Usual[] = [];
  for (const p of lastRows) {
    const k = keyOf(p);
    if (seen.has(k)) continue;
    seen.add(k);
    lastTrip.push({ ...usuals.find((u) => keyOf(u) === k)!, ...(p.qty && { qty: p.qty }), ...(p.unit && { unit: p.unit }) });
  }
  lastTrip.sort((a, b) => a.name.localeCompare(b.name));
  return { due, often, lastTrip, ...(latest && { lastTripAt: latest.at }), ...(latest?.storeName && { lastTripStore: latest.storeName }) };
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "2 months ago". */
export function ago(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / DAY_MS);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
