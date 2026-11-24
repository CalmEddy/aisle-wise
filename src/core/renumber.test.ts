import { describe, expect, it } from 'vitest';
import { renumberSelection, selectionOrder } from './renumber';
import type { Shelf, StoreLayout } from './types';

const shelf = (id: string, label: string, x: number, y: number, o: 'vertical' | 'horizontal' = 'horizontal'): Shelf => ({
  kind: 'shelf', id, label, orientation: o, x, y, length: 4, categories: [],
});

describe('renumberSelection', () => {
  it('names horizontal shelves top to bottom from B1', () => {
    const l: StoreLayout = {
      id: 't', name: 'T', width: 30, height: 24,
      places: [
        shelf('s1', 'X', 5, 3),
        shelf('s2', 'Y', 5, 5),
        shelf('s3', 'Z', 5, 7),
        shelf('s4', 'W', 5, 9),
      ],
      entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
      labels: { example: 'B12', roles: ['section', 'shelf'], pairing: 'single' },
    };
    const ids = ['s1', 's2', 's3', 's4'];
    expect(selectionOrder(l, ids).map((o) => o.id)).toEqual(['s1', 's2', 's3', 's4']);
    const next = renumberSelection(l, ids, 'B1');
    expect(next.places.map((p) => p.label)).toEqual(['B1', 'B2', 'B3', 'B4']);
  });

  it('flips order and renumbers aisles', () => {
    const l: StoreLayout = {
      id: 't', name: 'T', width: 30, height: 24, places: [],
      entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
      aisles: [
        { id: 'a1', label: 'Aisle 9', x: 2, y: 5, w: 2, h: 10 },
        { id: 'a2', label: 'Aisle 8', x: 6, y: 5, w: 2, h: 10 },
        { id: 'a3', label: 'Aisle 7', x: 10, y: 5, w: 2, h: 10 },
      ],
    };
    const next = renumberSelection(l, ['a1', 'a2', 'a3'], 'Aisle 1', { flip: true });
    expect(next.aisles!.map((a) => a.label)).toEqual(['Aisle 3', 'Aisle 2', 'Aisle 1']);
  });
});
