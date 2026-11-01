import { describe, expect, it } from 'vitest';
import { buildModel, regenerate } from './generate';
import { parseExactKey } from './geometry';
import { buildHere, hereOptions, type HereOption } from './here';
import type { Clue, Product, Shelf, StoreLayout } from './types';

// Aisle 3 runs from y 2 to 11, 3L on its left and 3R on its right; a cross walkway below it.
const v = (id: string, label: string, x: number, y = 2, length = 10): Shelf => ({ kind: 'shelf', id, label, orientation: 'vertical', x, y, length, categories: [] });
const store: StoreLayout = {
  id: 's', name: 'S', width: 20, height: 22, entrance: { x: 1, y: 21 }, checkout: { x: 15, y: 21 },
  places: [v('l', '3L', 5), v('r', '3R', 8)],
  aisles: [{ id: 'a3', label: 'Aisle 3', x: 6, y: 2, w: 2, h: 10 }],
};
const kinds = (os: HereOption[]) => os.map((o) => o.label);

describe('“Where I’m standing”', () => {
  it('on a shelf: that shelf, or turn it', () => {
    expect(kinds(hereOptions(store, { x: 8, y: 5 }))).toEqual(['3R', 'Turn 3R ↔']);
  });

  it('past the end of an aisle, in line with its right side: carry the aisle on, stretch 3R, or something new', () => {
    expect(kinds(hereOptions(store, { x: 8, y: 15 }))).toEqual(['Aisle 3 carries on here · 3R', 'Stretch 3R down 4', 'New shelf ↕', 'New shelf ↔', 'New area']);
    // In the walkway's line: either side.
    expect(kinds(hereOptions(store, { x: 6, y: 15 })).slice(0, 2)).toEqual(['Aisle 3 carries on here · 3L', 'Aisle 3 carries on here · 3R']);
  });

  it('carrying the aisle on builds both sides past the walkway, the item on its side, and the aisle runs on', () => {
    const o = hereOptions(store, { x: 8, y: 15 })[0];
    const r = buildHere(store, { x: 8, y: 15 }, o, { id: 'canned_pickles_olives', name: 'Pickles & Olives' })!;
    const added = r.layout.places.slice(2) as Shelf[];
    expect(added.map((s) => [s.label, s.x, s.y, s.length, s.categories])).toEqual([['3L', 5, 14, 3, []], ['3R', 8, 14, 3, ['canned_pickles_olives']]]);
    expect(r.layout.aisles![0]).toMatchObject({ y: 2, h: 15 });
    expect(parseExactKey(r.spotKey!)?.placeId).toBe(added[1].id);
    expect(r.note).toBe('Aisle 3 carries on here (3L and 3R).');
  });

  it('a new shelf either way, a new area, a stretched shelf', () => {
    const p = { x: 14, y: 15 };
    const shelf = buildHere(store, p, { kind: 'shelf', orientation: 'horizontal', label: '' })!;
    expect(shelf.layout.places[2]).toMatchObject({ orientation: 'horizontal', y: 15, length: 3 });
    expect(buildHere(store, p, { kind: 'area', label: '' })!.layout.places[2].kind).toBe('area');
    const stretched = buildHere(store, { x: 8, y: 14 }, { kind: 'extend', shelfId: 'r', label: 'Stretch 3R down 3' })!;
    expect(stretched.layout.places[1]).toMatchObject({ y: 2, length: 13 });
  });
});

describe('carrying an aisle on in a built map', () => {
  const P = (name: string, categoryId: string, clue: Clue): Product => ({ id: name, name, categoryId, clues: { s: clue } });
  const base: Product[] = [P('Bananas', 'produce_fruits', { kind: 'dept', dept: 'produce' }), P('Cereal', 'breakfast_cereal', { kind: 'aisle', aisle: '1' }), P('Pasta', 'pasta_dry', { kind: 'aisle', aisle: '3' })];
  const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 15, y: 23 }, checkout: { x: 15, y: 23 }, gen: { enabled: true, entrance: 'left', locked: [] } };

  it('the new part is kept and moves with its aisle when the map grows', () => {
    const three = regenerate(blank, buildModel(base, 's'));
    const a1 = three.aisles!.find((a) => a.label === 'Aisle 1')!;
    const right = three.places.find((p) => p.id === 'g-shelf-1-L')!; // aisle 1's other side is the produce wall
    const p = { x: right.x, y: a1.y + a1.h + 3 };
    const o = hereOptions(three, p).find((x) => x.kind === 'continue')!;
    expect(o).toBeDefined();
    const built = buildHere(three, p, o)!;
    const piece = built.layout.places.find((x) => x.id.startsWith('g-shelf-1-L~c'))!;
    expect(built.layout.gen!.locked).toContain(piece.id);
    const four = regenerate(built.layout, buildModel([...base, P('Soup', 'canned_soup_broth', { kind: 'aisle', aisle: '4' })], 's'));
    const moved = four.places.find((x) => x.id === piece.id)!;
    const shelf = four.places.find((x) => x.id === 'g-shelf-1-L')!;
    expect(moved.x).toBe(shelf.x); // still in line with 1L
    expect(four.aisles!.find((a) => a.label === 'Aisle 1')!.h).toBeGreaterThan(a1.h); // the aisle still runs on
  });
});
