import type { StoreLayout } from './types';

const newId = () => Math.random().toString(36).slice(2, 10);

/** A named set of place/aisle ids that move together. */
export interface PlaceGroup {
  id: string;
  /** Place and aisle label ids in the group. */
  ids: string[];
}

/** Expand a selection to include every member of any group it touches. */
export function expandSelection(l: StoreLayout, ids: string[]): string[] {
  const groups = l.groups ?? [];
  if (!groups.length) return [...new Set(ids)];
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) {
      if (g.ids.some((id) => out.has(id)) && g.ids.some((id) => !out.has(id))) {
        for (const id of g.ids) out.add(id);
        grew = true;
      }
    }
  }
  return [...out];
}

/** Whether these ids are already exactly one existing group. */
export function isExactGroup(l: StoreLayout, ids: string[]): PlaceGroup | undefined {
  const set = new Set(ids);
  return (l.groups ?? []).find((g) => g.ids.length === set.size && g.ids.every((id) => set.has(id)));
}

/** Groups these ids together (replacing any groups they were in). */
export function groupPlaces(l: StoreLayout, ids: string[]): StoreLayout {
  const unique = [...new Set(ids)];
  if (unique.length < 2) return l;
  const rest = (l.groups ?? [])
    .map((g) => ({ ...g, ids: g.ids.filter((id) => !unique.includes(id)) }))
    .filter((g) => g.ids.length > 1);
  return { ...l, groups: [...rest, { id: `grp-${newId()}`, ids: unique }] };
}

/** Removes the group that exactly matches these ids, or dissolves groups touching them. */
export function ungroupPlaces(l: StoreLayout, ids: string[]): StoreLayout {
  const set = new Set(ids);
  const exact = isExactGroup(l, ids);
  const groups = (l.groups ?? []).filter((g) => {
    if (exact) return g.id !== exact.id;
    // Dissolve any group that intersects the selection.
    return !g.ids.some((id) => set.has(id));
  });
  return { ...l, groups: groups.length ? groups : undefined };
}

/** Drop missing ids from groups after deletes. */
export function pruneGroups(l: StoreLayout): StoreLayout {
  if (!l.groups?.length) return l;
  const known = new Set([
    ...l.places.map((p) => p.id),
    ...(l.aisles ?? []).map((a) => a.id),
  ]);
  const groups = l.groups
    .map((g) => ({ ...g, ids: g.ids.filter((id) => known.has(id)) }))
    .filter((g) => g.ids.length > 1);
  return { ...l, groups: groups.length ? groups : undefined };
}
