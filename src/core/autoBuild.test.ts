import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { defaultCategories } from './categories';
import {
  applyAutoBuild,
  areaOrigin,
  autoPlaceId,
  categorySequence,
  CELL_H,
  CELL_W,
  disableAuto,
  GAP,
  handEditedAuto,
  isAutoPlace,
  LANE_CAPACITY,
  layoutFromRanks,
  MARGIN,
  mergeRanks,
  placeProductsOnAreas,
  rankedCategories,
  serpentineSlot,
} from './autoBuild';
import type { Trip } from './trips';
import type { Product, StoreLayout } from './types';

const products: Product[] = [
  { id: 'apples', name: 'Apples', categoryId: 'produce_fruits' },
  { id: 'milk', name: 'Milk', categoryId: 'dairy_milk' },
  { id: 'pasta', name: 'Pasta', categoryId: 'pasta_dry' },
  { id: 'chips', name: 'Chips', categoryId: 'snacks_chips' },
  { id: 'bread', name: 'Bread', categoryId: 'bakery_sandwich_bread' },
];
const catalog = new Catalog(products, defaultCategories);

const blank = (): StoreLayout => ({
  id: 's',
  name: 'Blank',
  width: 30,
  height: 24,
  places: [],
  entrance: { x: 28, y: 23 },
  checkout: { x: 2, y: 23 },
  auto: { enabled: true, ranks: {} },
  gen: { enabled: false, entrance: 'left', locked: [], setup: 'blank' },
});

const trip = (names: string[], start = 0): Trip => ({
  layoutId: 's',
  start,
  picks: names.map((name, i) => {
    const p = products.find((x) => x.name === name || x.id === name)!;
    return { productId: p.id, name: p.name, at: start + i };
  }),
});

describe('categorySequence', () => {
  it('collapses consecutive same-category picks and keeps first visit order', () => {
    expect(categorySequence(trip(['Apples', 'Apples', 'Milk', 'Pasta', 'Milk']).picks, catalog))
      .toEqual(['produce', 'dairy_eggs', 'pasta_rice_grains']);
  });

  it('skips picks with no category', () => {
    const picks = [{ name: 'Mystery thing', at: 1 }];
    expect(categorySequence(picks, catalog)).toEqual([]);
  });
});

describe('mergeRanks', () => {
  it('averages path indices across trips', () => {
    const ranks = mergeRanks({}, [
      ['produce', 'dairy_eggs', 'pasta_rice_grains'],
      ['produce', 'pasta_rice_grains', 'dairy_eggs'],
    ]);
    expect(ranks.produce).toEqual({ at: 0, n: 2 });
    expect(ranks.dairy_eggs!.at).toBeCloseTo(1.5);
    expect(ranks.pasta_rice_grains!.at).toBeCloseTo(1.5);
    expect(ranks.dairy_eggs!.n).toBe(2);
  });

  it('is stable when reapplied to the same sequences', () => {
    const seqs = [['produce', 'dairy_eggs'], ['produce', 'dairy_eggs']];
    const once = mergeRanks({}, seqs);
    const twice = mergeRanks({}, seqs);
    expect(twice).toEqual(once);
  });
});

describe('serpentine layout', () => {
  it('puts the first category near the lower right and snakes upward', () => {
    expect(serpentineSlot(0)).toEqual({ lane: 0, slot: 0, upward: true });
    const { width, height } = { width: 30, height: 24 };
    const first = areaOrigin(0, width, height);
    expect(first.x).toBe(width - MARGIN - CELL_W);
    expect(first.y).toBe(height - MARGIN - CELL_H);

    const second = areaOrigin(1, width, height);
    expect(second.x).toBe(first.x);
    expect(second.y).toBe(first.y - CELL_H - GAP);
  });

  it('starts the next lane to the left, going downward', () => {
    const slot = serpentineSlot(LANE_CAPACITY);
    expect(slot).toEqual({ lane: 1, slot: 0, upward: false });
    const a = areaOrigin(0, 40, 30);
    const b = areaOrigin(LANE_CAPACITY, 40, 30);
    expect(b.x).toBeLessThan(a.x);
    expect(b.y).toBe(MARGIN);
  });
});

describe('layoutFromRanks', () => {
  it('builds category areas and clears blank setup', () => {
    const ranks = mergeRanks({}, [['produce', 'dairy_eggs', 'pasta_rice_grains']]);
    const { layout, placeByCategory, changed } = layoutFromRanks(blank(), ranks, catalog.categoryById);
    expect(layout.places).toHaveLength(3);
    expect(layout.places.every((p) => p.kind === 'area' && isAutoPlace(p.id))).toBe(true);
    expect(layout.entrance.x).toBeGreaterThan(layout.checkout.x);
    expect(layout.entrance.y).toBe(layout.height - 1);
    expect(placeByCategory.produce).toBe(autoPlaceId('produce'));
    expect(changed).toHaveLength(3);
    expect(layout.gen?.setup).toBeUndefined();
    // First trip: still guesses until a second observation.
    expect(layout.places.every((p) => p.guess)).toBe(true);
  });

  it('keeps shopper-added non-auto places', () => {
    const base = blank();
    base.places = [{ kind: 'area', id: 'hand', label: 'My stand', x: 1, y: 1, w: 2, h: 2, categories: [] }];
    const ranks = { produce: { at: 0, n: 1 } };
    const { layout } = layoutFromRanks(base, ranks, catalog.categoryById);
    expect(layout.places.find((p) => p.id === 'hand')).toBeTruthy();
    expect(layout.places.some((p) => p.id === autoPlaceId('produce'))).toBe(true);
  });

  it('drops guess once a category has two observations', () => {
    const ranks = { produce: { at: 0, n: 2 } };
    const { layout } = layoutFromRanks(blank(), ranks, catalog.categoryById);
    expect(layout.places[0]?.guess).toBeUndefined();
  });
});

describe('placeProductsOnAreas', () => {
  it('sets locations on auto areas without clobbering exact spots', () => {
    const placeByCategory = { produce: autoPlaceId('produce'), dairy_eggs: autoPlaceId('dairy_eggs') };
    const withExact: Product[] = [
      { ...products[0]!, locations: { s: `${autoPlaceId('produce')}@0.2,0.3` } },
      products[1]!,
      { id: 'hand', name: 'Special', categoryId: 'snacks_chips', locations: { s: 'hand-shelf' } },
    ];
    const next = placeProductsOnAreas(withExact, 's', placeByCategory, catalog);
    expect(next[0]!.locations!.s).toBe(`${autoPlaceId('produce')}@0.2,0.3`);
    expect(next[1]!.locations!.s).toBe(autoPlaceId('dairy_eggs'));
    expect(next[2]!.locations!.s).toBe('hand-shelf');
  });
});

describe('applyAutoBuild', () => {
  it('rebuilds the map from check-off order in real time', () => {
    const r = applyAutoBuild(blank(), products, [trip(['Apples', 'Milk', 'Pasta'])], catalog);
    expect(r).toBeTruthy();
    expect(r!.layout.places.map((p) => p.categories[0])).toEqual(['produce', 'dairy_eggs', 'pasta_rice_grains']);
    expect(r!.layout.auto?.ranks.produce?.n).toBe(1);
    const milk = r!.products.find((p) => p.id === 'milk');
    expect(milk?.locations?.s).toBe(autoPlaceId('dairy_eggs'));
    expect(r!.at).toBeTruthy();
  });

  it('refines ranks across trips', () => {
    const trips = [
      trip(['Apples', 'Milk', 'Pasta']),
      trip(['Apples', 'Pasta', 'Milk'], 1e9),
    ];
    const r = applyAutoBuild(blank(), products, trips, catalog);
    expect(r!.layout.auto!.ranks.produce).toEqual({ at: 0, n: 2 });
    expect(r!.layout.auto!.ranks.dairy_eggs!.n).toBe(2);
    expect(r!.layout.places.find((p) => p.id === autoPlaceId('produce'))?.guess).toBeUndefined();
  });

  it('is idempotent for the same trips', () => {
    const trips = [trip(['Apples', 'Milk'])];
    const once = applyAutoBuild(blank(), products, trips, catalog)!;
    const twice = applyAutoBuild(once.layout, once.products, trips, catalog)!;
    expect(twice.layout.places).toEqual(once.layout.places);
    expect(twice.changed).toEqual([]);
  });

  it('does nothing when auto is disabled', () => {
    expect(applyAutoBuild(disableAuto(blank()), products, [trip(['Apples'])], catalog)).toBeUndefined();
  });

  it('untick rebuild: fewer categories when the only trip shrinks', () => {
    const full = applyAutoBuild(blank(), products, [trip(['Apples', 'Milk', 'Pasta'])], catalog)!;
    const shrunkTrip: Trip = {
      layoutId: 's',
      start: 0,
      picks: trip(['Apples', 'Milk']).picks,
    };
    const r = applyAutoBuild(full.layout, full.products, [shrunkTrip], catalog)!;
    expect(r.layout.places.map((p) => p.categories[0])).toEqual(['produce', 'dairy_eggs']);
  });
});

describe('handEditedAuto', () => {
  it('detects a shopper-added shelf and disableAuto clears live rebuild', () => {
    const before = applyAutoBuild(blank(), products, [trip(['Apples'])], catalog)!.layout;
    const after: StoreLayout = {
      ...before,
      places: [
        ...before.places,
        { kind: 'shelf', id: 'hand-1', label: 'Shelf', x: 2, y: 2, orientation: 'vertical', length: 6, categories: [] },
      ],
    };
    expect(handEditedAuto(before, after)).toBe(true);
    expect(disableAuto(after).auto?.enabled).toBe(false);
  });

  it('ignores auto rebuilds that only change ab- places', () => {
    const before = blank();
    const after = applyAutoBuild(before, products, [trip(['Apples', 'Milk'])], catalog)!.layout;
    // before has no ranks yet; treating a fresh auto apply as hand edit would be wrong —
    // handEditedAuto compares hand places, which stay empty.
    expect(handEditedAuto(before, after)).toBe(false);
  });
});

describe('rankedCategories', () => {
  it('sorts by rank', () => {
    expect(rankedCategories({
      pasta_rice_grains: { at: 2, n: 1 },
      produce: { at: 0, n: 1 },
      dairy_eggs: { at: 1, n: 1 },
    })).toEqual(['produce', 'dairy_eggs', 'pasta_rice_grains']);
  });
});
