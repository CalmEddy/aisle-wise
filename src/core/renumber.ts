import { sequenceLabels } from './labels';
import type { Place, Shelf, StoreLayout } from './types';

/**
 * Order selected places/aisles for sequential renaming: shelves along a row
 * (horizontal → top to bottom, vertical → left to right); aisle labels by
 * the same geometry. Mixed selections: aisles first (geometric), then
 * loose places.
 */
export function selectionOrder(l: StoreLayout, ids: string[]): { kind: 'aisle' | 'place'; id: string }[] {
  const idSet = new Set(ids);
  const aisles = (l.aisles ?? []).filter((a) => idSet.has(a.id));
  const places = l.places.filter((p) => idSet.has(p.id));

  const aisleVertical = aisles.length
    ? aisles.filter((a) => a.h >= a.w).length * 2 >= aisles.length
    : true;
  const sortedAisles = [...aisles].sort((a, b) => {
    if (aisleVertical) return a.x !== b.x ? a.x - b.x : a.y - b.y;
    return a.y !== b.y ? a.y - b.y : a.x - b.x;
  });

  const shelves = places.filter((p): p is Shelf => p.kind === 'shelf');
  const areas = places.filter((p) => p.kind === 'area');
  const shelfVertical = shelves.length
    ? shelves.filter((s) => s.orientation === 'vertical').length * 2 >= shelves.length
    : true;
  const sortedShelves = [...shelves].sort((a, b) => {
    // Across-axis first (row order), then along.
    if (shelfVertical) return a.x !== b.x ? a.x - b.x : a.y - b.y;
    return a.y !== b.y ? a.y - b.y : a.x - b.x;
  });
  const sortedAreas = [...areas].sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

  return [
    ...sortedAisles.map((a) => ({ kind: 'aisle' as const, id: a.id })),
    ...sortedShelves.map((s) => ({ kind: 'place' as const, id: s.id })),
    ...sortedAreas.map((a) => ({ kind: 'place' as const, id: a.id })),
  ];
}

/**
 * Renames selected aisles and places from `startLabel` in geometric order.
 * Flipping reverses that order. Uses the store's label style for shelf codes.
 */
export function renumberSelection(
  l: StoreLayout,
  ids: string[],
  startLabel: string,
  opts: { flip?: boolean } = {},
): StoreLayout {
  let order = selectionOrder(l, ids);
  if (opts.flip) order = [...order].reverse();
  if (!order.length) return l;

  const labels = sequenceLabels(startLabel, order.length, l.labels);
  const aisleMap = new Map<string, string>();
  const placeMap = new Map<string, string>();
  order.forEach((o, i) => {
    if (o.kind === 'aisle') aisleMap.set(o.id, labels[i]);
    else placeMap.set(o.id, labels[i]);
  });

  return {
    ...l,
    places: l.places.map((p): Place => (placeMap.has(p.id) ? { ...p, label: placeMap.get(p.id)! } : p)),
    aisles: l.aisles?.map((a) => (aisleMap.has(a.id) ? { ...a, label: aisleMap.get(a.id)! } : a)),
  };
}
