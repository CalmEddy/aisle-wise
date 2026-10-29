import { describe, expect, it } from 'vitest';
import { distanceText, metresBetween, storeHere, storesByDistance } from './stores';
import type { StoreLayout } from './types';

const store = (id: string, geo?: { lat: number; lon: number }) =>
  ({ id, name: id, width: 10, height: 10, places: [], entrance: { x: 0, y: 9 }, checkout: { x: 5, y: 9 }, ...(geo && { geo }) }) as StoreLayout;

describe('stores by location', () => {
  const here = { lat: 39.1, lon: -84.5 };
  const stores = [store('far', { lat: 39.2, lon: -84.5 }), store('nogeo'), store('near', { lat: 39.1005, lon: -84.5 })];
  it('measures distances', () => {
    expect(metresBetween(here, { lat: 39.101, lon: -84.5 })).toBeCloseTo(111, 0);
    expect(distanceText(123)).toBe('120 m');
    expect(distanceText(1440)).toBe('1.4 km');
  });
  it('lists nearest first and picks the store you are at', () => {
    expect(storesByDistance(stores, here).map((r) => r.layout.id)).toEqual(['near', 'far', 'nogeo']);
    expect(storeHere(stores, here)?.id).toBe('near');
    expect(storeHere(stores, { lat: 39.15, lon: -84.5 })).toBeUndefined();
  });
});
