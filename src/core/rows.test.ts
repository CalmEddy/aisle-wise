import { describe, expect, it } from 'vitest';
import { planBuild, turnPair } from './build';
import { addedRect, fillBlock, learnPattern, matchNeighbour, nextShelves, skippedShelves } from './rows';
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

  it('double shelves: a pick-up makes a back-to-back pair, away from the row', () => {
    const l = store(v('a', 2, 5, 10));
    const plan = planBuild(l, { x: 9, y: 8 }, undefined, 'vertical', 'shelf', true);
    const made = plan.layout.places.filter((p) => p.id !== 'a') as Shelf[];
    expect(xs(made).sort()).toEqual([10, 9]);
    expect(plan.pairId).toBe(made.find((m) => m.x === 10)!.id);
    expect(made.map((m) => m.label).sort()).toEqual(['Shelf 1', 'Shelf 2']);
  });

  it('turns a pair together', () => {
    const plan = planBuild(store(), { x: 6, y: 8 }, undefined, 'vertical', 'shelf', true);
    const a = plan.placeId!;
    const r = turnPair(plan.layout, a, plan.pairId!, { x: 6, y: 8 })!;
    const turned = r.layout.places as Shelf[];
    expect(turned.map((s) => s.orientation)).toEqual(['horizontal', 'horizontal']);
    expect(turned.map((s) => s.y).sort()).toEqual([8, 9]);
    expect(turned[0].x).toBe(turned[1].x);
    expect(r.rekey(`${plan.pairId}@0.5,0.5`)).toBe(`${plan.pairId}@0.5,0.5`);
  });

  it('copies horizontal rows too', () => {
    const h: Shelf = { ...v('h', 4, 3, 12), orientation: 'horizontal' };
    const plan = planBuild(store(h), { x: 6, y: 9 });
    expect(plan.layout.places.find((p) => p.id === plan.placeId)).toMatchObject({ orientation: 'horizontal', x: 4, y: 9, length: 12 });
  });

  it('next shelf: across a walkway, from the far side of a pair', () => {
    const l = store(v('a', 2), v('b', 3), v('c', 6), v('d', 7));
    expect(xs(nextShelves(l, l.places[3] as Shelf, 1))).toEqual([10]);
    expect(xs(nextShelves(l, l.places[2] as Shelf, 1))).toEqual([10]);
    expect(xs(nextShelves(l, l.places[3] as Shelf, 1, true))).toEqual([10, 11]);
    const s = store(v('a', 2), v('b', 5));
    expect(xs(nextShelves(s, s.places[1] as Shelf, 1))).toEqual([8]);
    expect(nextShelves(s, s.places[0] as Shelf, -1)).toEqual([]); // wall
  });

  it('fills shelves walked past, keeping walkways', () => {
    const singles = store(v('a', 2), v('b', 5), v('far', 20));
    expect(xs(skippedShelves(singles, singles.places[2] as Shelf))).toEqual([8, 11, 14, 17]);
    const pairs = store(v('a', 2), v('b', 3), v('far', 18));
    expect(xs(skippedShelves(pairs, pairs.places[2] as Shelf, true))).toEqual([6, 7, 10, 11, 14, 15]);
    // A new pair counts from its near shelf.
    const madePair = store(v('a', 2), v('b', 3), v('n1', 17), v('n2', 18));
    expect(xs(skippedShelves(madePair, [madePair.places[2], madePair.places[3]] as Shelf[], true))).toEqual([7, 8, 12, 13]);
    // Just a walkway between them: nothing skipped.
    const close = store(v('a', 2), v('b', 5));
    expect(skippedShelves(close, close.places[1] as Shelf)).toEqual([]);
  });

  it('spreads spare room over the walkways', () => {
    const l = store(v('a', 2), v('b', 5), v('far', 12));
    // 6 squares between 5 and 12: one shelf, with walkways of 3 and 2.
    expect(xs(skippedShelves(l, l.places[2] as Shelf))).toEqual([9]);
  });

  it('fills a dragged-out block', () => {
    const l = store();
    const block = { x: 2, y: 3, w: 10, h: 8 };
    expect(xs(fillBlock(l, block, { orientation: 'vertical', double: false, lane: 2 }))).toEqual([2, 5, 8, 11]);
    expect(xs(fillBlock(l, block, { orientation: 'vertical', double: true, lane: 2 }))).toEqual([2, 3, 6, 7, 10, 11]);
    const h = fillBlock(l, block, { orientation: 'horizontal', double: false, lane: 1 });
    expect(h.map((s) => s.y)).toEqual([3, 5, 7, 9]);
    expect(h[0]).toMatchObject({ x: 2, length: 10 });
    // Skips shelves that would hit something.
    const busy = store(v('x', 5, 0, 5));
    expect(xs(fillBlock(busy, block, { orientation: 'vertical', double: false, lane: 2 }))).toEqual([2, 8, 11]);
  });

  it('marks what a plan adds', () => {
    const l = store(v('a', 2, 5, 3));
    const grown = store({ ...v('a', 2, 5, 6) });
    expect(addedRect(l, grown, 'a')).toEqual({ x: 2, y: 8, w: 1, h: 3 });
    expect(addedRect(l, l, 'a')).toBeUndefined();
  });
});
