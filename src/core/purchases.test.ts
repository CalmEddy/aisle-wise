import { describe, expect, it } from 'vitest';
import { addPurchases, ago, buyAgain, purchasesFromCart, PURCHASE_KEEP_DAYS, type Purchase } from './purchases';
import type { ListItem } from './types';

const DAY = 24 * 60 * 60 * 1000;
const buy = (tripId: string, daysAgo: number, now: number, ...names: string[]): Purchase[] =>
  names.map((name) => ({ id: `${tripId}-${name}`, productId: name.toLowerCase(), name, tripId, at: now - daysAgo * DAY, storeName: 'Corner Market' }));

describe('recording purchases', () => {
  it('makes one purchase per cart row, all on the same trip', () => {
    const cart: ListItem[] = [
      { id: 'a', name: 'Milk', done: true, productId: 'milk', qty: 2, price: 3.5 },
      { id: 'b', name: 'Tea', done: true },
    ];
    const made = purchasesFromCart(cart, { id: 's1', name: 'Corner Market' }, 1000);
    expect(made).toHaveLength(2);
    expect(new Set(made.map((p) => p.tripId)).size).toBe(1);
    expect(new Set(made.map((p) => p.id)).size).toBe(2);
    expect(made[0]).toMatchObject({ productId: 'milk', qty: 2, price: 3.5, storeId: 's1', storeName: 'Corner Market', at: 1000 });
    expect(made[1]).not.toHaveProperty('qty');
  });

  it('drops purchases older than the keep window', () => {
    const now = 1000 * DAY;
    const old = buy('old', PURCHASE_KEEP_DAYS + 5, now, 'Milk');
    const fresh = buy('new', 1, now, 'Milk');
    expect(addPurchases(old, fresh, now).map((p) => p.tripId)).toEqual(['new']);
  });
});

describe('buy again', () => {
  const now = 100 * DAY;

  it('finds items due by their usual rhythm, most overdue first', () => {
    const p = [
      ...buy('t1', 30, now, 'Milk', 'Eggs'),
      ...buy('t2', 23, now, 'Milk'),
      ...buy('t3', 16, now, 'Milk', 'Eggs'),
      ...buy('t4', 9, now, 'Milk', 'Bread'),
    ];
    const r = buyAgain(p, now);
    // Milk every 7 days, last 9 days ago → due. Eggs every 14, last 16 ago → due (more overdue ratio).
    expect(r.due.map((u) => u.name)).toEqual(['Milk', 'Eggs']);
    expect(r.due[0]).toMatchObject({ intervalDays: 7, count: 4, due: true });
    // Bread was bought once: no rhythm, not often.
    expect(r.due.concat(r.often).some((u) => u.name === 'Bread')).toBe(false);
  });

  it('lists often-bought items that are not due, most trips first, without repeating due ones', () => {
    const p = [
      ...buy('t1', 20, now, 'Rice', 'Salt', 'Milk'),
      ...buy('t2', 10, now, 'Rice', 'Milk'),
      ...buy('t3', 2, now, 'Rice', 'Salt', 'Milk'),
    ];
    const r = buyAgain(p, now);
    // Everything was bought 2 days ago on a ~10-day rhythm: nothing due.
    expect(r.due).toEqual([]);
    expect(r.often.map((u) => u.name).slice(0, 2).sort()).toEqual(['Milk', 'Rice']);
    expect(r.often[2]).toMatchObject({ name: 'Salt', count: 2 });
  });

  it('shows everything from the most recent trip, with its date and store', () => {
    const p = [...buy('t1', 9, now, 'Milk'), ...buy('t2', 3, now, 'Tea', 'Bread', 'Tea')];
    const r = buyAgain(p, now);
    expect(r.lastTrip.map((u) => u.name)).toEqual(['Bread', 'Tea']);
    expect(r.lastTripAt).toBe(now - 3 * DAY);
    expect(r.lastTripStore).toBe('Corner Market');
  });

  it('matches typed-only items by name and returns nothing for no history', () => {
    const named = (tripId: string, d: number, name: string): Purchase => ({ id: `${tripId}-${name}`, name, tripId, at: now - d * DAY });
    const r = buyAgain([named('a', 8, 'Dragon fruit'), named('b', 1, 'dragon fruit')], now);
    expect(r.often).toHaveLength(1);
    expect(r.often[0]).toMatchObject({ count: 2, name: 'dragon fruit' });
    expect(buyAgain([], now)).toEqual({ due: [], often: [], lastTrip: [] });
  });

  it('says how long ago', () => {
    expect(ago(100 * DAY, 100 * DAY)).toBe('today');
    expect(ago(99 * DAY, 100 * DAY)).toBe('yesterday');
    expect(ago(95 * DAY, 100 * DAY)).toBe('5 days ago');
    expect(ago(70 * DAY, 100 * DAY)).toBe('4 weeks ago');
    expect(ago(0, 100 * DAY)).toBe('3 months ago');
  });
});
