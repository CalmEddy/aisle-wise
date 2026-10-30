import { describe, expect, it } from 'vitest';
import { buildModel, regenerate } from './generate';
import { pendingPlacements, placementOptions, type PlacementSubject } from './placement';
import type { Product, StoreLayout } from './types';

const p = (id: string, categoryId: string | undefined, clue: object): Product => ({ id, name: id, ...(categoryId && { categoryId }), clues: { s: clue as never } });
const products: Product[] = [
  p('apples', 'fruit', { kind: 'wall', wall: 'right', part: 'front' }),
  p('bread', 'bakery', { kind: 'dept', dept: 'bakery' }), // a department, but where?
  p('cereal', 'breakfast', { kind: 'aisle', aisle: '3' }),
  p('melon', 'fruit', { kind: 'open', fixture: 'table' }), // out in the open, but where?
];
const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
  gen: { enabled: true, entrance: 'left', locked: [] } };
const store = regenerate(blank, buildModel(products, 's'));

describe('placing new things relative to what’s on the map', () => {
  it('asks about things the map has only guessed (departments are set out on the departments screen instead)', () => {
    const pending = pendingPlacements(store, products);
    expect(pending.map((s) => [s.ref, s.name])).toEqual([['isl:middle-table-room', 'Produce table']]);
  });

  it('offers spots next to what’s there, each with a preview', () => {
    const bakery: PlacementSubject = { ref: 'sec:bakery', name: 'Bakery', placeId: 'g-dept-bakery' };
    const opts = placementOptions(store, products, bakery);
    const labels = opts.map((o) => o.label);
    expect(labels).toEqual(expect.arrayContaining(['Right wall, in front of Produce', 'Right wall, behind Produce', 'Left wall', 'Back wall']));
    // "Behind Produce": up the right wall, further back than Produce.
    const behind = opts.find((o) => o.label === 'Right wall, behind Produce')!;
    const prod = behind.preview.places.find((x) => x.id === 'g-dept-produce')!;
    const bak = behind.preview.places.find((x) => x.id === 'g-dept-bakery')!;
    expect(bak.x).toBe(prod.x);
    expect(bak.y).toBeLessThan(prod.y);
    // On the left wall instead.
    const left = opts.find((o) => o.label === 'Left wall')!;
    expect(left.ghost.x).toBeLessThan(5);
  });

  it('keeps the choice: rebuilds follow it, and it isn’t asked again', () => {
    const placed = { ...store, gen: { ...store.gen!, placements: { 'sec:bakery': { of: 'sec:produce', side: 'before' as const } } } };
    const rebuilt = regenerate(placed, buildModel(products, 's'));
    const prod = rebuilt.places.find((x) => x.id === 'g-dept-produce')!;
    const bak = rebuilt.places.find((x) => x.id === 'g-dept-bakery')!;
    expect(bak.y).toBeGreaterThan(prod.y); // in front of Produce (nearer the bottom)
    expect(pendingPlacements(rebuilt, products).map((s) => s.ref)).toEqual(['isl:middle-table-room']);
  });

  it('places a table by an aisle', () => {
    const table = pendingPlacements(store, products)[0];
    const opts = placementOptions(store, products, table);
    const by3 = opts.find((o) => o.label === 'By aisle 3')!;
    const aisle3 = by3.preview.aisles!.find((a) => a.id === 'g-aisle-3')!;
    expect(Math.abs(by3.ghost.x + by3.ghost.w / 2 - (aisle3.x + aisle3.w / 2))).toBeLessThanOrEqual(1.5);
  });
});
