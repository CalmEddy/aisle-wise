import { normalize, type Catalog } from './catalog';
import { MAIN_LIST, type ListItem, type ShoppingList } from './types';

const newId = () => Math.random().toString(36).slice(2, 10);

/** Which list an item is on. */
export const listOf = (i: ListItem) => i.listId ?? MAIN_LIST;

/** The lists everyone starts with. */
export const defaultLists: ShoppingList[] = [{ id: MAIN_LIST, name: 'Shopping list' }];

/** Items on one list. */
export const itemsOn = (items: ListItem[], listId: string) => items.filter((i) => listOf(i) === listId);

/** The same thing to buy, by master-list item or by name. */
function sameThing(a: ListItem, b: ListItem, catalog: Catalog): boolean {
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
      copies.push({
        id: newId(), name: i.name, done: false,
        ...(i.productId && { productId: i.productId }), ...(i.qty && { qty: i.qty }), ...(i.note && { note: i.note }),
        ...(target !== MAIN_LIST && { listId: target }),
      });
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
  const tagged = next.map((i) => (listOf(i) === listId ? i : { ...i, listId: listId === MAIN_LIST ? undefined : listId }));
  return [...items.filter((i) => listOf(i) !== listId), ...tagged];
}

/** A list, with its items (deleting a list deletes its items). */
export function removeList(items: ListItem[], listId: string): ListItem[] {
  return items.filter((i) => listOf(i) !== listId);
}
