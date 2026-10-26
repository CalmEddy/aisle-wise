import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { defaultCategories, defaultProducts } from './categories';
import { demoLayout } from './demoLayout';
import { Floor } from './floor';
import { describeExact, exactKey, exactPoint, exactSpotAt, parseExactKey, placeNear } from './geometry';
import { groupIntoStops, locateItem, resolveSpot } from './locate';
import { groupVisits, planRoute } from './route';
import type { Area, ListItem, Shelf } from './types';

const shelf: Shelf = { kind: 'shelf', id: 's4', label: 'Snacks', x: 10, y: 5, orientation: 'vertical', length: 20, categories: [] };
const hShelf: Shelf = { ...shelf, id: 'h', orientation: 'horizontal' };
const area: Area = { kind: 'area', id: 'prod', label: 'Produce', x: 0, y: 0, w: 10, h: 6, categories: [] };
const catalog = new Catalog(defaultProducts, defaultCategories);

describe('exact spots', () => {
  it('round-trips through a key', () => {
    const key = exactKey('s4', { u: 0.12345, v: 0.5 });
    expect(key).toBe('s4@0.123,0.5');
    expect(parseExactKey(key)).toEqual({ placeId: 's4', spot: { u: 0.123, v: 0.5 } });
    expect(parseExactKey('s4')).toBeUndefined();
    expect(parseExactKey('s4:dairy')).toBeUndefined();
    expect(parseExactKey('s4@x,1')).toBeUndefined();
  });

  it('records how far along a shelf you tap, whichever side', () => {
    expect(exactSpotAt(shelf, 10.2, 15)).toEqual({ u: 0.5, v: 0.5 });
    expect(exactSpotAt(shelf, 10.9, 5)).toEqual({ u: 0, v: 0.5 });
    expect(exactSpotAt(hShelf, 25, 5.5).u).toBe(0.75);
  });

  it('lands on the shelf square', () => {
    expect(exactPoint(shelf, { u: 0.5, v: 0.5 })).toEqual({ x: 10, y: 15 });
    expect(exactPoint(shelf, { u: 1, v: 0.5 })).toEqual({ x: 10, y: 24 });
    expect(exactPoint(hShelf, { u: 0, v: 0.5 })).toEqual({ x: 10, y: 5 });
    expect(exactPoint(area, { u: 0.95, v: 0.05 })).toEqual({ x: 9, y: 0 });
  });

  it('describes spots in plain words', () => {
    expect(describeExact(shelf, { u: 0.1, v: 0.5 })).toBe('near the top');
    expect(describeExact(shelf, { u: 0.5, v: 0.5 })).toBe('middle');
    expect(describeExact(hShelf, { u: 0.9, v: 0.5 })).toBe('near the right end');
    expect(describeExact(area, { u: 0.1, v: 0.9 })).toBe('bottom-left');
    expect(describeExact(area, { u: 0.5, v: 0.5 })).toBe('middle');
  });

  it('stays in the same relative place when the shelf moves or grows', () => {
    const key = exactKey('s4', { u: 0.75, v: 0.5 });
    const moved = { ...demoLayout, places: [{ ...shelf, x: 30, length: 40 }] };
    const spot = resolveSpot(key, moved, catalog)!;
    expect(spot.point).toEqual({ x: 30, y: 35 });
    expect(spot.label).toBe('Snacks · near the bottom');
  });

  it('counts a tap just beside a thin shelf as on it', () => {
    const layout = { ...demoLayout, places: [shelf, area] };
    expect(placeNear(layout, 10.5, 12)?.id).toBe('s4');
    expect(placeNear(layout, 11.4, 12)?.id).toBe('s4');
    expect(placeNear(layout, 12.5, 12)).toBeUndefined();
    expect(placeNear(layout, 2, 2)?.id).toBe('prod');
  });
});

describe('visits', () => {
  it('numbers back-to-back stops in the same place once', () => {
    const route = ['a', 'a', 'b', 'a', 'c', 'c', 'c'].map((placeId, i) => ({ placeId, i }));
    expect(groupVisits(route).map((v) => [v.number, v.placeId, v.stops.map((s) => s.i)])).toEqual([
      [1, 'a', [0, 1]], [2, 'b', [2]], [3, 'a', [3]], [4, 'c', [4, 5, 6]],
    ]);
  });

  it('walks a shelf in order and keeps it to one visit', () => {
    const products = defaultProducts.map((p) => {
      const at: Record<string, string> = { Pretzels: 'snacks@0.9,0.5', Popcorn: 'snacks@0.2,0.5', Peanuts: 'snacks@0.5,0.5', Milk: 'dairy' };
      return at[p.name] ? { ...p, locations: { demo: at[p.name] } } : p;
    });
    const c = new Catalog(products, defaultCategories);
    const items: ListItem[] = ['Pretzels', 'Popcorn', 'Peanuts', 'Milk'].map((name) => ({ id: name, name, done: false }));
    const { stops } = groupIntoStops(items, (i) => locateItem(i, demoLayout, c));
    const route = planRoute(demoLayout.entrance, stops, demoLayout.checkout, new Floor(demoLayout).distance);
    const visits = groupVisits(route);
    expect(visits).toHaveLength(2);
    const along = visits.find((v) => v.placeId === 'snacks')!.stops.map((s) => s.items[0].name);
    expect([['Pretzels', 'Peanuts', 'Popcorn'], ['Popcorn', 'Peanuts', 'Pretzels']]).toContainEqual(along);
  });
});
