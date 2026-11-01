import { describe, expect, it } from 'vitest';
import { moveOnto, neighbourInLine, swapAlong } from './swap';
import type { Place, StoreLayout } from './types';

// The back wall, left to right: Meat (6), Cheese (3), a gap of 1, Milk (4). An island below.
const h = (id: string, x: number, length: number, y = 0): Place => ({ kind: 'shelf', id, label: id, orientation: 'horizontal', x, y, length, back: -1, categories: [] });
const store = (places: Place[]): StoreLayout => ({ id: 's', name: 'S', width: 20, height: 12, entrance: { x: 1, y: 11 }, checkout: { x: 5, y: 11 }, places });
const wall = store([h('meat', 1, 6), h('cheese', 7, 3), h('milk', 11, 4), { kind: 'area', id: 'island', label: 'Island', x: 4, y: 5, w: 4, h: 2, categories: [] }]);
const at = (l: StoreLayout, id: string) => l.places.find((p) => p.id === id)!.x;

describe('swapping pieces along a wall', () => {
  it('finds the next piece in the line, not one across from it', () => {
    expect(neighbourInLine(wall, 'meat', 1, 0)?.id).toBe('cheese');
    expect(neighbourInLine(wall, 'cheese', 1, 0)?.id).toBe('milk'); // past the gap
    expect(neighbourInLine(wall, 'meat', -1, 0)).toBeUndefined();
    expect(neighbourInLine(wall, 'meat', 0, 1)).toBeUndefined(); // a shelf running across: not in its line
  });

  it('two side by side swap, covering the same stretch', () => {
    const r = swapAlong(wall, 'meat', 1, 0)!;
    expect(r.with.id).toBe('cheese');
    expect([at(r.layout, 'cheese'), at(r.layout, 'meat')]).toEqual([1, 4]);
    expect(at(r.layout, 'milk')).toBe(11);
    // And back.
    const back = swapAlong(r.layout, 'meat', -1, 0)!;
    expect([at(back.layout, 'meat'), at(back.layout, 'cheese')]).toEqual([1, 7]);
  });

  it('the gap between them is kept', () => {
    const r = swapAlong(wall, 'cheese', 1, 0)!;
    expect([at(r.layout, 'milk'), at(r.layout, 'cheese')]).toEqual([7, 12]);
  });

  it('put in another’s place: the ones between move over', () => {
    const l = moveOnto(wall, 'milk', 'meat')!;
    expect(['milk', 'meat', 'cheese'].map((id) => at(l, id))).toEqual([1, 5, 12]);
  });

  it('won’t swap onto something else', () => {
    // A deeper area beside a shelf: swapped, the area's depth would land on the shelf below.
    const deep = store([{ kind: 'area', id: 'produce', label: 'P', x: 0, y: 0, w: 3, h: 3, categories: [] }, h('b', 3, 3), h('under', 3, 3, 2)]);
    expect(swapAlong(deep, 'produce', 1, 0)).toBeUndefined();
  });
});
