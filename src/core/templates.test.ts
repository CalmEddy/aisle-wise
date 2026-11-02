import { describe, expect, it } from 'vitest';
import { PIN_CONFIDENCE, STORE_TEMPLATES } from '../data/storeTemplates';
import { Catalog } from './catalog';
import { defaultCategories } from './categories';
import { DEPTS } from './clues';
import { regenerate } from './generate';
import { withHoldings } from './holdings';
import { locateProduct } from './locate';
import { SEED_CATEGORIES, TAXONOMY_NAMES, topOf } from './taxonomy';
import { seedClue, storeFromTemplate, storeModel, templateKinds } from './templates';
import type { Product } from './types';

describe('the default store maps', () => {
  it('use only real categories and departments, and seed every category', () => {
    for (const t of STORE_TEMPLATES) {
      for (const s of t.seeds) {
        expect(TAXONOMY_NAMES.has(s.category), `${t.id}: ${s.category}`).toBe(true);
        expect(s.confidence).toBeGreaterThan(0);
        if (s.clue.kind === 'dept') expect(DEPTS.map((d) => d.id)).toContain(s.clue.dept);
        if (s.clue.kind === 'aisleAt') expect(t.aisles).toBeGreaterThan(0);
      }
      const tops = new Set(t.seeds.map((s) => topOf(s.category)));
      // Every category but Baby & Pet's neighbours is seeded somewhere sensible (all 22 for aisle stores).
      expect(SEED_CATEGORIES.filter((c) => !tops.has(c.id)).map((c) => c.id), t.id).toEqual([]);
      const walls = Object.values(t.gen.wallOrder ?? {}).flat();
      expect(new Set(walls).size, `${t.id}: a department on two walls`).toBe(walls.length);
    }
  });

  it('aisle seeds scale to the number of aisles', () => {
    const seed = { category: 'snacks', clue: { kind: 'aisleAt' as const, at: 0.5 }, confidence: 0.8 };
    expect(seedClue(seed, 12)).toEqual({ kind: 'aisle', aisle: '7' });
    expect(seedClue(seed, 5)).toEqual({ kind: 'aisle', aisle: '3' });
    expect(seedClue({ ...seed, clue: { kind: 'aisleAt', at: 1 } }, 9)).toEqual({ kind: 'aisle', aisle: '9' });
  });

  it('each makes a map with its aisles drawn as guesses, and the sure kinds placed', () => {
    for (const t of STORE_TEMPLATES) {
      const l = storeFromTemplate('S', t.id);
      expect(l.places.length, t.id).toBeGreaterThan(3);
      if (t.aisles) {
        expect((l.aisles ?? []).length, t.id).toBe(t.aisles);
        expect(l.places.filter((p) => p.id.startsWith('g-shelf-')).every((p) => p.guess), t.id).toBe(true);
      }
      const milk = { id: 'm', name: 'Milk', categoryId: 'dairy_milk' } as Product;
      const r = locateProduct(milk, withHoldings(l, [milk]), new Catalog([milk], defaultCategories));
      expect(r.kind, t.id).toBe('spot');
    }
  });

  it('the shopper picks the number of aisles', () => {
    expect(storeFromTemplate('S', 'conventional', 18).aisles).toHaveLength(18);
    expect(storeFromTemplate('S', 'blank').gen).toBeUndefined();
  });

  it('a real answer replaces the seed for its kind', () => {
    const l = storeFromTemplate('S', 'conventional');
    const kinds = templateKinds(l, []);
    expect(kinds.has('dairy_eggs')).toBe(true);
    const milk: Product = { id: 'm', name: 'Milk', categoryId: 'dairy_milk', clues: { [l.id]: { kind: 'wall', wall: 'left', temp: 'chilled' } } };
    expect(templateKinds(l, [milk]).has('dairy_eggs')).toBe(false);
    // Rebuilt: milk goes where the answer said (cheese, still a guess, keeps Dairy on the back wall); the aisles
    // stay guesses until one is answered.
    const after = withHoldings(regenerate(l, storeModel(l, [milk])), [milk]);
    const r = locateProduct(milk, after, new Catalog([milk], defaultCategories));
    expect(r.kind === 'spot' && r.spot.placeId).toBe('g-wall-left-chilled');
    expect(after.aisles).toHaveLength(12);
  });

  it('low-confidence seeds put nothing on the map', () => {
    const l = storeFromTemplate('S', 'conventional');
    const t = STORE_TEMPLATES[0];
    const low = t.seeds.filter((s) => s.confidence < PIN_CONFIDENCE).map((s) => s.category);
    expect(low.length).toBeGreaterThan(0);
    for (const c of low) expect(l.places.some((p) => p.categories.includes(c)), c).toBe(false);
  });
});
