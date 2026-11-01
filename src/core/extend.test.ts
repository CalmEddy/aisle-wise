import { describe, expect, it } from 'vitest';
import { extended, extensionsDue, pastEnd, withReach } from './extend';
import { exactKey } from './geometry';
import type { Product, Shelf, StoreLayout } from './types';

const v = (id: string, x: number, y: number, length: number, extra: Partial<Shelf> = {}): Shelf =>
  ({ kind: 'shelf', id, label: id, orientation: 'vertical', x, y, length, categories: [], ...extra });
const store = (places: Shelf[], more: Partial<StoreLayout> = {}): StoreLayout =>
  ({ id: 's', name: 'S', width: 20, height: 20, entrance: { x: 1, y: 19 }, checkout: { x: 6, y: 19 }, places, ...more });
const at = (name: string, placeId: string, u: number): Product => ({ id: name, name, locations: { s: exactKey(placeId, { u, v: 0.5 }) } });

describe('when a shelf should be longer', () => {
  it('a spot on the floor just past an end, lined up with it, is past that end', () => {
    const l = store([v('a', 5, 6, 8)]);
    expect(pastEnd(l, { x: 5, y: 4 })).toMatchObject({ end: 'start', to: 4, gap: 2 });
    expect(pastEnd(l, { x: 5, y: 15 })).toMatchObject({ end: 'end', to: 15, gap: 2 });
    expect(pastEnd(l, { x: 6, y: 4 })).toBeUndefined(); // not lined up
    expect(pastEnd(l, { x: 5, y: 1 })).toBeUndefined(); // too far
  });

  it('two things found past an end: ask to extend it that far', () => {
    let l = store([v('a', 5, 6, 8)]);
    l = withReach(l, { placeId: 'a', end: 'start', to: 4, item: 'Cereal', at: 1 });
    expect(extensionsDue(l, [])).toEqual([]); // one alone: not yet
    l = withReach(l, { placeId: 'a', end: 'start', to: 5, item: 'Oatmeal', at: 2 });
    expect(extensionsDue(l, [])).toMatchObject([{ placeId: 'a', end: 'start', by: 2, way: 'toward the back' }]);
    // Once it's that long, nothing to ask.
    l = { ...l, places: [extended(l.places[0] as Shelf, 'start', 2)] };
    expect(l.places[0]).toMatchObject({ y: 4, length: 10 });
    expect(extensionsDue(l, [])).toEqual([]);
  });

  it('one found past the end and the shelves either side running further', () => {
    let l = store([v('a', 5, 6, 8), v('left', 2, 3, 11), v('right', 8, 3, 11)]);
    l = withReach(l, { placeId: 'a', end: 'start', to: 5, item: 'Cereal', at: 1 });
    expect(extensionsDue(l, [])).toMatchObject([{ placeId: 'a', end: 'start', by: 3 }]); // to match them
  });

  it('things piled at the very end and a neighbour running further', () => {
    const l = store([v('a', 5, 6, 8), v('b', 8, 6, 11)]);
    const ps = [at('Rice', 'a', 1), at('Beans', 'a', 0.99)];
    expect(extensionsDue(l, ps)).toMatchObject([{ placeId: 'a', end: 'end', by: 3, way: 'toward the front' }]);
  });

  it('said to go no further, or no room: not asked', () => {
    let l = store([v('a', 5, 6, 8)], { keepLength: ['a:start'] });
    l = withReach(withReach(l, { placeId: 'a', end: 'start', to: 4, item: 'X', at: 1 }), { placeId: 'a', end: 'start', to: 5, item: 'Y', at: 2 });
    expect(extensionsDue(l, [])).toEqual([]);
    const blocked = store([v('a', 5, 6, 8), { ...v('wall', 3, 5, 5), orientation: 'horizontal' }]);
    const b = withReach(withReach(blocked, { placeId: 'a', end: 'start', to: 4, item: 'X', at: 1 }), { placeId: 'a', end: 'start', to: 5, item: 'Y', at: 2 });
    expect(extensionsDue(b, [])).toEqual([]);
  });

  it('a wall shelf beside an aisle shelf doesn’t count as out of step', () => {
    const l = store([v('a', 3, 6, 8), v('wall', 0, 0, 20, { back: -1 })]);
    expect(extensionsDue(l, [at('Rice', 'a', 1), at('Beans', 'a', 1)])).toEqual([]);
  });
});
