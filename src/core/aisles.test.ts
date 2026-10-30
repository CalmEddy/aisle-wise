import { describe, expect, it } from 'vitest';
import { addAisle, clipAisles, nextAisleLabel, paintAisle, walkwayAt } from './aisles';
import { paintStep } from './brush';
import { growStore } from './build';
import type { Shelf, StoreLayout } from './types';

const v = (id: string, x: number, y = 4, length = 10): Shelf => ({ kind: 'shelf', id, label: id, x, y, orientation: 'vertical', length, categories: [] });
const store = (places: StoreLayout['places'] = []): StoreLayout =>
  ({ id: 's', name: 'S', width: 20, height: 20, entrance: { x: 0, y: 19 }, checkout: { x: 1, y: 19 }, places });

describe('aisle labels', () => {
  it('finds the walkway between two shelves', () => {
    const l = store([v('a', 3), v('b', 6, 6, 10)]);
    expect(walkwayAt(l, { x: 4, y: 8 })).toEqual({ x: 4, y: 6, w: 2, h: 8 });
    expect(walkwayAt(l, { x: 10, y: 8 })).toBeUndefined();
  });

  it('numbers new aisles and replaces a label on the same floor', () => {
    let l = store();
    l = addAisle(l, { x: 4, y: 6, w: 2, h: 8 }, nextAisleLabel(l)).layout;
    expect(nextAisleLabel(l)).toBe('Aisle 2');
    l = addAisle(l, { x: 4, y: 2, w: 2, h: 6 }, 'Snacks aisle').layout;
    expect(l.aisles!.map((a) => a.label)).toEqual(['Snacks aisle']);
  });

  it('the brush stretches one label down the whole aisle, and starts a new one round a corner', () => {
    let l = store();
    let p = { x: 5, y: 16 };
    for (let i = 0; i < 3; i++) {
      const r = paintStep(l, p, 'up', { left: 'shelf', right: 'shelf', width: 2, aisleLabel: 'Aisle 5' });
      l = r.layout;
      p = r.position;
    }
    expect(l.aisles).toHaveLength(1);
    expect(l.aisles![0]).toMatchObject({ label: 'Aisle 5', x: 5, y: 5, w: 2, h: 12 });
    l = paintAisle(l, { x: 5, y: 3, w: 4, h: 2 }, 'Aisle 5');
    expect(l.aisles).toHaveLength(2);
  });

  it('moves with the store and stays inside it', () => {
    const l = addAisle(store(), { x: 4, y: 15, w: 2, h: 5 }, 'Aisle 1').layout;
    expect(growStore(l, 'up', 3).layout.aisles![0].y).toBe(18);
    expect(clipAisles({ ...l, height: 17 }).aisles![0].h).toBe(2);
    expect(clipAisles({ ...l, height: 10 }).aisles).toHaveLength(0);
  });
});

describe('moving and turning a whole aisle', () => {
  const l: StoreLayout = {
    id: 't', name: 'T', width: 30, height: 30, entrance: { x: 0, y: 29 }, checkout: { x: 5, y: 29 },
    places: [
      { kind: 'shelf', id: 'L', label: 'L', orientation: 'vertical', x: 10, y: 5, length: 10, categories: ['a', 'b'] },
      { kind: 'shelf', id: 'R', label: 'R', orientation: 'vertical', x: 13, y: 5, length: 10, categories: [], back: 1 },
      { kind: 'shelf', id: 'other', label: 'O', orientation: 'vertical', x: 20, y: 5, length: 10, categories: [] },
    ],
    aisles: [{ id: 'a', label: 'Aisle 1', x: 11, y: 5, w: 2, h: 10 }],
  };

  it('finds the shelves on both sides', async () => {
    const { aisleShelves } = await import('./aisles');
    expect(aisleShelves(l, l.aisles![0]).map((s) => s.id).sort()).toEqual(['L', 'R']);
  });

  it('moves label and shelves together, unless something is in the way', async () => {
    const { moveAisle } = await import('./aisles');
    const r = moveAisle(l, 'a', 2, -1);
    expect(r.ok).toBe(true);
    expect(r.layout.places.find((p) => p.id === 'L')).toMatchObject({ x: 12, y: 4 });
    expect(r.layout.places.find((p) => p.id === 'R')).toMatchObject({ x: 15, y: 4 });
    expect(r.layout.aisles![0]).toMatchObject({ x: 13, y: 4 });
    expect(r.layout.places.find((p) => p.id === 'other')).toMatchObject({ x: 20 });
    expect(moveAisle(l, 'a', 7, 0).ok).toBe(false); // R would land on "other"
  });

  it('turns a quarter turn about its middle and back again', async () => {
    const { turnAisle } = await import('./aisles');
    const r = turnAisle(l, 'a');
    expect(r.ok).toBe(true);
    const a = r.layout.aisles![0];
    expect(a).toMatchObject({ w: 10, h: 2 });
    const L = r.layout.places.find((p) => p.id === 'L') as Shelf;
    const R = r.layout.places.find((p) => p.id === 'R') as Shelf;
    expect(L.orientation).toBe('horizontal');
    // The left shelf goes below the walkway (top → left keeps its order), the right one above.
    expect(L.y).toBe(a.y + a.h);
    expect(R.y).toBe(a.y - 1);
    expect(R.back).toBe(-1); // still backed away from the walkway
    expect(L.categories).toEqual(['a', 'b']);
    // Same middle.
    expect(a.x + a.w / 2).toBeCloseTo(12, 0);
    expect(a.y + a.h / 2).toBeCloseTo(10, 0);
    const back = turnAisle(r.layout, 'a');
    expect(back.layout.places.find((p) => p.id === 'L')).toMatchObject({ x: 10, y: 5, orientation: 'vertical' });
    expect(back.layout.aisles![0]).toMatchObject({ x: 11, y: 5, w: 2, h: 10 });
  });
});

describe('groups of aisles, and moving shelves without losing the aisle', () => {
  // Three up-and-down aisles side by side: shelves at x 2,5 | 6,9 | 10,13 (back to back between), walkways 3–4, 7–8, 11–12.
  const sh = (id: string, x: number): Shelf => ({ kind: 'shelf', id, label: id, orientation: 'vertical', x, y: 4, length: 10, categories: [] });
  const block: StoreLayout = {
    id: 'g', name: 'G', width: 40, height: 40, entrance: { x: 0, y: 39 }, checkout: { x: 5, y: 39 },
    places: [sh('a1', 2), sh('a2', 5), sh('b1', 6), sh('b2', 9), sh('c1', 10), sh('c2', 13)],
    aisles: [
      { id: 'A', label: 'Aisle 1', x: 3, y: 4, w: 2, h: 10 },
      { id: 'B', label: 'Aisle 2', x: 7, y: 4, w: 2, h: 10 },
      { id: 'C', label: 'Aisle 3', x: 11, y: 4, w: 2, h: 10 },
    ],
  };

  it('selects the aisles a box touches', async () => {
    const { aislesIn } = await import('./aisles');
    expect(aislesIn(block, { x: 4, y: 8, w: 4, h: 2 })).toEqual(['A', 'B']);
  });

  it('turns a group as one block: side by side becomes stacked, nothing overlapping', async () => {
    const { turnAisles, aisleShelves } = await import('./aisles');
    const r = turnAisles(block, ['A', 'B', 'C']);
    expect(r.ok).toBe(true);
    const labels = r.layout.aisles!;
    expect(labels.every((a) => a.w === 10 && a.h === 2)).toBe(true);
    expect(new Set(labels.map((a) => a.x)).size).toBe(1);
    expect(labels.map((a) => a.y).sort((x, y) => x - y)).toEqual([...new Set(labels.map((a) => a.y))].sort((x, y) => x - y));
    expect(r.layout.places.every((p) => p.kind === 'shelf' && p.orientation === 'horizontal')).toBe(true);
    for (const a of labels) expect(aisleShelves(r.layout, a)).toHaveLength(2);
    // And back again.
    const back = turnAisles(r.layout, ['A', 'B', 'C']);
    expect(back.layout.aisles).toEqual(block.aisles);
    expect(back.layout.places).toEqual(block.places);
  });

  it('moving aisles never lands one on another', async () => {
    const { moveAisles } = await import('./aisles');
    expect(moveAisles(block, ['A'], 1, 0).ok).toBe(false); // a2 would hit b1
    expect(moveAisles(block, ['A', 'B', 'C'], 3, 2).ok).toBe(true);
    // A label alone (no shelves between) can't slide onto another walkway either.
    const loose: StoreLayout = { ...block, places: [], aisles: block.aisles };
    expect(moveAisles(loose, ['A'], 4, 0).ok).toBe(false);
    expect(moveAisles(loose, ['A'], 2, 0).ok).toBe(true);
  });

  it('deletes a group with its shelves, keeping shelves a remaining aisle still uses', async () => {
    const { deleteAisles } = await import('./aisles');
    const shared: StoreLayout = { ...block, places: block.places.filter((p) => p.id !== 'b1').map((p) => (p.id === 'a2' ? { ...p, x: 6 } : p)),
      aisles: [{ id: 'A', label: 'Aisle 1', x: 3, y: 4, w: 3, h: 10 }, block.aisles![1], block.aisles![2]] };
    const r = deleteAisles(shared, ['A', 'C']);
    expect(r.aisles!.map((a) => a.id)).toEqual(['B']);
    expect(r.places.map((p) => p.id).sort()).toEqual(['a2', 'b2']);
  });

  it('a shelf moved away widens its aisle; slid along, the aisle covers both sides', async () => {
    const { moveShelf } = await import('./aisles');
    const one: StoreLayout = { ...block, places: [sh('L', 2), sh('R', 5)], aisles: [{ id: 'A', label: 'Aisle 1', x: 3, y: 4, w: 2, h: 10 }] };
    let r = moveShelf(one, 'R', { x: 6 });
    expect(r.ok).toBe(true);
    expect(r.layout.aisles![0]).toMatchObject({ x: 3, w: 3, y: 4, h: 10 });
    r = moveShelf(r.layout, 'L', { y: 7 });
    expect(r.layout.aisles![0]).toMatchObject({ x: 3, w: 3, y: 4, h: 13 });
    // Into the walkway narrows it, but it can't close it.
    expect(moveShelf(one, 'R', { x: 4 }).layout.aisles![0]).toMatchObject({ x: 3, w: 1 });
    expect(moveShelf(one, 'R', { x: 3 }).ok).toBe(false);
  });

  it('a shelf can’t be moved onto another place or another aisle’s walkway', async () => {
    const { moveShelf } = await import('./aisles');
    expect(moveShelf(block, 'a2', { x: 6 }).ok).toBe(false); // onto b1
    const gap: StoreLayout = { ...block, places: block.places.filter((p) => p.id !== 'b1') };
    expect(moveShelf(gap, 'a2', { x: 7 }).ok).toBe(false); // into Aisle 2's walkway
    expect(moveShelf(gap, 'a2', { x: 6 }).ok).toBe(true);
  });
});

describe('selecting shelves and areas, not only aisles', () => {
  const area = { kind: 'area' as const, id: 'deli', label: 'Deli', x: 12, y: 2, w: 4, h: 3, categories: [] };
  const l = store([v('a', 3), v('b', 6), area]); // no aisle labels at all (like a store using shelf codes)

  it('a box picks the shelves and areas it touches', async () => {
    const { selectionIn } = await import('./aisles');
    expect(selectionIn(l, { x: 2, y: 5, w: 6, h: 1 }).sort()).toEqual(['a', 'b']);
    expect(selectionIn(l, { x: 0, y: 0, w: 20, h: 20 }).sort()).toEqual(['a', 'b', 'deli']);
  });

  it('moves, turns and deletes them together', async () => {
    const { moveAisles, turnAisles, deleteAisles, runsUp } = await import('./aisles');
    const moved = moveAisles(l, ['a', 'b', 'deli'], 1, 0);
    expect(moved.ok).toBe(true);
    expect(moved.layout.places.map((p) => p.x)).toEqual([4, 7, 13]);
    // Not past the wall, or onto something else.
    expect(moveAisles(l, ['deli'], 5, 0).ok).toBe(false);
    expect(moveAisles(l, ['a'], 3, 0).ok).toBe(false); // onto b
    expect(runsUp(l, ['a', 'b'])).toBe(true);
    const turned = turnAisles(l, ['a', 'b']);
    expect(turned.ok).toBe(true);
    expect(turned.layout.places.filter((p) => p.kind === 'shelf').every((p) => p.kind === 'shelf' && p.orientation === 'horizontal')).toBe(true);
    const deli = turnAisles(l, ['deli']).layout.places.find((p) => p.id === 'deli')!;
    expect(deli.kind === 'area' && [deli.w, deli.h]).toEqual([3, 4]);
    expect(deleteAisles(l, ['b', 'deli']).places.map((p) => p.id)).toEqual(['a']);
  });
});
