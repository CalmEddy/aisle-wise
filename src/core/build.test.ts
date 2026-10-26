import { describe, expect, it } from 'vitest';
import { defaultCategories } from './categories';
import { areaHere, blankStore, extendCandidates, growStore, planBuild, planChoice, step, turnShelf } from './build';
import { exactPoint, footprint, parseExactKey } from './geometry';
import type { Place, Shelf, StoreLayout } from './types';

const cat = (id: string) => defaultCategories.find((c) => c.id === id)!;
const store = (places: Place[] = []): StoreLayout => ({ ...blankStore('Test'), id: 't', width: 20, height: 20, places });
const shelf = (over: Partial<Shelf> = {}): Shelf => ({
  kind: 'shelf', id: 's1', label: 'Pasta & Rice', x: 5, y: 5, orientation: 'vertical', length: 4, categories: ['pasta'], ...over,
});
/** The square an item saved by a plan sits on. */
const where = (l: StoreLayout, key?: string) => {
  const e = parseExactKey(key!)!;
  return exactPoint(l.places.find((p) => p.id === e.placeId)!, e.spot);
};

describe('build mode', () => {
  it('creates a 3-square shelf centred on you, numbered and stocked with the item’s category', () => {
    const plan = planBuild(store(), { x: 10, y: 10 }, cat('pasta'));
    expect(plan.action).toBe('create');
    const s = plan.layout.places[0] as Shelf;
    expect(footprint(s)).toEqual({ x: 10, y: 9, w: 1, h: 3 });
    expect(s).toMatchObject({ label: 'Shelf 1', categories: ['pasta'], orientation: 'vertical' });
    expect(where(plan.layout, plan.spotKey)).toEqual({ x: 10, y: 10 });
  });

  it('numbers a shelf when the item has no category too, and can start sideways', () => {
    const plan = planBuild(store([shelf({ x: 1 })]), { x: 10, y: 10 }, undefined, 'horizontal');
    const s = plan.layout.places[1] as Shelf;
    expect(s).toMatchObject({ label: 'Shelf 1', categories: [], orientation: 'horizontal' }); // "Pasta & Rice" isn't numbered
    expect(footprint(s)).toEqual({ x: 9, y: 10, w: 3, h: 1 });
  });

  it('trims or shifts a new shelf to fit against walls and other places', () => {
    const atWall = planBuild(store(), { x: 10, y: 0 });
    expect(footprint(atWall.layout.places[0])).toEqual({ x: 10, y: 0, w: 1, h: 3 });
    const area: Place = { kind: 'area', id: 'a', label: 'Deli', x: 9, y: 11, w: 3, h: 3, categories: [] };
    const squeezed = planBuild(store([area, { ...area, id: 'b', y: 7 }]), { x: 10, y: 10 });
    expect(footprint(squeezed.layout.places[2])).toEqual({ x: 10, y: 10, w: 1, h: 1 });
  });

  it('uses the shelf you’re on or right beside, and adds the category at your end', () => {
    const l = store([shelf()]);
    const beside = planBuild(l, { x: 6, y: 8 }, cat('canned'));
    expect(beside.action).toBe('onShelf');
    expect(beside.layout.places[0].categories).toEqual(['pasta', 'canned']);
    expect(where(beside.layout, beside.spotKey)).toEqual({ x: 5, y: 8 });
    // Already there: nothing new added.
    expect(planBuild(l, { x: 4, y: 5 }, cat('pasta')).layout.places[0].categories).toEqual(['pasta']);
    // Two squares away is not "beside".
    expect(planBuild(l, { x: 7, y: 6 }).action).toBe('create');
  });

  it('extends a shelf from up to 3 squares past either end, keeping items where they were', () => {
    const l = store([shelf()]); // y 5..8
    const savedAt = 's1@0.875,0.5'; // the bottom square (y=8)
    const below = planBuild(l, { x: 5, y: 11 }, cat('canned'));
    expect(below.action).toBe('extend');
    expect(footprint(below.layout.places[0])).toEqual({ x: 5, y: 5, w: 1, h: 7 });
    expect(below.layout.places[0].categories).toEqual(['pasta', 'canned']);
    expect(where(below.layout, below.spotKey)).toEqual({ x: 5, y: 11 });
    expect(where(below.layout, below.rekey!(savedAt))).toEqual({ x: 5, y: 8 });

    const above = planBuild(l, { x: 6, y: 3 }, cat('baking')); // one square to the side still lines up
    expect(footprint(above.layout.places[0])).toEqual({ x: 5, y: 3, w: 1, h: 6 });
    expect(above.layout.places[0].categories).toEqual(['baking', 'pasta']);
    expect(where(above.layout, above.rekey!(savedAt))).toEqual({ x: 5, y: 8 });

    expect(planBuild(l, { x: 5, y: 12 }).action).toBe('create'); // 4 past the end: too far
    expect(planBuild(l, { x: 7, y: 10 }).action).toBe('create'); // not lined up
  });

  it('extends sideways shelves left and right', () => {
    const l = store([shelf({ orientation: 'horizontal', x: 5, y: 5 })]); // x 5..8
    const plan = planBuild(l, { x: 2, y: 4 });
    expect(plan.action).toBe('extend');
    expect(footprint(plan.layout.places[0])).toEqual({ x: 2, y: 5, w: 7, h: 1 });
  });

  it('won’t extend through another place', () => {
    const block: Place = { kind: 'area', id: 'a', label: 'Deli', x: 4, y: 9, w: 3, h: 1, categories: [] };
    expect(planBuild(store([shelf(), block]), { x: 5, y: 11 }).action).toBe('create');
  });

  it('saves the spot inside an open area', () => {
    const area: Place = { kind: 'area', id: 'a', label: 'Produce', x: 0, y: 0, w: 4, h: 4, categories: ['veg'] };
    const plan = planBuild(store([area]), { x: 3, y: 0 }, cat('fruit'));
    expect(plan.action).toBe('inArea');
    expect(plan.layout.places[0].categories).toEqual(['veg', 'fruit']);
    expect(where(plan.layout, plan.spotKey)).toEqual({ x: 3, y: 0 });
  });

  it('turns a shelf round the square level with you, keeping items in place', () => {
    const l = store([shelf({ length: 3, y: 9, x: 10 })]); // vertical x=10, y 9..11
    const t = turnShelf(l, 's1', { x: 11, y: 10 })!;
    expect(footprint(t.layout.places[0])).toEqual({ x: 9, y: 10, w: 3, h: 1 });
    // Middle stays in the middle; ends swap to left/right.
    expect(where(t.layout, t.rekey('s1@0.5,0.5'))).toEqual({ x: 10, y: 10 });
    expect(where(t.layout, t.rekey('s1@0.1,0.5'))).toEqual({ x: 9, y: 10 });
  });

  it('adds an open area around you that fits the free space', () => {
    const r = areaHere(store([shelf({ x: 8, y: 0, length: 20 })]), { x: 5, y: 5 })!;
    const f = footprint(r.area);
    expect(f.x + f.w).toBeLessThanOrEqual(8);
    expect(f.w * f.h).toBeGreaterThan(1);
    expect(areaHere(store([shelf()]), { x: 5, y: 6 })).toBeUndefined(); // on a shelf
  });

  it('grows the store when you step past an edge, keeping everything in place', () => {
    const l = store([shelf()]);
    const right = step(l, { x: 19, y: 3 }, 'right');
    expect(right.layout.width).toBe(25);
    expect(right.position).toEqual({ x: 20, y: 3 });
    const up = step(l, { x: 3, y: 0 }, 'up');
    expect(up.layout.height).toBe(25);
    expect(up.position).toEqual({ x: 3, y: 4 });
    expect(up.layout.places[0]).toMatchObject({ x: 5, y: 10 });
    expect(up.layout.entrance.y).toBe(l.entrance.y + 5);
    expect(growStore(l, 'down').layout.places[0]).toMatchObject({ x: 5, y: 5 });
  });

  it('in Area mode, makes a 3×3 area centred on you, numbered', () => {
    const plan = planBuild(store(), { x: 10, y: 10 }, cat('fruit'), 'vertical', 'area');
    expect(plan.action).toBe('createArea');
    expect(plan.layout.places[0]).toMatchObject({ kind: 'area', label: 'Area 1', x: 9, y: 9, w: 3, h: 3, categories: ['fruit'] });
    expect(where(plan.layout, plan.spotKey)).toEqual({ x: 10, y: 10 });
    expect(planBuild(store(), { x: 1, y: 1 }, undefined, 'vertical', 'area').layout.places[0]).toMatchObject({ label: 'Area 1' });
  });

  it('trims a new area to fit against walls and shelves', () => {
    const atCorner = planBuild(store(), { x: 0, y: 0 }, undefined, 'vertical', 'area');
    expect(footprint(atCorner.layout.places[0])).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    const corner = planBuild(store(), { x: 19, y: 19 }, undefined, 'vertical', 'area');
    expect(footprint(corner.layout.places[0])).toEqual({ x: 17, y: 17, w: 3, h: 3 });
    // Fits right up against shelves, and between two shelves three squares apart.
    const narrow = planBuild(store([shelf({ x: 12, y: 0, length: 20 })]), { x: 10, y: 5 }, undefined, 'vertical', 'area');
    expect(footprint(narrow.layout.places[1])).toEqual({ x: 9, y: 4, w: 3, h: 3 });
    const tight = planBuild(store([shelf({ x: 12, y: 0, length: 20 }), shelf({ id: 's2', x: 8, y: 0, length: 20 })]), { x: 10, y: 5 }, undefined, 'vertical', 'area');
    expect(footprint(tight.layout.places[2])).toEqual({ x: 9, y: 4, w: 3, h: 3 });
  });

  it('stretches an area to include you from up to 3 squares away, keeping items in place', () => {
    const area: Place = { kind: 'area', id: 'a', label: 'Produce', x: 5, y: 5, w: 3, h: 3, categories: ['veg'] };
    const l = store([area]);
    const plan = planBuild(l, { x: 10, y: 6 }, cat('fruit'), 'vertical', 'area');
    expect(plan.action).toBe('extendArea');
    expect(footprint(plan.layout.places[0])).toEqual({ x: 5, y: 5, w: 6, h: 3 });
    expect(plan.layout.places[0].categories).toEqual(['veg', 'fruit']);
    expect(where(plan.layout, plan.rekey!('a@0.5,0.5'))).toEqual({ x: 6, y: 6 });
    expect(planBuild(l, { x: 11, y: 6 }, undefined, 'vertical', 'area').action).toBe('createArea'); // 4 away
    // Inside or beside a shelf still wins over area building.
    expect(planBuild(store([shelf()]), { x: 6, y: 6 }, undefined, 'vertical', 'area').action).toBe('onShelf');
  });

  it('numbers new shelves and areas with the next free number', () => {
    const l = store([shelf({ label: 'Shelf 1' }), shelf({ id: 's3', x: 1, label: 'Shelf 3' }), shelf({ id: 'p', x: 3, label: 'Pasta' })]);
    expect((planBuild(l, { x: 15, y: 15 }, cat('pasta')).layout.places[3] as Shelf).label).toBe('Shelf 2');
    const withArea = store([{ kind: 'area', id: 'a', label: 'Area 1', x: 0, y: 15, w: 2, h: 2, categories: [] }]);
    expect(planBuild(withArea, { x: 15, y: 5 }, cat('fruit'), 'vertical', 'area').layout.places[1].label).toBe('Area 2');
    expect(areaHere(withArea, { x: 10, y: 5 })!.area.label).toBe('Area 2');
  });

  it('offers lined-up shelves at any distance, nearest in each direction', () => {
    const l = store([
      shelf({ id: 'above', label: 'Shelf 1', x: 10, y: 0, length: 3 }), // ends at y=2
      shelf({ id: 'above2', label: 'Shelf 9', x: 11, y: 0, length: 1 }), // also above, but further
      shelf({ id: 'below', label: 'Shelf 2', x: 9, y: 17, length: 3 }),
      shelf({ id: 'left', label: 'Shelf 3', x: 0, y: 10, length: 3, orientation: 'horizontal' }), // ends at x=2
      shelf({ id: 'off', label: 'Shelf 4', x: 14, y: 0, length: 5 }), // not lined up
    ]);
    const c = extendCandidates(l, { x: 10, y: 10 });
    expect(c[0]).toMatchObject({ shelfId: 'below', direction: 'up', gap: 7 }); // nearest first
    expect(c.map((x) => [x.shelfId, x.direction, x.gap]).sort()).toEqual([['above', 'down', 8], ['below', 'up', 7], ['left', 'right', 8]]);
  });

  it('skips shelves with something in the way', () => {
    const wall: Place = { kind: 'area', id: 'w', label: 'Deli', x: 9, y: 5, w: 3, h: 1, categories: [] };
    expect(extendCandidates(store([shelf({ x: 10, y: 0, length: 3 }), wall]), { x: 10, y: 10 })).toEqual([]);
  });

  it('extends the chosen shelf all the way to you, keeping its items in place', () => {
    const l = store([shelf({ id: 'above', label: 'Shelf 1', x: 10, y: 0, length: 3 })]);
    const plan = planChoice(l, { x: 11, y: 10 }, cat('canned'), { extend: 'above' });
    expect(plan.action).toBe('extend');
    expect(footprint(plan.layout.places[0])).toEqual({ x: 10, y: 0, w: 1, h: 11 });
    expect(plan.layout.places[0].categories).toEqual(['pasta', 'canned']);
    expect(where(plan.layout, plan.spotKey)).toEqual({ x: 10, y: 10 });
    expect(where(plan.layout, plan.rekey!('above@0.5,0.5'))).toEqual({ x: 10, y: 1 });
    // Or a new shelf / area instead.
    expect(planChoice(l, { x: 15, y: 10 }, undefined, 'shelf').action).toBe('create');
    expect(planChoice(l, { x: 15, y: 10 }, undefined, 'area').action).toBe('createArea');
  });
});

