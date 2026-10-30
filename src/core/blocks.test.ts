import { describe, expect, it } from 'vitest';
import { Floor } from './floor';
import { buildModel, regenerate } from './generate';
import { parseLabel, type LabelStyle } from './labels';
import { pendingPlacements, placementOptions } from './placement';
import type { Product, Shelf, StoreLayout } from './types';

const aisle = (n: number): Product => ({ id: `p${n}`, name: `P${n}`, categoryId: 'snacks', clues: { s: { kind: 'aisle', aisle: String(n), side: 'L' } } });
const products = [1, 2, 3, 4, 5, 6].map(aisle);
const blank: StoreLayout = { id: 's', name: 'S', width: 30, height: 24, places: [], entrance: { x: 2, y: 23 }, checkout: { x: 15, y: 23 },
  gen: { enabled: true, entrance: 'left', locked: [] } };

describe('blocks of shelving that run different ways', () => {
  it('a run of aisles made into its own block runs side to side, in front of the rest', () => {
    const l = regenerate({ ...blank, gen: { ...blank.gen!, aisleGroups: [{ from: '4', to: '6' }] } }, buildModel(products, 's'));
    const a = (n: number) => l.aisles!.find((x) => x.id === `g-aisle-${n}`)!;
    expect(a(1).h).toBeGreaterThan(a(1).w); // up and down
    expect(a(4).w).toBeGreaterThan(a(4).h); // side to side
    expect(a(4).y).toBeGreaterThan(a(1).y + a(1).h); // in front of (below) aisles 1–3
    // Aisle 4 nearest the front (lowest), 6 furthest back.
    expect(a(4).y).toBeGreaterThan(a(6).y);
    // Its shelves run side to side along the walkway, and everything can be reached.
    const s4 = l.places.find((p) => p.id === 'g-shelf-4-L') as Shelf;
    expect(s4.orientation).toBe('horizontal');
    expect(s4.y).toBe(a(4).y - 1);
    const floor = new Floor(l);
    for (const p of l.places) expect(floor.reachable(l.entrance, { x: p.x, y: p.y }), p.id).toBe(true);
    // No two blocks overlap.
    const ys = l.aisles!.map((x) => [x.x, x.y, x.w, x.h].join());
    expect(new Set(ys).size).toBe(6);
  });

  it('asks where the new block goes, with a preview each way round', () => {
    const l = regenerate({ ...blank, gen: { ...blank.gen!, aisleGroups: [{ from: '4', to: '6' }] } }, buildModel(products, 's'));
    const sub = pendingPlacements(l, products).find((x) => x.ref === 'aisles:4')!;
    expect(sub.name).toBe('Aisles 4–6');
    const across = placementOptions(l, products, sub, 'horizontal');
    expect(across.map((o) => o.label)).toEqual(expect.arrayContaining(['Behind aisles 1–3', 'In front of aisles 1–3', 'Left of aisles 1–3']));
    const behind = across.find((o) => o.label === 'Behind aisles 1–3')!;
    const a1 = behind.preview.aisles!.find((x) => x.id === 'g-aisle-1')!;
    expect(behind.ghost.y + behind.ghost.h).toBeLessThanOrEqual(a1.y);
    const upright = placementOptions(l, products, sub, 'vertical').find((o) => o.label === 'Left of aisles 1–3')!;
    expect(upright.preview.aisles!.find((x) => x.id === 'g-aisle-4')!.h).toBeGreaterThan(5);
  });

  it('a section can be turned side to side', () => {
    const style: LabelStyle = { example: 'B12', roles: ['section', 'shelf'], pairing: 'backToBack' };
    const mk = (id: string, code: string): Product => { const p = parseLabel(style, code)!; return { id, name: id, clues: { s: { kind: 'shelf', code, section: p.section, shelf: p.shelf } } }; };
    const ps = [mk('x', 'A4')];
    const l = regenerate({ ...blank, labels: style, gen: { ...blank.gen!, directions: { 'block:A': 'horizontal' } } }, buildModel(ps, 's'));
    const shelves = l.places.filter((p): p is Shelf => p.id.startsWith('g-sec-A-'));
    expect(shelves.every((p) => p.orientation === 'horizontal')).toBe(true);
    const y = (k: number) => shelves.find((p) => p.id === `g-sec-A-${k}`)!.y;
    expect(y(1) - y(2)).toBe(1); // back to back
    expect(y(2) - y(3)).toBe(3); // a walkway between pairs
  });
});

describe('areas that cut through shelves', () => {
  const promo: Product = { id: 'promo', name: 'Promo', categoryId: 'snacks', clues: { s: { kind: 'open', fixture: 'stand', across: { from: '2', to: '4', part: 'front' } } } };
  it('puts the area across those aisles at the front, and the shelves there make way', async () => {
    const { describeClue, resolveClue } = await import('./clues');
    const all = [...products, promo];
    const l = regenerate(blank, buildModel(all, 's'));
    const area = l.places.find((p) => p.id.startsWith('g-open-x2-4'))!;
    expect(area).toMatchObject({ kind: 'area', label: 'Stand' });
    const a2 = l.aisles!.find((x) => x.id === 'g-aisle-2')!;
    // At the front (bottom) end of the aisles, a third of their length.
    expect(area.y + (area as any).h).toBe(a2.y + a2.h);
    // Aisles 2–4's shelves are split round it; aisle 1's and 5's aren't.
    const len = (n: number) => (l.places.find((p) => p.id === `g-shelf-${n}-L`) as Shelf).length;
    expect(len(1)).toBe(14);
    expect(len(3)).toBeLessThan(14);
    expect(len(5)).toBe(14);
    for (const p of l.places) if (p.kind === 'shelf' && p.id.startsWith('g-shelf-3')) expect(p.y + p.length).toBeLessThanOrEqual(area.y);
    expect(describeClue(promo.clues!.s)).toBe('Stand across aisles 2–4 (front)');
    expect(resolveClue(promo.clues!.s, l)?.split('@')[0]).toBe(area.id);
    // Rebuilding changes nothing.
    const again = regenerate(l, buildModel(all, 's'));
    expect(again.places.map((p) => [p.id, p.x, p.y].join())).toEqual(l.places.map((p) => [p.id, p.x, p.y].join()));
    const floor = new Floor(l);
    expect(floor.reachable(l.entrance, { x: area.x, y: area.y })).toBe(true);
  });
});
