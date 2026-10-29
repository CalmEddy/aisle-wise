import { describe, expect, it } from 'vitest';
import { stripFocus } from './geometry';

describe('map strip', () => {
  const store = { width: 60, height: 40 };
  it('shows you and the next stop, wide and inside the store', () => {
    const r = stripFocus(store, { x: 10, y: 38 }, { x: 30, y: 20 });
    for (const p of [{ x: 10, y: 38 }, { x: 30, y: 20 }]) {
      expect(p.x).toBeGreaterThanOrEqual(r.x);
      expect(p.x).toBeLessThan(r.x + r.w);
      expect(p.y).toBeGreaterThanOrEqual(r.y);
      expect(p.y).toBeLessThan(r.y + r.h);
    }
    expect(r.w / r.h).toBeGreaterThan(1.4);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y + r.h).toBeLessThanOrEqual(40);
  });
  it('a small store fits whole', () => {
    const r = stripFocus({ width: 12, height: 8 }, { x: 1, y: 7 });
    expect(r).toMatchObject({ x: 0, y: 0, w: 12 });
  });
});
