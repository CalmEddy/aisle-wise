import { describe, expect, it } from 'vitest';
import { planBuild } from './build';
import { addedRect, learnPattern, matchNeighbour, nextShelf, skippedShelves } from './rows';
import type { Shelf, StoreLayout } from './types';

const v = (id: string, x: number, y = 5, length = 10): Shelf =>
  ({ kind: 'shelf', id, label: id, x, y, orientation: 'vertical', length, categories: [] });
const store = (...places: Shelf[]): StoreLayout =>
  ({ id: 's', name: 'S', width: 40, height: 25, entrance: { x: 0, y: 24 }, checkout: { x: 39, y: 24 }, places } as StoreLayout);
const xs = (list: Shelf[]) => list.map((s) => s.x);

describe('row spacing', () => {
  it('learns walkway width and pairs', () => {
    const l = store(v('a', 2), v('b', 3), v('c', 6), v('d', 7));
    expect(learnPattern(l, l.places[0] as Shelf)).toEqual({ lane: 2, paired: true });
    const singles = store(v('a', 2), v('b', 5), v('c', 8));
    expect(learnPattern(singles, singles.places[0] as Shelf)).toEqual({ lane: 2, paired: false });
    expect(learnPattern(store(v('a', 2)), v('a', 2))).toEqual({ lane: 2, paired: false });
  });

  it('a new shelf copies the row it is in', () => {
    const l = store(v('a', 2, 5, 10));
    expect(matchNeighbour(l, { x: 9, y: 8 })?.id).toBe('a');
    const plan = planBuild(l, { x: 9, y: 8 });
    const made = plan.layout.places.find((p) => p.id === plan.placeId) as Shelf;
    expect(made).toMatchObject({ orientation: 'vertical', x: 9, y: 5, length: 10 });
    expect(plan.matched).toBe('a');
    // Item saved where you stood: 3 squares along a 10-square shelf.
    expect(plan.spotKey).toBe(`${made.id}@0.35,0.5`);
  });

  it('copies horizontal rows too', () => {
    const h: Shelf = { ...v('h', 4, 3, 12), orientation: 'horizontal' };
    const plan = planBuild(store(h), { x: 6, y: 9 });
    expect(plan.layout.places.find((p) => p.id === plan.placeId)).toMatchObject({ orientation: 'horizontal', x: 4, y: 9, length: 12 });
  });

  it('next shelf: back to back for pairs, then across a walkway', () => {
    const l = store(v('a', 2), v('b', 3), v('c', 6), v('d', 7));
    const d = l.places[3] as Shelf;
    expect(nextShelf(l, d, 1)?.x).toBe(10);
    const l2 = store(...(l.places as Shelf[]), { ...v('e', 10) });
    expect(nextShelf(l2, l2.places[4] as Shelf, 1)?.x).toBe(11);
    // Singles: always across a walkway.
    const s = store(v('a', 2), v('b', 5));
    expect(nextShelf(s, s.places[1] as Shelf, 1)?.x).toBe(8);
    expect(nextShelf(s, s.places[0] as Shelf, -1)).toBeUndefined(); // wall
  });

  it('fills shelves walked past, keeping walkways', () => {
    const singles = store(v('a', 2), v('b', 5), v('far', 20));
    expect(xs(skippedShelves(singles, singles.places[2] as Shelf))).toEqual([8, 11, 14, 17]);
    const pairs = store(v('a', 2), v('b', 3), v('far', 18));
    expect(xs(skippedShelves(pairs, pairs.places[2] as Shelf))).toEqual([6, 7, 10, 11, 14, 15]);
    // Just a walkway between them: nothing skipped.
    const close = store(v('a', 2), v('b', 5));
    expect(skippedShelves(close, close.places[1] as Shelf)).toEqual([]);
  });

  it('spreads spare room over the walkways', () => {
    const l = store(v('a', 2), v('b', 5), v('far', 12));
    // 6 squares between 5 and 12: one shelf, with walkways of 3 and 2.
    expect(xs(skippedShelves(l, l.places[2] as Shelf))).toEqual([9]);
  });

  it('marks what a plan adds', () => {
    const l = store(v('a', 2, 5, 3));
    const grown = store({ ...v('a', 2, 5, 6) });
    expect(addedRect(l, grown, 'a')).toEqual({ x: 2, y: 8, w: 1, h: 3 });
    expect(addedRect(l, l, 'a')).toBeUndefined();
  });
});
