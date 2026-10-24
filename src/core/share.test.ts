import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { defaultCategories, defaultProducts } from './categories';
import { demoLayout } from './demoLayout';
import { applyListShare, applyStoreShare, buildListShare, buildStoreShare, decodeShare, encodeShare, shareFromHash, type Data } from './share';
import type { Product } from './types';

const fresh = (): Data => ({ items: [], products: defaultProducts, categories: defaultCategories, layouts: [demoLayout] });

describe('share links', () => {
  it('round-trips a store through a compact link', async () => {
    const share = buildStoreShare(demoLayout, new Catalog(defaultProducts, defaultCategories));
    const text = await encodeShare(share);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text.length).toBeLessThan(3000);
    expect(await decodeShare(text)).toEqual(share);
    expect(shareFromHash(`#share=${text}`)).toBe(text);
  });

  it('rejects damaged links', async () => {
    await expect(decodeShare('not-a-share')).rejects.toThrow();
    await expect(decodeShare(await encodeShare({ v: 1, kind: 'store', items: [] } as never))).rejects.toThrow();
  });
});

describe('sharing a list', () => {
  it('adds new items, skips ones already on the list, and learns unknown items', () => {
    const sender = new Catalog([...defaultProducts, { id: 'k', name: 'Kombucha', categoryId: 'soda' }], defaultCategories);
    const share = buildListShare([
      { id: '1', name: 'milk', done: false },
      { id: '2', name: 'Kombucha', done: false, productId: 'k' },
      { id: '3', name: 'bread', done: true },
    ], sender);
    expect(share.items).toEqual([{ name: 'Milk', category: 'Dairy' }, { name: 'Kombucha', category: 'Soda & Sports Drinks' }]);

    const mine = { ...fresh(), items: [{ id: 'x', name: 'Milk', done: false }] };
    const result = applyListShare(share, mine);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);
    const kombucha = result.products.find((p) => p.name === 'Kombucha')!;
    expect(kombucha.categoryId).toBe('soda');
    expect(result.items[result.items.length - 1]).toMatchObject({ name: 'Kombucha', productId: kombucha.id });
  });
});

describe('sharing a store', () => {
  const senderProducts: Product[] = defaultProducts.map((p) =>
    p.name === 'Milk' ? { ...p, locations: { demo: 'a3' } } : p.name === 'Pretzels' ? { ...p, notAt: ['demo'] } : p);
  const share = buildStoreShare(demoLayout, new Catalog(senderProducts, defaultCategories));

  it('only sends item info for that store', () => {
    expect(share.items).toEqual([
      { name: 'Milk', category: 'Dairy', at: 'a3' },
      { name: 'Pretzels', category: 'Snacks & Chips', notAvailable: true },
    ]);
  });

  it('adds the store with its item locations', () => {
    const result = applyStoreShare(share, fresh());
    const added = result.layouts.find((l) => l.id === result.layoutId)!;
    expect(added.name).toBe('Demo Market (shared)');
    expect(result.products.find((p) => p.name === 'Milk')!.locations?.[result.layoutId]).toBe('a3');
    expect(result.products.find((p) => p.name === 'Pretzels')!.notAt).toEqual([result.layoutId]);
  });

  it('maps categories by name when ids differ, creating missing ones', () => {
    const renamed = { ...share, categories: share.categories.map((c) => ({ ...c, id: `their-${c.id}` })) };
    renamed.layout = { ...share.layout, places: share.layout.places.map((p) => ({ ...p, categories: p.categories.map((c) => `their-${c}`) })) };
    renamed.categories.push({ id: 'their-intl', name: 'International' });
    renamed.layout.places[0] = { ...renamed.layout.places[0], categories: ['their-intl'] };
    const result = applyStoreShare(renamed, fresh());
    const added = result.layouts.find((l) => l.id === result.layoutId)!;
    expect(added.places.find((p) => p.id === 'dairy')!.categories).toEqual(['dairy', 'eggs']);
    const intl = result.categories.find((c) => c.name === 'International')!;
    expect(added.places[0].categories).toEqual([intl.id]);
  });

  it('keeps the sender’s store id when it’s free, so updates are recognised later', () => {
    const theirs = { ...share, layout: { ...share.layout, id: 'their-store', name: 'Corner Co-op' } };
    const result = applyStoreShare(theirs, fresh());
    expect(result.layoutId).toBe('their-store');
    expect(result.layouts.find((l) => l.id === 'their-store')!.name).toBe('Corner Co-op');
  });

  it('can update an existing store in place', () => {
    const mine = { ...fresh(), products: defaultProducts.map((p) => (p.name === 'Eggs' ? { ...p, locations: { demo: 'a1' } } : p)) };
    const result = applyStoreShare(share, mine, 'demo');
    expect(result.layouts).toHaveLength(1);
    expect(result.layoutId).toBe('demo');
    expect(result.products.find((p) => p.name === 'Milk')!.locations?.demo).toBe('a3');
    // Our old location for eggs is replaced by the shared store's (none → category).
    expect(result.products.find((p) => p.name === 'Eggs')!.locations?.demo).toBeUndefined();
  });
});
