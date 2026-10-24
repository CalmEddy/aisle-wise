import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { defaultCategories, defaultProducts } from './categories';
import { demoLayout } from './demoLayout';
import { Floor } from './floor';
import { describeExact, exactKey, exactPoint, exactSpotAt, footprint, parseExactKey } from './geometry';
import { groupIntoStops, locateItem, resolveSpot } from './locate';
import { groupVisits, planRoute } from './route';
import type { Aisle, Area, ListItem } from './types';

const aisle: Aisle = { kind: 'aisle', id: 'a4', label: 'Aisle 4', x: 10, y: 5, orientation: 'vertical', length: 20, width: 2, categories: [] };
const hAisle: Aisle = { ...aisle, id: 'h', orientation: 'horizontal' };
const area: Area = { kind: 'area', id: 'prod', label: 'Produce', x: 0, y: 0, w: 10, h: 6, categories: [] };
const catalog = new Catalog(defaultProducts, defaultCategories);

describe('exact spots', () => {
  it('round-trips through a key', () => {
    const key = exactKey('a4', { u: 0.12345, v: 1 });
    expect(key).toBe('a4@0.123,1');
    expect(parseExactKey(key)).toEqual({ placeId: 'a4', spot: { u: 0.123, v: 1 } });
    expect(parseExactKey('a4')).toBeUndefined();
    expect(parseExactKey('a4:dairy')).toBeUndefined();
    expect(parseExactKey('a4@x,1')).toBeUndefined();
  });

  it('picks the side of the aisle from where you tap', () => {
    // Vertical aisle footprint x 10..14: left shelf at 10, walkway 11-12, right shelf at 13.
    expect(exactSpotAt(aisle, 10.5, 15)).toEqual({ u: 0.5, v: 0 });
    expect(exactSpotAt(aisle, 11.8, 15).v).toBe(0);
    expect(exactSpotAt(aisle, 12.2, 15).v).toBe(1);
    expect(exactSpotAt(aisle, 13.5, 5).v).toBe(1);
    expect(exactSpotAt(aisle, 13.5, 5).u).toBe(0);
    // Horizontal: top half is side 0.
    expect(exactSpotAt(hAisle, 15, 5.5).v).toBe(0);
    expect(exactSpotAt(hAisle, 15, 8.5).v).toBe(1);
  });

  it('walks to the lane next to the chosen shelf', () => {
    expect(exactPoint(aisle, { u: 0.5, v: 0 })).toEqual({ x: 11, y: 15 });
    expect(exactPoint(aisle, { u: 0.5, v: 1 })).toEqual({ x: 12, y: 15 });
    expect(exactPoint(aisle, { u: 0, v: 1 })).toEqual({ x: 12, y: 5 });
    expect(exactPoint(aisle, { u: 1, v: 1 })).toEqual({ x: 12, y: 24 });
    expect(exactPoint(area, { u: 0.95, v: 0.05 })).toEqual({ x: 9, y: 0 });
  });

  it('describes spots in plain words', () => {
    expect(describeExact(aisle, { u: 0.1, v: 0 })).toBe('left side, near the top');
    expect(describeExact(aisle, { u: 0.5, v: 1 })).toBe('right side, middle');
    expect(describeExact(hAisle, { u: 0.9, v: 1 })).toBe('bottom side, near the right end');
    expect(describeExact(aisle, { u: 0.9, v: 0.5 })).toBe('near the bottom');
    expect(describeExact(area, { u: 0.1, v: 0.9 })).toBe('bottom-left');
    expect(describeExact(area, { u: 0.5, v: 0.5 })).toBe('middle');
  });

  it('stays in the same relative place when the aisle moves or grows', () => {
    const key = exactKey('a4', { u: 0.75, v: 1 });
    const moved = { ...demoLayout, places: [{ ...aisle, x: 30, length: 40 }] };
    const spot = resolveSpot(key, moved, catalog)!;
    expect(spot.point).toEqual({ x: 32, y: 35 });
    expect(spot.label).toBe('Aisle 4 · right side, near the bottom');
    // Drawn on the right-hand shelf.
    expect(spot.mark.x).toBe(footprint(moved.places[0]).x + 3.5);
  });
});

describe('visits', () => {
  it('numbers back-to-back stops in the same place once', () => {
    const route = ['a', 'a', 'b', 'a', 'c', 'c', 'c'].map((placeId, i) => ({ placeId, i }));
    expect(groupVisits(route).map((v) => [v.number, v.placeId, v.stops.map((s) => s.i)])).toEqual([
      [1, 'a', [0, 1]], [2, 'b', [2]], [3, 'a', [3]], [4, 'c', [4, 5, 6]],
    ]);
  });

  it('walks an aisle in order and keeps it to one visit', () => {
    const products = defaultProducts.map((p) => {
      const at: Record<string, string> = { Pretzels: 'a4@0.9,0', Popcorn: 'a4@0.2,1', Cookies: 'a4@0.5,0', Milk: 'dairy' };
      return at[p.name] ? { ...p, locations: { demo: at[p.name] } } : p;
    });
    const c = new Catalog(products, defaultCategories);
    const items: ListItem[] = ['Pretzels', 'Popcorn', 'Cookies', 'Milk'].map((name) => ({ id: name, name, done: false }));
    const { stops } = groupIntoStops(items, (i) => locateItem(i, demoLayout, c));
    const route = planRoute(demoLayout.entrance, stops, demoLayout.checkout, new Floor(demoLayout).distance);
    const visits = groupVisits(route);
    const aisle4 = visits.find((v) => v.placeId === 'a4')!;
    expect(visits).toHaveLength(2);
    // Walks the aisle end to end rather than zig-zagging.
    const along = aisle4.stops.map((s) => s.items[0].name);
    expect([['Pretzels', 'Cookies', 'Popcorn'], ['Popcorn', 'Cookies', 'Pretzels']]).toContainEqual(along);
  });
});
