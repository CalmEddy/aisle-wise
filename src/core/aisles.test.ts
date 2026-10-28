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
