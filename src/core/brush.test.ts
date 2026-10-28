import { describe, expect, it } from 'vitest';
import { brushSegments, paintStep, rekeyInto, type Brush } from './brush';
import { Floor } from './floor';
import { Catalog } from './catalog';
import { moveHere, pickUp, shelvesAcross } from './build';
import type { Shelf, StoreLayout } from './types';

const store = (places: StoreLayout['places'] = [], w = 20, h = 20): StoreLayout =>
  ({ id: 's', name: 'S', width: w, height: h, entrance: { x: 0, y: h - 1 }, checkout: { x: 1, y: h - 1 }, places });
const aisle: Brush = { left: 'shelf', right: 'shelf', width: 2 };
const shelves = (l: StoreLayout) => (l.places.filter((p) => p.kind === 'shelf') as Shelf[]).map((s) => `${s.orientation[0]}${s.x},${s.y}+${s.length}${s.back ? ` back${s.back}` : ''}`).sort();

describe('aisle brush', () => {
  it('sides are relative to the way you walk', () => {
    // Walking up from (5,10): walkway is x 5–6, left shelf at x 4, right at x 7.
    expect(brushSegments({ x: 5, y: 10 }, 'up', aisle).map((s) => [s.side, s.across, s.start])).toEqual([['left', 4, 7], ['right', 7, 7]]);
    // Walking down: left is now the larger x.
    expect(brushSegments({ x: 5, y: 10 }, 'down', aisle).map((s) => [s.side, s.across, s.start])).toEqual([['left', 7, 10], ['right', 4, 10]]);
    // Walking right: left is up the map (smaller y).
    expect(brushSegments({ x: 5, y: 10 }, 'right', { ...aisle, width: 3 }).map((s) => [s.side, s.orientation, s.across])).toEqual([['left', 'horizontal', 8], ['right', 'horizontal', 12]]);
  });

  it('paints an aisle in steps, joining each side into one shelf', () => {
    let l = store();
    let p = { x: 5, y: 16 };
    for (let i = 0; i < 3; i++) {
      const r = paintStep(l, p, 'up', aisle);
      l = r.layout;
      p = r.position;
    }
    expect(p).toEqual({ x: 5, y: 4 });
    expect(shelves(l)).toEqual(['v4,5+12', 'v7,5+12']);
    expect(l.places.map((s) => s.label).sort()).toEqual(['Shelf 1', 'Shelf 2']);
  });

  it('walls are shelves stocked from the walkway side only', () => {
    const r = paintStep(store(), { x: 5, y: 10 }, 'up', { left: 'wall', right: 'gap', width: 2 });
    expect(shelves(r.layout)).toEqual(['v4,7+4 back-1']);
    const floor = new Floor(r.layout);
    expect(floor.distance({ x: 5, y: 8 }, { x: 4, y: 8 })).toBe(0); // from the walkway
    expect(floor.distance({ x: 3, y: 8 }, { x: 4, y: 8 })).toBeGreaterThan(3); // not through the back
  });

  it('skips squares something else is on, and keeps saved spots when shelves join', () => {
    const existing: Shelf = { kind: 'shelf', id: 'old', label: 'Old', orientation: 'vertical', x: 4, y: 3, length: 4, categories: ['c'] };
    const area = { kind: 'area' as const, id: 'a', label: 'A', x: 7, y: 8, w: 2, h: 2, categories: [] };
    const r = paintStep(store([existing, area]), { x: 5, y: 10 }, 'up', aisle);
    // Left joins "Old" (y 3–6) with the new y 7–10 → one shelf y 3–10.
    const joined = r.layout.places.find((p) => p.id === 'old') as Shelf;
    expect([joined.y, joined.length, joined.label]).toEqual([3, 8, 'Old']);
    // Right side skips the area's squares (y 8–9).
    expect(shelves(r.layout)).toContain('v7,7+1');
    expect(shelves(r.layout)).toContain('v7,10+1');
    expect(r.blocked).toBe(2);
    // An item saved at the bottom of "Old" stays on the same square.
    expect(r.rekey('old@0.875,0.5')).toBe('old@0.438,0.5');
    expect(r.rekey('old:c')).toBe('old:c');
  });

  it('turning a corner never paints over the walkway you came along', () => {
    let l = store();
    let p = { x: 5, y: 16 };
    const lanes = [];
    for (let i = 0; i < 2; i++) {
      const r = paintStep(l, p, 'up', aisle, lanes);
      l = r.layout;
      p = r.position;
      lanes.push(r.lane);
    }
    const turn = paintStep(l, p, 'right', { left: 'shelf', right: 'wall', width: 2 }, lanes);
    const floor = new Floor(turn.layout);
    // The old walkway is still all floor.
    for (let y = 9; y <= 16; y++) for (const x of [5, 6]) expect(floor.walkable({ x, y })).toBe(true);
    // And you can still walk back down it.
    expect(floor.distance(turn.position, { x: 5, y: 16 })).toBeLessThan(20);
  });

  it('paints a side with a category as you go, in walking order', () => {
    let l = store();
    let p = { x: 5, y: 16 };
    const steps: [string | undefined, number][] = [['cereal', 2], ['pasta', 1], [undefined, 1]];
    for (const [cat, n] of steps) {
      for (let i = 0; i < n; i++) {
        const r = paintStep(l, p, 'up', { ...aisle, leftCategory: cat, rightCategory: 'snacks' });
        l = r.layout;
        p = r.position;
      }
    }
    const left = (l.places as Shelf[]).find((s) => s.x === 4)!;
    const right = (l.places as Shelf[]).find((s) => s.x === 7)!;
    // Walking up, later steps are higher up the map (the start of a vertical shelf).
    expect(left.categories).toEqual(['pasta', 'cereal']);
    expect(right.categories).toEqual(['snacks']);
    expect(left.length).toBe(16);
  });

  it('grows the store when painting past its edge', () => {
    const r = paintStep(store([], 10, 10), { x: 5, y: 2 }, 'up', aisle);
    expect(r.layout.height).toBeGreaterThan(10);
    expect(r.shift.y).toBeGreaterThan(0);
    expect(r.position.y).toBeGreaterThanOrEqual(0);
    expect(r.layout.places.every((p) => p.y >= 0)).toBe(true);
  });

  it('moves spots from one shelf onto another on the same line', () => {
    const a: Shelf = { kind: 'shelf', id: 'a', label: 'A', orientation: 'horizontal', x: 10, y: 2, length: 2, categories: [] };
    const b: Shelf = { ...a, id: 'b', x: 6, length: 6 };
    expect(rekeyInto(a, b)('a@0.25,0.5')).toBe('b@0.75,0.5');
    expect(rekeyInto(a, b)('a')).toBe('b');
  });
});

describe('which side was it on?', () => {
  const painted = () => {
    let l = store();
    let p = { x: 5, y: 16 };
    for (let i = 0; i < 2; i++) {
      const r = paintStep(l, p, 'up', aisle);
      l = r.layout;
      p = r.position;
    }
    return l;
  };

  it('finds the shelf on each side of the walkway', () => {
    const l = painted();
    const opts = shelvesAcross(l, { x: 5, y: 12 }, 2);
    expect(opts.map((o) => o.side)).toEqual(['left', 'right']);
    // From the other walkway square too.
    expect(shelvesAcross(l, { x: 6, y: 12 }, 2)).toHaveLength(2);
    // A wall facing away doesn't count; nor does a walkway wider than the reach.
    const walls = paintStep(store(), { x: 5, y: 12 }, 'up', { left: 'shelf', right: 'wall', width: 2 }).layout;
    expect(shelvesAcross(walls, { x: 5, y: 10 }, 2)).toHaveLength(2);
    const backwards = { ...walls, places: walls.places.map((pl) => (pl.kind === 'shelf' && pl.back ? { ...pl, back: -pl.back as 1 | -1 } : pl)) };
    expect(shelvesAcross(backwards, { x: 5, y: 10 }, 2)).toHaveLength(0);
    expect(shelvesAcross(l, { x: 5, y: 12 }, 1)).toHaveLength(0);
  });

  it('asks on pick-up, then saves the item on the chosen side', () => {
    const l = painted();
    const catalog = new Catalog([], []);
    const state = { items: [], products: [], layout: l, catalog };
    const r = pickUp(state, 'Jam', undefined, { x: 5, y: 12 }, 'shelf', false, 2);
    expect(r.outcome.kind).toBe('chooseSide');
    expect(r.layout).toBe(l);
    expect(r.items[0].done).toBe(true);
    const right = r.outcome.kind === 'chooseSide' ? r.outcome.options[1].shelfId : '';
    const placed = moveHere({ products: r.products, layout: r.layout, catalog: new Catalog(r.products, []) }, r.products[0].id, { x: 5, y: 12 }, { onShelf: right })!;
    expect(placed.products[0].locations?.s?.startsWith(right)).toBe(true);
    // Without a reach (not walking an aisle) it doesn't ask.
    expect(pickUp(state, 'Jam', undefined, { x: 5, y: 12 }).outcome.kind).toBe('built');
  });
});
