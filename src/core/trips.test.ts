import { describe, expect, it } from 'vitest';
import { TRIP_GAP, TRIPS_KEPT, recordPick, startTrip, unrecordPick, type Trip } from './trips';

describe('trip log', () => {
  it('groups check-offs into trips per store, in order', () => {
    let t: Trip[] = [];
    t = recordPick(t, 's', { name: 'Apples', at: 1000 });
    t = recordPick(t, 's', { name: 'Bread', at: 2000 });
    t = recordPick(t, 'other', { name: 'Milk', at: 2500 });
    t = recordPick(t, 's', { name: 'Milk', at: 3000 });
    expect(t.filter((x) => x.layoutId === 's').map((x) => x.picks.map((p) => p.name))).toEqual([['Apples', 'Bread', 'Milk']]);
    t = recordPick(t, 's', { name: 'Eggs', at: 3000 + TRIP_GAP + 1 });
    expect(t.filter((x) => x.layoutId === 's')).toHaveLength(2);
    // Re-ticking moves it to the end; unticking removes it.
    t = recordPick(t, 's', { name: 'Eggs', at: 3000 + TRIP_GAP + 5 });
    expect(t[t.length - 1].picks.map((p) => p.name)).toEqual(['Eggs']);
    t = unrecordPick(t, 's', 'Eggs');
    expect(t.filter((x) => x.layoutId === 's')).toHaveLength(1);
  });

  it('a cleared cart starts a new trip straight away', () => {
    let t: Trip[] = recordPick([], 's', { name: 'Apples', at: 1000 });
    t = startTrip(t, 's', 2000);
    t = startTrip(t, 's', 2001); // no empty duplicates
    t = recordPick(t, 's', { name: 'Apples', at: 3000 });
    expect(t.map((x) => x.picks.map((p) => p.name))).toEqual([['Apples'], ['Apples']]);
  });

  it('keeps only recent trips', () => {
    let t: Trip[] = [];
    for (let i = 0; i < TRIPS_KEPT + 5; i++) t = recordPick(t, 's', { name: 'x', at: i * (TRIP_GAP + 1) });
    expect(t).toHaveLength(TRIPS_KEPT);
    expect(t[0].start).toBe(5 * (TRIP_GAP + 1));
  });
});

describe('buy again', () => {
  it('puts things bought often and lately first', async () => {
    const { usuals } = await import('./trips');
    const trip = (start: number, names: string[]) => ({ layoutId: 'a', start, picks: names.map((name, i) => ({ productId: name.toLowerCase(), name, at: start + i })) });
    const trips = [
      trip(1, ['Milk', 'Bread', 'Eggs']),
      trip(2, ['Milk', 'Bread']),
      trip(3, ['Milk', 'Bread']),
      trip(4, ['Milk']),
      trip(5, ['Milk', 'Candles']),
      { layoutId: 'b', start: 6, picks: [{ name: 'Tea', at: 6 }] },
    ];
    const u = usuals(trips);
    expect(u.map((x) => x.name)).toEqual(['Milk', 'Bread', 'Tea', 'Candles', 'Eggs']);
    expect(u[0]).toMatchObject({ productId: 'milk', count: 5, last: 5 });
    expect(usuals(trips, 2)).toHaveLength(2);
  });
});
