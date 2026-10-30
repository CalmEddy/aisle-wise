import { describe, expect, it } from 'vitest';
import { buildModel, regenerate } from './generate';
import { formatLabel, guessRoles, looksLikeShelfCode, nextShelves, parseLabel, shelfOffsets, tokenize, type LabelStyle } from './labels';
import { resolveClue } from './clues';
import type { Product, Shelf, StoreLayout } from './types';

const b12: LabelStyle = { example: 'B12', roles: ['section', 'shelf'], pairing: 'backToBack' };

describe('shelf labels taught by example', () => {
  it('splits labels into parts and guesses what they mean', () => {
    expect(tokenize('b-12')).toEqual([{ text: 'B', kind: 'letters' }, { text: '12', kind: 'digits' }]);
    expect(guessRoles('B12')).toEqual(['section', 'shelf']);
    expect(guessRoles('12-3')).toEqual(['section', 'shelf']);
    expect(guessRoles('AA-4-2')).toEqual(['section', 'ignore', 'shelf']);
  });

  it('tells shelf codes from aisle numbers', () => {
    expect(looksLikeShelfCode('B12')).toBe(true);
    expect(looksLikeShelfCode('12-3')).toBe(true);
    expect(looksLikeShelfCode('12')).toBe(false);
    expect(looksLikeShelfCode('12B')).toBe(false); // aisle 12, side B
  });

  it('reads and writes labels in the store’s style', () => {
    expect(parseLabel(b12, 'c7')).toEqual({ section: 'C', shelf: 7 });
    expect(parseLabel(b12, '12')).toBeUndefined();
    const dash: LabelStyle = { example: '12-3', roles: ['section', 'shelf'], pairing: 'single' };
    expect(parseLabel(dash, '4-11')).toEqual({ section: '4', shelf: 11 });
    expect(formatLabel(dash, '4', 11)).toBe('4-11');
    expect(formatLabel(b12, 'D', 2)).toBe('D2');
  });

  it('offers the next shelves the way you’re going', () => {
    expect(nextShelves([{ section: 'B', shelf: 3 }, { section: 'B', shelf: 5 }]).map((s) => s.shelf)).toEqual([5, 6, 7, 9]);
    // The next one up is always offered, even after a jump (B4 then B7 → B8).
    expect(nextShelves([{ section: 'B', shelf: 4 }, { section: 'B', shelf: 7 }]).map((s) => s.shelf)).toEqual([7, 8, 9, 11]);
    expect(nextShelves([{ section: 'B' }])).toEqual([]);
  });

  it('stands shelves the way the store does', () => {
    expect(shelfOffsets('single', 4)).toEqual([0, 3, 6, 9]);
    expect(shelfOffsets('backToBack', 4)).toEqual([0, 1, 4, 5]); // 1|2 · 3|4
    expect(shelfOffsets('facing', 5)).toEqual([0, 3, 4, 7, 8]); // 1 · 2|3 · 4|5
  });
});

describe('a store built from shelf labels', () => {
  const shelf = (id: string, code: string, categoryId: string): Product => {
    const p = parseLabel(b12, code)!;
    return { id, name: id, categoryId, clues: { s: { kind: 'shelf', code, section: p.section, shelf: p.shelf } } };
  };
  const products = [shelf('cereal', 'A2', 'breakfast'), shelf('pasta', 'A4', 'pasta'), shelf('chips', 'C3', 'snacks')];
  const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
    gen: { enabled: true, entrance: 'left', locked: [] }, labels: b12 };

  it('draws each section as a block of numbered shelves, with B filled in between A and C', () => {
    const l = regenerate(blank, buildModel(products, 's'));
    const shelves = l.places.filter((p): p is Shelf => p.id.startsWith('g-sec-'));
    expect(shelves.map((p) => `${p.label}${p.guess ? '?' : ''}`).sort()).toEqual(['A1?', 'A2', 'A3?', 'A4', 'B1?', 'C1?', 'C2?', 'C3'].sort());
    const x = (label: string) => shelves.find((p) => p.label === label)!.x;
    // Back to back in pairs, shelf 1 on the right: A1|A2 then a walkway, then A3|A4.
    expect(x('A1') - x('A2')).toBe(1);
    expect(x('A2') - x('A3')).toBe(3);
    // Each next section to the left.
    expect(x('C1')).toBeLessThan(x('B1'));
    expect(x('B1')).toBeLessThan(x('A4'));
    // Answers land on their shelf.
    expect(resolveClue(products[1].clues!.s, l)?.split('@')[0]).toBe('g-sec-A-4');
  });

  it('puts a section where the shopper placed it', () => {
    const placed = { ...blank, gen: { ...blank.gen!, placements: { 'block:C': { of: 'block:A', side: 'below' as const } } } };
    const l = regenerate(placed, buildModel(products, 's'));
    const p = (label: string) => l.places.find((x) => x.label === label)!;
    expect(p('C1').y).toBeGreaterThan(p('A1').y + 9);
  });
});

describe('placing a new section', () => {
  it('doesn’t ask: C goes left of A (letter order, B between); placed on request with spots around A', async () => {
    const { blockSubject, pendingPlacements, placementOptions } = await import('./placement');
    const b12s: LabelStyle = { example: 'B12', roles: ['section', 'shelf'], pairing: 'backToBack' };
    const mk = (id: string, code: string): Product => { const p = parseLabel(b12s, code)!; return { id, name: id, clues: { s: { kind: 'shelf', code, section: p.section, shelf: p.shelf } } }; };
    const products = [mk('x', 'A2'), mk('y', 'C3')];
    const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
      gen: { enabled: true, entrance: 'left', locked: [] }, labels: b12s };
    const l = regenerate(blank, buildModel(products, 's'));
    expect(pendingPlacements(l, products)).toEqual([]);
    const at = (label: string) => l.places.find((p) => p.label === label)!;
    expect(at('C1').x).toBeLessThan(at('A1').x);
    const opts = placementOptions(l, products, blockSubject(l, 'block:C')!);
    expect(opts.map((o) => o.label)).toEqual(expect.arrayContaining(['In front of section A', 'Behind section A', 'Right of section A']));
    const below = opts.find((o) => o.label === 'In front of section A')!;
    const a1 = below.preview.places.find((p) => p.label === 'A1')!;
    expect(below.ghost.y).toBeGreaterThan(a1.y + 9);
  });
});

describe('placing a section from the one you started in', () => {
  it('puts A right of B by itself (letter order), without asking', async () => {
    const { pendingPlacements } = await import('./placement');
    const style: LabelStyle = { example: 'B12', roles: ['section', 'shelf'], pairing: 'backToBack' };
    const mk = (id: string, code: string): Product => { const p = parseLabel(style, code)!; return { id, name: id, clues: { s: { kind: 'shelf', code, section: p.section, shelf: p.shelf } } }; };
    const products = [mk('x', 'B4'), mk('y', 'B5'), mk('z', 'A2')];
    const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
      gen: { enabled: true, entrance: 'left', locked: [] }, labels: style };
    const l = regenerate(blank, buildModel(products, 's'));
    expect(pendingPlacements(l, products)).toEqual([]);
    const p = (label: string) => l.places.find((x) => x.label === label)!;
    expect(p('A1').x).toBeGreaterThan(p('B1').x);
  });
});
