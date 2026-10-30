import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { doorQuestion, guessDoor } from './door';
import { buildModel, regenerate } from './generate';
import type { Product, StoreLayout } from './types';

const p = (id: string, clue: object, categoryId?: string): Product => ({ id, name: id, ...(categoryId && { categoryId }), clues: { s: clue as never } });
const products = [p('apples', { kind: 'wall', wall: 'right', part: 'front' }, 'fruit'), p('cereal', { kind: 'aisle', aisle: '3' }, 'breakfast'), p('milk', { kind: 'wall', wall: 'left' }, 'dairy')];
const catalog = new Catalog(products, []);
const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 }, gen: { enabled: true, entrance: 'left', locked: [] } };
const store = regenerate(blank, buildModel(products, 's'));
const trip = (names: string[]) => ({ layoutId: 's', start: 0, picks: names.map((n, i) => ({ productId: n, name: n, at: i })) });

describe('where the door is', () => {
  it('starts in the middle of the front', () => {
    expect(store.entrance).toEqual({ x: Math.round(0.5 * (store.width - 1)), y: store.height - 1 });
  });

  it('guesses from where trips start, and asks once', () => {
    const trips = [trip(['apples', 'cereal', 'milk'])];
    expect(guessDoor(store, trips, catalog)!).toBeGreaterThan(0.8); // Produce: the right wall
    expect(doorQuestion(store, trips, catalog)).toEqual({ guess: 0.9 });
    const sure = { ...store, gen: { ...store.gen!, sure: ['entrance' as const] } };
    expect(doorQuestion(sure, trips, catalog)).toBeUndefined();
    expect(doorQuestion(store, [trip(['apples'])], catalog)).toBeUndefined(); // too short a trip to tell
  });

  it('moves the door and the checkouts beside it', () => {
    const l = regenerate({ ...store, gen: { ...store.gen!, door: 0.9, key: undefined } }, buildModel([...products, p('gum', { kind: 'checkout' })], 's'));
    expect(l.entrance.x).toBeGreaterThan(l.width * 0.8);
    const co = l.places.find((x) => x.id === 'g-checkout')!;
    expect(co.x + (co as any).w).toBeLessThanOrEqual(l.entrance.x);
  });
});
