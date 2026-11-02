import { PIN_CONFIDENCE, templateById, type Seed, type StoreTemplate } from '../data/storeTemplates';
import { blankStore } from './build';
import { buildModel, regenerate, SEED_PREFIX, type StoreModel } from './generate';
import { parentOf, topOf } from './taxonomy';
import type { Clue, Product, StoreLayout } from './types';

/**
 * Default store maps in use: a template's seeds as stand-in answers, for the
 * kinds of things nobody has answered for yet at this store. The first real
 * answer for a kind (or anything under it) replaces its seed.
 */

/** A seed's answer for a store with `aisles` aisles ("about halfway through" → "Aisle 6"). */
export function seedClue(seed: Seed, aisles: number): Clue | undefined {
  const c = seed.clue;
  if (c.kind !== 'aisleAt') return c;
  if (aisles < 1) return undefined;
  const n = Math.min(aisles, Math.max(1, Math.round(c.at * (aisles - 1)) + 1));
  return { kind: 'aisle', aisle: String(n), ...(c.side && { side: c.side }), ...(c.pos && { pos: c.pos }), ...(c.temp && { temp: c.temp }) };
}

/** Whether a kind has a real answer (or a saved spot) here: itself, something under it, or the category it's in. */
function answered(products: readonly Product[], layoutId: string): (category: string) => boolean {
  const kinds = new Set<string>();
  for (const p of products) {
    if (!p.categoryId || p.id.startsWith(SEED_PREFIX)) continue;
    if (!p.clues?.[layoutId] && !p.locations?.[layoutId]) continue;
    kinds.add(p.categoryId);
    const parent = parentOf(p.categoryId);
    if (parent) kinds.add(parent);
  }
  return (category) => kinds.has(category);
}

/** The template's seeds still standing in at this store, sure enough to go on the map. */
export function seedsInUse(layout: StoreLayout, products: readonly Product[]): Seed[] {
  const t = templateById(layout.gen?.template);
  if (!t) return [];
  const has = answered(products, layout.id);
  return t.seeds.filter((s) => s.confidence >= PIN_CONFIDENCE && !has(s.category));
}

/** The seeds as stand-in items, for the map builder. */
export function seedProducts(layout: StoreLayout, products: readonly Product[]): Product[] {
  const aisles = layout.gen?.aisleCount ?? templateById(layout.gen?.template)?.aisles ?? 0;
  return seedsInUse(layout, products).flatMap((s) => {
    const clue = seedClue(s, aisles);
    return clue ? [{ id: `${SEED_PREFIX}${s.category}`, name: s.category, categoryId: s.category, clues: { [layout.id]: clue } }] : [];
  });
}

/** What the store's map is built from: the answers, plus the template's seeds where nothing's been answered. */
export function storeModel(layout: StoreLayout, products: Product[]): StoreModel {
  return buildModel([...products, ...seedProducts(layout, products)], layout.id, { aisleCount: layout.gen?.aisleCount });
}

/** Kinds of things placed on the map only by the template (worth asking about when checked off). */
export function templateKinds(layout: StoreLayout, products: readonly Product[]): Set<string> {
  return new Set(seedsInUse(layout, products).map((s) => s.category));
}

/** Whether a kind's place here comes only from the template: itself, or the category it's in. */
export const onlyFromTemplate = (kinds: ReadonlySet<string>, category?: string) =>
  !!category && (kinds.has(category) || kinds.has(topOf(category)));

/** The template's settings, but its wall order: that's read from the template as the map is built (see regenerate). */
const withoutWalls = ({ wallOrder: _, ...rest }: StoreTemplate['gen']) => rest;

/** A new store from a template, with this many aisles (or 'blank': just the entrance and checkout). */
export function storeFromTemplate(name: string, templateId: string, aisles?: number): StoreLayout {
  const base = blankStore(name);
  const t: StoreTemplate | undefined = templateById(templateId);
  if (!t) return base;
  const layout: StoreLayout = {
    ...base,
    ...(t.labels && { labels: t.labels }),
    gen: { enabled: true, entrance: 'left', locked: [], ...withoutWalls(t.gen), template: t.id, ...(t.aisles > 0 && { aisleCount: aisles ?? t.aisles }) },
  };
  return regenerate(layout, storeModel(layout, []));
}
