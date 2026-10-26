import type { Product, Shelf, StoreLayout } from './types';

/**
 * Before shelves, stores had "aisles": a walkway with a row of shelving on
 * each side. Each one becomes two shelves (left/right, or top/bottom), in
 * the same squares, with that side's categories. Saved item locations move
 * to the matching shelf.
 */
interface OldAisle {
  kind: 'aisle';
  id: string;
  label: string;
  x: number;
  y: number;
  orientation: 'vertical' | 'horizontal';
  length: number;
  width: number;
  categories: string[];
  sides?: [string[], string[]];
}

export const secondShelfId = (aisleId: string) => `${aisleId}-2`;

export function hasOldAisles(layouts: StoreLayout[]): boolean {
  return layouts.some((l) => l.places.some((p) => (p as { kind: string }).kind === 'aisle'));
}

/** Converts one layout's aisles to shelves. Returns the new layout and how to rewrite its spot keys. */
export function aislesToShelves(layout: StoreLayout): { layout: StoreLayout; remap: (key: string) => string } {
  const converted = new Map<string, [Shelf, Shelf]>();
  const places = layout.places.flatMap((p) => {
    if ((p as { kind: string }).kind !== 'aisle') return [p];
    const a = p as unknown as OldAisle;
    const vertical = a.orientation === 'vertical';
    const sides = a.sides ?? [a.categories, a.categories];
    const [first, second] = vertical ? ['left', 'right'] : ['top', 'bottom'];
    const shelf = (id: string, at: number, side: string, categories: string[]): Shelf => ({
      kind: 'shelf', id, orientation: a.orientation, length: a.length, categories: [...categories],
      label: a.label ? `${a.label} – ${side}` : '',
      x: vertical ? at : a.x,
      y: vertical ? a.y : at,
    });
    const pair: [Shelf, Shelf] = [
      shelf(a.id, vertical ? a.x : a.y, first, sides[0]),
      shelf(secondShelfId(a.id), (vertical ? a.x : a.y) + a.width + 1, second, sides[1]),
    ];
    converted.set(a.id, pair);
    return pair;
  });

  const remap = (key: string) => {
    const exact = /^(.+)@(-?[\d.]+),(-?[\d.]+)$/.exec(key);
    if (exact && converted.has(exact[1])) {
      // Old v: 0 = first side, 1 = second side, 0.5 = either.
      const id = Number(exact[3]) > 0.5 ? secondShelfId(exact[1]) : exact[1];
      return `${id}@${exact[2]},0.5`;
    }
    const [placeId, cat] = key.split(':');
    const pair = converted.get(placeId);
    if (!pair || !cat || exact) return key;
    return pair[0].categories.includes(cat) || !pair[1].categories.includes(cat) ? key : `${pair[1].id}:${cat}`;
  };
  return { layout: { ...layout, places }, remap };
}

/** Converts every layout and every saved item location. */
export function migrateToShelves(layouts: StoreLayout[], products: Product[]): { layouts: StoreLayout[]; products: Product[] } {
  const remaps = new Map<string, (key: string) => string>();
  const next = layouts.map((l) => {
    const r = aislesToShelves(l);
    remaps.set(l.id, r.remap);
    return r.layout;
  });
  const fixed = products.map((p) => {
    if (!p.locations) return p;
    let changed = false;
    const locations: Record<string, string> = {};
    for (const [layoutId, key] of Object.entries(p.locations)) {
      const k = remaps.get(layoutId)?.(key) ?? key;
      if (k !== key) changed = true;
      locations[layoutId] = k;
    }
    return changed ? { ...p, locations } : p;
  });
  return { layouts: next, products: fixed };
}
