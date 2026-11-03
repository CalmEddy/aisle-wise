import { normalize, type Catalog } from './catalog';
import { MAIN_LIST, type ListItem, type ShoppingList } from './types';

const newId = () => Math.random().toString(36).slice(2, 10);

/** Which list an item is on. */
export const listOf = (i: ListItem) => i.listId ?? MAIN_LIST;

/** The lists everyone starts with. */
export const defaultLists: ShoppingList[] = [{ id: MAIN_LIST, name: 'Shopping list' }];

/** Items on one list. */
export const itemsOn = (items: ListItem[], listId: string) => items.filter((i) => listOf(i) === listId);

/** Tag an item for a list (main list stays untagged for older phones). */
export function withListId<T extends Omit<ListItem, 'listId'> & { listId?: string }>(item: T, listId: string): ListItem {
  const { listId: _drop, ...rest } = item;
  return listId === MAIN_LIST ? { ...rest } : { ...rest, listId };
}

/** The same thing to buy, by master-list item or by name. */
export function sameThing(a: ListItem, b: ListItem, catalog: Catalog): boolean {
  const pa = a.productId ?? catalog.exact(a.name)?.id;
  const pb = b.productId ?? catalog.exact(b.name)?.id;
  if (pa && pb) return pa === pb;
  return normalize(a.name) === normalize(b.name);
}

/**
 * Copies what's still to buy on the `sources` lists onto `target`, skipping
 * anything already waiting there. The source lists aren't changed, so they
 * can be used again (weekly staples, a recipe…).
 */
export function combineLists(items: ListItem[], target: string, sources: string[], catalog: Catalog): { items: ListItem[]; added: number; skipped: number } {
  const waiting = itemsOn(items, target).filter((i) => !i.done);
  const copies: ListItem[] = [];
  let skipped = 0;
  for (const source of sources) {
    if (source === target) continue;
    for (const i of itemsOn(items, source)) {
      if (i.done) continue;
      if ([...waiting, ...copies].some((w) => sameThing(w, i, catalog))) {
        skipped++;
        continue;
      }
      copies.push(withListId({
        id: newId(), name: i.name, done: false,
        ...(i.productId && { productId: i.productId }), ...(i.qty && { qty: i.qty }), ...(i.note && { note: i.note }),
      }, target));
    }
  }
  return { items: [...items, ...copies], added: copies.length, skipped };
}

/**
 * Replaces one list's items using `fn`, leaving every other list alone. New
 * items `fn` adds are put on that list.
 */
export function updateList(items: ListItem[], listId: string, fn: (mine: ListItem[]) => ListItem[]): ListItem[] {
  const mine = itemsOn(items, listId);
  const next = fn(mine);
  if (next === mine) return items;
  const tagged = next.map((i) => (listOf(i) === listId ? i : withListId(i, listId)));
  return [...items.filter((i) => listOf(i) !== listId), ...tagged];
}

/** A list, with its items (deleting a list deletes its items). */
export function removeList(items: ListItem[], listId: string): ListItem[] {
  return items.filter((i) => listOf(i) !== listId);
}

/** Move one item onto another list. Skips (leaves it) if that thing is already waiting there. */
export function moveItem(items: ListItem[], itemId: string, toList: string, catalog: Catalog): { items: ListItem[]; moved: boolean; skipped: boolean } {
  const item = items.find((i) => i.id === itemId);
  if (!item || listOf(item) === toList) return { items, moved: false, skipped: false };
  const waiting = itemsOn(items, toList).filter((i) => !i.done);
  if (waiting.some((w) => sameThing(w, item, catalog))) return { items, moved: false, skipped: true };
  return {
    items: items.map((i) => (i.id === itemId ? withListId(i, toList) : i)),
    moved: true,
    skipped: false,
  };
}

/** Copy one item onto another list. Skips if that thing is already waiting there. */
export function copyItem(items: ListItem[], itemId: string, toList: string, catalog: Catalog): { items: ListItem[]; copied: boolean; skipped: boolean } {
  const item = items.find((i) => i.id === itemId);
  if (!item || listOf(item) === toList) return { items, copied: false, skipped: false };
  const waiting = itemsOn(items, toList).filter((i) => !i.done);
  if (waiting.some((w) => sameThing(w, item, catalog))) return { items, copied: false, skipped: true };
  const copy = withListId({
    id: newId(), name: item.name, done: false,
    ...(item.productId && { productId: item.productId }), ...(item.qty && { qty: item.qty }), ...(item.note && { note: item.note }),
  }, toList);
  return { items: [...items, copy], copied: true, skipped: false };
}

/**
 * Duplicates a list (unchecked items only) under a new name, inserted just
 * after the source in the household's list order.
 */
export function duplicateList(
  items: ListItem[],
  lists: ShoppingList[],
  sourceId: string,
  newName: string,
): { items: ListItem[]; lists: ShoppingList[]; id: string } {
  const id = `l-${newId()}`;
  const copies = itemsOn(items, sourceId).filter((i) => !i.done).map((i) => withListId({
    id: newId(), name: i.name, done: false,
    ...(i.productId && { productId: i.productId }), ...(i.qty && { qty: i.qty }), ...(i.note && { note: i.note }),
  }, id));
  const idx = lists.findIndex((l) => l.id === sourceId);
  const next = [...lists];
  next.splice(idx < 0 ? next.length : idx + 1, 0, { id, name: newName });
  return { items: [...items, ...copies], lists: next, id };
}

export type ClearMode = 'checked' | 'toBuy' | 'all';

/** Removes items from one list without deleting the list itself. */
export function clearList(items: ListItem[], listId: string, mode: ClearMode): ListItem[] {
  return items.filter((i) => {
    if (listOf(i) !== listId) return true;
    if (mode === 'all') return false;
    if (mode === 'checked') return !i.done;
    return i.done; // toBuy: keep checked
  });
}

/** Swap a list one step up (-1) or down (+1) in the saved order. */
export function moveListOrder(lists: ShoppingList[], id: string, dir: -1 | 1): ShoppingList[] {
  const i = lists.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= lists.length) return lists;
  const next = [...lists];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** A unique-ish name when duplicating: "Taco night" → "Taco night (again)", then (2), … */
export function copyListName(name: string, existing: string[]): string {
  const names = new Set(existing.map((n) => n.trim().toLowerCase()));
  const base = `${name} (again)`;
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${name} (${n})`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${name} (${newId()})`;
}
