import { describe, expect, it } from 'vitest';
import { demoLayout } from './demoLayout';
import { Floor, UNREACHABLE } from './floor';
import { footprint, spotPoint } from './geometry';
import { Catalog } from './catalog';
import { defaultCategories, defaultProducts } from './categories';
import { groupIntoStops, locateItem, normalize, type Location } from './locate';
import { planGroupedRoute, planRoute, routeLength } from './route';
import type { ListItem, Shelf, StoreLayout } from './types';
import { checkLayout } from './validate';

const item = (name: string): ListItem => ({ id: name, name, done: false });
const catalog = new Catalog(defaultProducts, defaultCategories);
const spotOf = (loc: Location) => (loc.kind === 'spot' ? loc.spot : undefined);

const tiny = (places: StoreLayout['places']): StoreLayout => ({
  id: 't', name: 'Tiny', width: 20, height: 12, places,
  entrance: { x: 0, y: 11 }, checkout: { x: 19, y: 11 },
});
const vShelf = (x: number, length = 8): Shelf => ({
  kind: 'shelf', id: `v${x}`, label: `V${x}`, x, y: 2, orientation: 'vertical', length, categories: [],
});
const hShelf = (id: string, x: number, y: number, length: number): Shelf => ({
  kind: 'shelf', id, label: id, x, y, orientation: 'horizontal', length, categories: [],
});

describe('geometry', () => {
  it('makes a shelf a single stick, either way round', () => {
    const v = vShelf(3);
    expect(footprint(v)).toEqual({ x: 3, y: 2, w: 1, h: 8 });
    expect(footprint({ ...v, orientation: 'horizontal' })).toEqual({ x: 3, y: 2, w: 8, h: 1 });
  });

  it('spreads categories along the shelf', () => {
    const v = vShelf(3);
    expect(spotPoint(v, 0, 2)).toEqual({ x: 3, y: 4 });
    expect(spotPoint(v, 1, 2)).toEqual({ x: 3, y: 8 });
  });
});

describe('Floor', () => {
  it('walks around shelves rather than through them', () => {
    const floor = new Floor(tiny([vShelf(3)]));
    expect(floor.walkable({ x: 3, y: 6 })).toBe(false);
    // From one side of the shelf to the other: out the bottom end (y=10) and back up.
    expect(floor.distance({ x: 2, y: 6 }, { x: 4, y: 6 })).toBe(4 + 2 + 4);
  });

  it('reaches a spot on a shelf from whichever side is nearer', () => {
    const floor = new Floor(tiny([vShelf(3)]));
    const onShelf = { x: 3, y: 6 };
    expect(floor.distance({ x: 2, y: 6 }, onShelf)).toBe(0);
    expect(floor.distance({ x: 4, y: 6 }, onShelf)).toBe(0);
    expect(floor.distance({ x: 6, y: 6 }, onShelf)).toBe(2);
    expect(floor.distance(onShelf, { x: 0, y: 6 })).toBe(2);
  });

  it('reports places sealed off by shelves', () => {
    const boxed = tiny([
      hShelf('top', 5, 3, 6),
      hShelf('bottom', 5, 6, 6),
      { ...vShelf(4, 4), id: 'l', y: 3 },
      { ...vShelf(11, 4), id: 'r', y: 3 },
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
    expect(spotOf(locateItem(item('pasta'), demoLayout, catalog))?.label).toBe('Pasta & Rice');
    expect(spotOf(locateItem(item('ice cream'), demoLayout, catalog))?.placeId).toBe('icecream1');
    expect(spotOf(locateItem(item('bread'), demoLayout, catalog))?.label).toBe('Bakery');
  });

  it('uses a per-store location saved on the item', () => {
    const milk = { ...catalog.exact('milk')!, locations: { demo: 'oils', other: 'x' } };
    const c = new Catalog(catalog.products.map((p) => (p.id === milk.id ? milk : p)), defaultCategories);
    expect(spotOf(locateItem(item('milk'), demoLayout, c))?.placeId).toBe('oils');
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

  it('visits the nearer stop first when two orders are equally long', () => {
    // Open floor: entrance bottom-right, checkout bottom-left, one stop near
    // the entrance and one far away. Both orders walk 63 squares.
    const open: StoreLayout = { ...tiny([]), width: 30, height: 20, entrance: { x: 20, y: 19 }, checkout: { x: 5, y: 19 } };
    const f = new Floor(open);
    const near = { id: 'near', point: { x: 22, y: 15 } };
    const far = { id: 'far', point: { x: 27, y: 2 } };
    expect(routeLength(open.entrance, [near, far], open.checkout, f.distance))
      .toBe(routeLength(open.entrance, [far, near], open.checkout, f.distance));
    for (const stops of [[near, far], [far, near]]) {
      expect(planRoute(open.entrance, stops, open.checkout, f.distance).map((s) => s.id)).toEqual(['near', 'far']);
    }
  });

  it('still takes a longer first leg when the whole route is shorter', () => {
    // Checkout right next to the near stop: grab the far one first.
    const open: StoreLayout = { ...tiny([]), width: 30, height: 20, entrance: { x: 15, y: 19 }, checkout: { x: 22, y: 19 } };
    const f = new Floor(open);
    const near = { id: 'near', point: { x: 20, y: 17 } };
    const far = { id: 'far', point: { x: 2, y: 19 } };
    expect(planRoute(open.entrance, [near, far], open.checkout, f.distance).map((s) => s.id)).toEqual(['far', 'near']);
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

describe('planGroupedRoute', () => {
  // A shelf with an area beside its middle, checkout off past its top: the
  // shortest walk would zig-zag shelf → area → shelf.
  const layout: StoreLayout = {
    id: 'g', name: 'G', width: 20, height: 20, entrance: { x: 11, y: 19 }, checkout: { x: 0, y: 0 },
    places: [
      { kind: 'shelf', id: 'shelf', label: 'Shelf 1', x: 10, y: 5, orientation: 'vertical', length: 10, categories: [] },
      { kind: 'area', id: 'fruit', label: 'Fruit', x: 12, y: 9, w: 3, h: 3, categories: [] },
    ],
  };
  const floor = new Floor(layout);
  const stop = (id: string, placeId: string, x: number, y: number) => ({ id, placeId, point: { x, y } });
  const stops = [
    stop('olives', 'shelf', 10, 14), stop('pickles', 'shelf', 10, 5),
    stop('kiwi', 'fruit', 13, 10), stop('bananas', 'fruit', 12, 9), stop('berries', 'fruit', 14, 11),
  ];
  const along = (s: { point: { x: number; y: number } }) => s.point.y * 1000 + s.point.x;

  it('never splits a place, and walks each one end to end', () => {
    const runs = (ids: string[]) => {
      const places = ids.map((id) => stops.find((s) => s.id === id)!.placeId);
      return places.filter((p, i) => p !== places[i - 1]).length;
    };
    // The plain planner zig-zags (this is the bug being fixed)…
    expect(runs(planRoute(layout.entrance, stops, layout.checkout, floor.distance).map((s) => s.id))).toBe(3);
    // …the grouped one visits each place once.
    const route = planGroupedRoute(layout.entrance, stops, layout.checkout, floor.distance, along).map((s) => s.id);
    expect(runs(route)).toBe(2);
    expect(route).toEqual(['bananas', 'kiwi', 'berries', 'olives', 'pickles']); // shelf walked bottom to top, towards checkout
  });

  it('keeps every stop exactly once, and handles one place or none', () => {
    expect(planGroupedRoute(layout.entrance, [], layout.checkout, floor.distance, along)).toEqual([]);
    const one = planGroupedRoute(layout.entrance, stops.slice(0, 2), layout.checkout, floor.distance, along).map((s) => s.id);
    expect(one).toEqual(['olives', 'pickles']);
    const many = Array.from({ length: 14 }, (_, i) => stop(`s${i}`, `p${i}`, i, i % 5));
    const planned = planGroupedRoute({ x: 0, y: 19 }, many, { x: 19, y: 19 }, new Floor({ ...layout, places: [] }).distance, along);
    expect(new Set(planned.map((s) => s.id)).size).toBe(14);
  });
});
