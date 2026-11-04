import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import {
  bestPrice,
  cheapestStoreTotal,
  clearStorePrice,
  indexPrices,
  listTotals,
  priceAt,
  priceCue,
  setStorePrice,
  unitKey,
} from './prices';
import type { ListItem, Product, StoreLayout } from './types';

const layout = (id: string, name = id): StoreLayout => ({
  id,
  name,
  width: 10,
  height: 10,
  places: [],
  entrance: { x: 0, y: 0 },
  checkout: { x: 1, y: 0 },
});

const milk = (): Product => ({ id: 'milk', name: 'Milk' });

describe('store prices', () => {
  it('sets, reads and clears a per-store price', () => {
    const p = setStorePrice(milk(), 'a', 3.49, 'each', '2026-01-01T00:00:00.000Z');
    expect(priceAt(p, 'a')).toEqual({ amount: 3.49, at: '2026-01-01T00:00:00.000Z' });
    expect(priceAt(p, 'b')).toBeUndefined();
    const cleared = clearStorePrice(p, 'a');
    expect(cleared.prices).toBeUndefined();
    expect(clearStorePrice(milk(), 'a')).toEqual(milk());
  });

  it('treats missing and each as the same unit key', () => {
    expect(unitKey(undefined)).toBe('each');
    expect(unitKey('each')).toBe('each');
    expect(unitKey('box')).toBe('box');
  });

  it('picks the cheapest comparable store price and skips notAt', () => {
    let p = setStorePrice(milk(), 'a', 3.49);
    p = setStorePrice(p, 'b', 2.99);
    p = setStorePrice(p, 'c', 2.5);
    p = { ...p, notAt: ['c'] };
    const layouts = [layout('a', 'Alpha'), layout('b', 'Beta'), layout('c', 'Closed')];
    expect(bestPrice(p, layouts)).toMatchObject({ layoutId: 'b', amount: 2.99 });
  });

  it('does not compare box vs each; prefers the preferred unit group', () => {
    let p = setStorePrice(milk(), 'a', 3.49);
    p = setStorePrice(p, 'b', 5.99, 'box');
    const layouts = [layout('a'), layout('b')];
    expect(bestPrice(p, layouts, { preferUnit: 'each' })?.layoutId).toBe('a');
    expect(bestPrice(p, layouts, { preferUnit: 'box' })?.layoutId).toBe('b');
  });

  it('indexes products for O(1) lookups', () => {
    let p = setStorePrice(milk(), 'a', 4);
    p = setStorePrice(p, 'b', 3);
    const idx = indexPrices([p], [layout('a'), layout('b')]);
    expect(idx.get('milk')?.byStore.get('b')?.amount).toBe(3);
    expect(idx.get('milk')?.best?.layoutId).toBe('b');
  });

  it('sums list totals with qty and tracks missing prices', () => {
    let milkP = setStorePrice(milk(), 'a', 3);
    milkP = setStorePrice(milkP, 'b', 2.5);
    const bread: Product = setStorePrice({ id: 'bread', name: 'Bread' }, 'a', 4);
    const layouts = [layout('a', 'A'), layout('b', 'B')];
    const catalog = new Catalog([milkP, bread], []);
    const items: ListItem[] = [
      { id: '1', name: 'Milk', done: false, productId: 'milk', qty: 2 },
      { id: '2', name: 'Bread', done: false, productId: 'bread' },
      { id: '3', name: 'Done milk', done: true, productId: 'milk' },
    ];
    const totals = listTotals(items, catalog, layouts);
    expect(totals.find((t) => t.layoutId === 'a')).toMatchObject({
      knownTotal: 10, // 3*2 + 4
      missingCount: 0,
      itemCount: 2,
    });
    expect(totals.find((t) => t.layoutId === 'b')).toMatchObject({
      knownTotal: 5, // 2.5*2; bread missing
      missingCount: 1,
      itemCount: 2,
    });
    expect(cheapestStoreTotal(totals)?.layoutId).toBe('a'); // fewer missing wins over lower known
  });

  it('builds a best-elsewhere cue for rows', () => {
    let p = setStorePrice(milk(), 'a', 3.49);
    p = setStorePrice(p, 'b', 2.99);
    const layouts = [layout('a', 'Alpha'), layout('b', 'Beta')];
    expect(priceCue(p, 'a', layouts)).toMatch(/\$3\.49/);
    expect(priceCue(p, 'a', layouts)).toContain('Best: Beta $2.99');
    expect(priceCue(p, 'a', layouts, 3.49)).toBe('Best: Beta $2.99');
    expect(priceCue(p, 'b', layouts)).toMatch(/\$2\.99/);
    expect(priceCue(p, 'b', layouts)?.includes('Best')).toBe(false);
  });
});
