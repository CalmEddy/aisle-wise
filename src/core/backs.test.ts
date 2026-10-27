import { describe, expect, it } from 'vitest';
import { Floor } from './floor';
import { shelfBacks } from './geometry';
import { checkLayout } from './validate';
import type { Shelf, StoreLayout } from './types';

const shelf = (id: string, x: number, y = 2, length = 6): Shelf =>
  ({ kind: 'shelf', id, label: id.toUpperCase(), x, y, orientation: 'vertical', length, categories: [] });
const store = (...places: Shelf[]): StoreLayout =>
  ({ id: 's', name: 'S', width: 14, height: 10, entrance: { x: 0, y: 9 }, checkout: { x: 13, y: 9 }, places } as StoreLayout);

describe('shelf backs', () => {
  it('a single shelf is reached from either side', () => {
    const f = new Floor(store(shelf('a', 5)));
    expect(f.distance({ x: 4, y: 5 }, { x: 5, y: 5 })).toBe(0);
    expect(f.distance({ x: 6, y: 5 }, { x: 5, y: 5 })).toBe(0);
    expect(shelfBacks(store(shelf('a', 5)), shelf('a', 5))).toEqual([]);
  });

  it("back-to-back shelves can't be reached through each other", () => {
    const l = store(shelf('a', 5), shelf('b', 6));
    const f = new Floor(l);
    expect(f.distance({ x: 4, y: 5 }, { x: 5, y: 5 })).toBe(0);
    // B's open side is on the right: walk round the end.
    expect(f.distance({ x: 4, y: 5 }, { x: 6, y: 5 })).toBeGreaterThan(5);
    expect(shelfBacks(l, l.places[0] as Shelf)).toEqual([{ x1: 6, y1: 2, x2: 6, y2: 8 }]);
    expect(shelfBacks(l, l.places[1] as Shelf)).toEqual([{ x1: 6, y1: 2, x2: 6, y2: 8 }]);
  });

  it('only the overlapping part has a back', () => {
    const l = store(shelf('a', 5), shelf('b', 6, 5, 6));
    expect(shelfBacks(l, l.places[0] as Shelf)).toEqual([{ x1: 6, y1: 5, x2: 6, y2: 8 }]);
    // A's top half is open on both sides.
    expect(new Floor(l).distance({ x: 7, y: 3 }, { x: 5, y: 3 })).toBe(1);
  });

  it('a shelf boxed in on both sides is reached from its ends, and the editor warns', () => {
    const l = store(shelf('a', 5), shelf('b', 6), shelf('c', 7));
    const f = new Floor(l);
    // Square 2 in from the top end: stand above the shelf (y=1) and reach in 2 more.
    expect(f.distance({ x: 6, y: 1 }, { x: 6, y: 4 })).toBe(2);
    expect(f.distance({ x: 6, y: 9 }, { x: 6, y: 7 })).toBe(1);
    expect(checkLayout(l, f, []).some((p) => p.startsWith('B has shelves'))).toBe(true);
    expect(checkLayout(l, f, []).some((p) => p.startsWith('A has shelves'))).toBe(false);
  });
});
