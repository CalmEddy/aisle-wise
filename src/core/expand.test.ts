import { describe, expect, it } from 'vitest';
import { clearFor, expandKeepingWalls, isWallShelf, makeRoom, wallSide } from './expand';
import { footprint } from './geometry';
import type { Place, Shelf, StoreLayout } from './types';

const base = (places: Place[] = [], w = 20, h = 20): StoreLayout => ({
  id: 't', name: 'T', width: w, height: h, places, entrance: { x: 2, y: h - 1 }, checkout: { x: 10, y: h - 1 },
});

const shelf = (partial: Partial<Shelf> & { id: string }): Shelf => ({
  kind: 'shelf', label: partial.id, orientation: 'vertical', x: 5, y: 5, length: 5, categories: [], ...partial,
});

describe('makeRoom', () => {
  it('grows right/down so a rect past the edge fits', () => {
    const r = makeRoom(base(), [{ x: 18, y: 18, w: 5, h: 5 }]);
    expect(r.layout.width).toBeGreaterThanOrEqual(23);
    expect(r.layout.height).toBeGreaterThanOrEqual(23);
  });

  it('grows left/up and shifts contents', () => {
    const l = base([shelf({ id: 's', x: 2, y: 2 })]);
    const r = makeRoom(l, [{ x: -3, y: -2, w: 2, h: 2 }]);
    expect(r.shift.x).toBe(3);
    expect(r.shift.y).toBe(2);
    expect(r.layout.places[0]).toMatchObject({ x: 5, y: 4 });
  });
});

describe('expandKeepingWalls', () => {
  it('moves the right wall out and inserts space inside it', () => {
    const wall = shelf({ id: 'w', x: 18, y: 2, length: 10, back: 1, orientation: 'vertical' });
    const inner = shelf({ id: 'i', x: 10, y: 5, length: 4 });
    const l = base([wall, inner]);
    const r = expandKeepingWalls(l, [{ x: 16, y: 5, w: 3, h: 4 }], 1);
    const w = r.layout.places.find((p) => p.id === 'w')!;
    const i = r.layout.places.find((p) => p.id === 'i')!;
    expect(w.x).toBeGreaterThan(wall.x);
    expect(i.x).toBe(inner.x);
    expect(isWallShelf(w)).toBe(true);
    expect(wallSide(w as Shelf, r.layout)).toBe('right');
  });

  it('keeps the back wall at the top when growing up', () => {
    const wall = shelf({ id: 'back', x: 2, y: 1, length: 12, orientation: 'horizontal', back: -1 });
    const inner = shelf({ id: 'i', x: 5, y: 5, length: 4 });
    const l = base([wall, inner]);
    const r = expandKeepingWalls(l, [{ x: 5, y: 0, w: 4, h: 3 }], 1);
    const w = r.layout.places.find((p) => p.id === 'back')!;
    const i = r.layout.places.find((p) => p.id === 'i')!;
    expect(w.y).toBe(wall.y); // stays on the top rim
    expect(i.y).toBeGreaterThan(inner.y); // interior shifts down
    expect(r.shift.y).toBeGreaterThan(0);
  });
});

describe('clearFor', () => {
  it('pushes an overlapping shelf aside', () => {
    const existing = shelf({ id: 'e', x: 5, y: 5, length: 6, orientation: 'horizontal' });
    const l = base([existing]);
    const reserved = [{ x: 5, y: 5, w: 6, h: 1 }];
    const r = clearFor(l, reserved);
    const moved = r.layout.places.find((p) => p.id === 'e')!;
    expect(footprint(moved)).not.toEqual(reserved[0]);
    expect(Object.keys(r.shiftById)).toContain('e');
    // Reserved cells are free of the moved shelf.
    for (let x = 5; x < 11; x++) {
      expect(r.layout.places.some((p) => p.id === 'e' && p.x <= x && x < p.x + (p.kind === 'shelf' && p.orientation === 'horizontal' ? p.length : 1) && p.y === 5)).toBe(false);
    }
  });

  it('cascades and expands when pushed past the edge', () => {
    const a = shelf({ id: 'a', x: 17, y: 5, length: 3, orientation: 'vertical' });
    const l = base([a], 20, 20);
    const r = clearFor(l, [{ x: 17, y: 5, w: 1, h: 3 }], { preferAcross: 'x' });
    expect(r.layout.width).toBeGreaterThanOrEqual(20);
    const moved = r.layout.places.find((p) => p.id === 'a')!;
    expect(moved.x).not.toBe(17);
  });

  it('does not shove wall shelves inward', () => {
    const wall = shelf({ id: 'w', x: 0, y: 2, length: 10, back: -1 });
    const l = base([wall]);
    const r = clearFor(l, [{ x: 0, y: 2, w: 1, h: 4 }]);
    const w = r.layout.places.find((p) => p.id === 'w')!;
    // Wall may move outward with expansion, but stays a left wall.
    expect(wallSide(w as Shelf, r.layout)).toBe('left');
    expect(w.x).toBeLessThanOrEqual(2);
  });

  it('does not leave pushed shelves overlapping an unmoved neighbour', () => {
    const keep = shelf({ id: 'keep', x: 5, y: 12, length: 6, orientation: 'horizontal' });
    const move = shelf({ id: 'move', x: 5, y: 5, length: 6, orientation: 'horizontal' });
    const l = base([keep, move], 20, 20);
    // Reserve the move shelf's cells — it must leave, and must not land on keep.
    const reserved = [{ x: 5, y: 5, w: 6, h: 1 }];
    const r = clearFor(l, reserved, { preferAcross: 'y' });
    const a = r.layout.places.find((p) => p.id === 'keep')!;
    const b = r.layout.places.find((p) => p.id === 'move')!;
    expect(rectOverlap(footprint(a), footprint(b))).toBe(false);
    expect(rectOverlap(footprint(b), reserved[0])).toBe(false);
  });

  it('with gap keeps a corridor between reserved and neighbours', () => {
    const next = shelf({ id: 'n', x: 5, y: 6, length: 6, orientation: 'horizontal' });
    const l = base([next], 20, 20);
    // New shelf one row above, touching — gap:1 must push the neighbour.
    const reserved = [{ x: 5, y: 5, w: 6, h: 1 }];
    const r = clearFor(l, reserved, { preferAcross: 'y', gap: 1 });
    const moved = r.layout.places.find((p) => p.id === 'n')!;
    expect(moved.y).toBeGreaterThanOrEqual(7);
  });

  it('pushes a row of aisles clear of an earlier horizontal block', () => {
    const aisles = [8, 11, 14, 17, 20, 23, 26].map((x, i) =>
      shelf({ id: `a${i}`, x, y: 5, length: 20, orientation: 'vertical' }));
    // Earlier block sits below the aisles (as in the manual retest).
    const kept = [
      shelf({ id: 'B1', x: 5, y: 32, length: 30, orientation: 'horizontal' }),
      shelf({ id: 'B2', x: 5, y: 35, length: 30, orientation: 'horizontal' }),
      shelf({ id: 'B3', x: 5, y: 38, length: 30, orientation: 'horizontal' }),
    ];
    const l = base([...aisles, ...kept], 60, 45);
    // New horizontal block stamped over the aisle tops.
    const reserved = [
      { x: 5, y: 2, w: 30, h: 1 },
      { x: 5, y: 5, w: 30, h: 1 },
      { x: 5, y: 8, w: 30, h: 1 },
    ];
    const r = clearFor(l, reserved, { preferAcross: 'y' });
    const places = r.layout.places;
    for (let i = 0; i < places.length; i++) {
      for (let j = i + 1; j < places.length; j++) {
        expect(rectOverlap(footprint(places[i]), footprint(places[j])), `${places[i].id}×${places[j].id}`).toBe(false);
      }
    }
    for (const p of places) {
      for (const res of reserved) {
        const shifted = { ...res, x: res.x + r.shift.x, y: res.y + r.shift.y };
        expect(rectOverlap(footprint(p), shifted), `${p.id} on reserved`).toBe(false);
      }
    }
  });
});

const rectOverlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
