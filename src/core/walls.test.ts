import { describe, expect, it } from 'vitest';
import { buildModel, regenerate } from './generate';
import type { Product, StoreLayout } from './types';
import { currentWalls, moveSection, offerWalls, trayFor } from './walls';

const p = (id: string, categoryId: string, clue: object): Product => ({ id, name: id, categoryId, clues: { s: clue as never } });
const products: Product[] = [
  p('apples', 'fruit', { kind: 'dept', dept: 'produce' }),
  p('bread', 'bakery', { kind: 'dept', dept: 'bakery' }),
  p('steak', 'meat', { kind: 'dept', dept: 'meat' }),
  p('cereal', 'breakfast', { kind: 'aisle', aisle: '3' }),
];
const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 15, y: 23 }, checkout: { x: 15, y: 23 },
  gen: { enabled: true, entrance: 'left', locked: [] } };
const model = buildModel(products, 's');
const store = regenerate(blank, model);

describe('the departments screen', () => {
  it('reads what is on each wall from the map, and what is not', () => {
    const walls = currentWalls(store);
    const on = [...walls.left, ...walls.back, ...walls.right];
    expect(on).toEqual(expect.arrayContaining(['produce', 'bakery', 'meat']));
    expect(trayFor(walls)).not.toContain('produce');
    expect(trayFor(walls)).toContain('pharmacy');
    expect(offerWalls(store)).toBe(true);
  });

  it('rebuilds the walls in the order the shopper set out', () => {
    const order = moveSection(moveSection(moveSection({ left: [], back: [], right: [] }, 'meat', 'left'), 'produce', 'left'), 'bakery', 'back');
    expect(order.left).toEqual(['meat', 'produce']);
    const set = regenerate({ ...store, gen: { ...store.gen!, wallOrder: order } }, model);
    const prod = set.places.find((x) => x.id === 'g-dept-produce')!;
    const meat = set.places.find((x) => x.id === 'g-dept-meat')!;
    const bak = set.places.find((x) => x.id === 'g-dept-bakery')!;
    expect(prod.x).toBe(meat.x); // both on the left wall
    expect(prod.x).toBeLessThan(5);
    expect(prod.y).toBeLessThan(meat.y); // produce further back (higher up the map)
    expect(bak.kind === 'shelf' && bak.orientation).toBe('horizontal'); // on the back wall
    // Read back as set out, and not offered again.
    const back = currentWalls(set);
    expect(back.left).toEqual(['meat', 'produce']);
    expect(back.back).toEqual(['bakery']);
    expect(offerWalls(set)).toBe(false);
  });

  it('keeps departments not heard of yet where they were put', () => {
    const order = { left: ['pharmacy', 'produce'], back: [], right: ['meat', 'bakery'] };
    const set = regenerate({ ...store, gen: { ...store.gen!, wallOrder: order } }, model);
    expect(currentWalls(set).left).toEqual(['pharmacy', 'produce']);
  });
});
