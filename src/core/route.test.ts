import { describe, expect, it } from 'vitest';
import { demoLayout } from './demoLayout';
import { Floor, UNREACHABLE } from './floor';
import { footprint, shelves, spotPoint } from './geometry';
import { Catalog } from './catalog';
import { defaultCategories, defaultProducts } from './categories';
import { groupIntoStops, locateItem, normalize, type Location } from './locate';
import { planRoute, routeLength } from './route';
import type { Aisle, ListItem, StoreLayout } from './types';
import { checkLayout } from './validate';

const item = (name: string): ListItem => ({ id: name, name, done: false });
const catalog = new Catalog(defaultProducts, defaultCategories);
const spotOf = (loc: Location) => (loc.kind === 'spot' ? loc.spot : undefined);

const tiny = (places: StoreLayout['places']): StoreLayout => ({
  id: 't', name: 'Tiny', width: 20, height: 12, places,
  entrance: { x: 0, y: 11 }, checkout: { x: 19, y: 11 },
});
const vAisle = (x: number, length = 8): Aisle => ({
  kind: 'aisle', id: `v${x}`, label: `V${x}`, x, y: 2, orientation: 'vertical', length, width: 2, categories: [],
});

describe('geometry', () => {
  it('turns an aisle sideways', () => {
    const v = vAisle(3);
    const h: Aisle = { ...v, orientation: 'horizontal' };
    expect(footprint(v)).toEqual({ x: 3, y: 2, w: 4, h: 8 });
    expect(footprint(h)).toEqual({ x: 3, y: 2, w: 8, h: 4 });
    expect(shelves(h)).toEqual([{ x: 3, y: 2, w: 8, h: 1 }, { x: 3, y: 5, w: 8, h: 1 }]);
  });

  it('spreads categories along the aisle', () => {
    const v = vAisle(3);
    expect(spotPoint(v, 0, 2)).toEqual({ x: 4, y: 4 });
    expect(spotPoint(v, 1, 2)).toEqual({ x: 4, y: 8 });
  });
});

describe('Floor', () => {
  it('walks around shelves rather than through them', () => {
    const floor = new Floor(tiny([vAisle(3)]));
    // Either side of the left shelf (x=3), halfway down the aisle.
    const outside = { x: 2, y: 6 };
    const inside = { x: 4, y: 6 };
    expect(floor.walkable({ x: 3, y: 6 })).toBe(false);
    // Out the bottom end (y=10) and back up: 4 down, 2 across, 4 up.
    expect(floor.distance(outside, inside)).toBe(10);
  });

  it('reports places sealed off by shelves', () => {
    const boxed = tiny([
      { kind: 'aisle', id: 'top', label: 'Top', x: 5, y: 0, orientation: 'horizontal', length: 6, width: 2, categories: [] },
      { kind: 'aisle', id: 'l', label: 'L', x: 4, y: 0, orientation: 'vertical', length: 8, width: 0, categories: [] },
      { kind: 'aisle', id: 'r', label: 'R', x: 11, y: 0, orientation: 'vertical', length: 8, width: 0, categories: [] },
      { kind: 'aisle', id: 'bot', label: 'Bottom', x: 5, y: 6, orientation: 'horizontal', length: 6, width: 0, categories: [] },
      { kind: 'area', id: 'room', label: 'Locked room', x: 6, y: 4, w: 4, h: 1, categories: [] },
    ]);
    const floor = new Floor(boxed);
    expect(floor.distance(boxed.entrance, { x: 7, y: 4 })).toBe(UNREACHABLE);
    expect(checkLayout(boxed, floor, defaultCategories).join(' ')).toContain('Locked room can’t be reached');
  });

  it('finds every demo place reachable', () => {
    const floor = new Floor(demoLayout);
    expect(checkLayout(demoLayout, floor, defaultCategories).filter((p) => p.includes('reach'))).toEqual([]);
  });
});

describe('locating items', () => {
  it('normalizes plurals and punctuation', () => {
    expect(normalize('2x Bananas!')).toBe('x banana');
    expect(normalize('Strawberries')).toBe('strawberry');
  });

  it('matches typed names to the master list', () => {
    expect(catalog.match('almond milk')?.categoryId).toBe('dairy');
    expect(catalog.match('almonds')?.categoryId).toBe('snacks');
    expect(catalog.match('organic whole milk')?.name).toBe('Milk');
    expect(catalog.match('flux capacitor')).toBeUndefined();
  });

  it('suggests items as you type, best match first', () => {
    expect(catalog.suggest('ban').map((p) => p.name)).toEqual(['Bananas']);
    expect(catalog.suggest('milk').map((p) => p.name)).toEqual(['Milk', 'Oat milk', 'Almond milk']);
    expect(catalog.suggest('straw')[0].name).toBe('Strawberries');
  });

  it('finds the place that stocks the category', () => {
    expect(spotOf(locateItem(item('pasta'), demoLayout, catalog))?.label).toBe('Aisle 2 · Pasta & Rice');
    expect(spotOf(locateItem(item('ice cream'), demoLayout, catalog))?.placeId).toBe('f2');
    expect(spotOf(locateItem(item('bread'), demoLayout, catalog))?.label).toBe('Bakery');
  });

  it('uses a per-store location saved on the item', () => {
    const milk = { ...catalog.exact('milk')!, locations: { demo: 'a3', other: 'x' } };
    const c = new Catalog(catalog.products.map((p) => (p.id === milk.id ? milk : p)), defaultCategories);
    expect(spotOf(locateItem(item('milk'), demoLayout, c))?.placeId).toBe('a3');
    // A different store keeps using the category.
    expect(spotOf(locateItem(item('milk'), { ...demoLayout, id: 'third' }, c))?.placeId).toBe('dairy');
    // A saved place that was deleted falls back to the category.
    const gone = new Catalog([{ ...milk, locations: { demo: 'gone' } }], defaultCategories);
    expect(spotOf(locateItem(item('milk'), demoLayout, gone))?.placeId).toBe('dairy');
  });

  it('knows when a store doesn’t sell an item', () => {
    const c = new Catalog([{ id: 'k', name: 'Kombucha', categoryId: 'soda', notAt: ['demo'] }], defaultCategories);
    expect(locateItem(item('kombucha'), demoLayout, c).kind).toBe('not-sold');
    expect(locateItem(item('kombucha'), { ...demoLayout, id: 'other' }, c).kind).toBe('spot');
  });
});

describe('planRoute', () => {
  const floor = new Floor(demoLayout);
  const locate = (i: ListItem) => locateItem(i, demoLayout, catalog);
  const plan = <T extends { point: { x: number; y: number } }>(start: { x: number; y: number }, stops: T[]) =>
    planRoute(start, stops, demoLayout.checkout, floor.distance);

  it('groups items picked up at the same spot', () => {
    const { stops, unplaced } = groupIntoStops([item('milk'), item('yogurt'), item('apples'), item('flux capacitor')], locate);
    expect(stops).toHaveLength(2);
    expect(unplaced.map((i) => i.name)).toEqual(['flux capacitor']);
  });

  it('re-plans from wherever the shopper is', () => {
    const { stops } = groupIntoStops([item('apples'), item('steak'), item('pasta'), item('milk')], locate);
    expect(plan(demoLayout.entrance, stops)[0].placeId).toBe('produce');
    const atMeat = stops.find((st) => st.placeId === 'meat')!.point;
    expect(plan(atMeat, stops)[0].placeId).toBe('meat');
  });

  it('is never longer than walking the list in order', () => {
    const names = ['soda', 'bread', 'steak', 'cereal', 'shampoo', 'eggs', 'ice cream', 'apples', 'rice', 'diapers'];
    const { stops } = groupIntoStops(names.map(item), locate);
    const planned = plan(demoLayout.entrance, stops);
    expect(routeLength(demoLayout.entrance, planned, demoLayout.checkout, floor.distance))
      .toBeLessThanOrEqual(routeLength(demoLayout.entrance, stops, demoLayout.checkout, floor.distance));
  });

  it('handles long lists with the heuristic', () => {
    const stops = demoLayout.places.map((p) => ({ id: p.id, point: spotPoint(p) }));
    expect(stops.length).toBeGreaterThan(12);
    const planned = plan(demoLayout.entrance, stops);
    expect(new Set(planned.map((s) => s.id)).size).toBe(stops.length);
    expect(routeLength(demoLayout.entrance, planned, demoLayout.checkout, floor.distance))
      .toBeLessThan(routeLength(demoLayout.entrance, stops, demoLayout.checkout, floor.distance));
  });
});
