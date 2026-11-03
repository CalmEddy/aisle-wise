import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import {
  clearList, combineLists, copyItem, copyListName, duplicateList, itemsOn, listOf,
  moveItem, moveListOrder, removeList, updateList,
} from './lists';
import type { ListItem, ShoppingList } from './types';

const catalog = new Catalog([{ id: 'milk', name: 'Milk' }, { id: 'dairy_eggs_sub', name: 'Eggs' }], []);
const items: ListItem[] = [
  { id: '1', name: 'Milk', done: false, productId: 'milk' },
  { id: '2', name: 'Eggs', done: false, listId: 'staples' },
  { id: '3', name: 'milk', done: false, listId: 'staples' },
  { id: '4', name: 'Bread', done: true, listId: 'staples' },
  { id: '5', name: 'Tortillas', done: false, listId: 'tacos' },
  { id: '6', name: 'Eggs', done: false, listId: 'tacos' },
];
const names = (list: ListItem[], id: string) => itemsOn(list, id).map((i) => i.name);
const lists: ShoppingList[] = [
  { id: 'main', name: 'Shopping list' },
  { id: 'staples', name: 'Weekly staples' },
  { id: 'tacos', name: 'Taco night' },
];

describe('several lists', () => {
  it('old items belong to the main list', () => {
    expect(listOf(items[0])).toBe('main');
    expect(names(items, 'main')).toEqual(['Milk']);
  });

  it('combines lists into one, merging duplicates and leaving the sources alone', () => {
    const r = combineLists(items, 'main', ['staples', 'tacos'], catalog);
    expect(names(r.items, 'main')).toEqual(['Milk', 'Eggs', 'Tortillas']);
    expect(r.added).toBe(2);
    expect(r.skipped).toBe(2); // milk already there, eggs on both sources
    expect(names(r.items, 'staples')).toEqual(['Eggs', 'milk', 'Bread']);
    expect(r.items.filter((i) => i.name === 'Bread')).toHaveLength(1); // ticked items aren't copied
    // Into a named list: copies are tagged with it.
    const t = combineLists(items, 'tacos', ['staples'], catalog);
    expect(names(t.items, 'tacos')).toEqual(['Tortillas', 'Eggs', 'milk']);
  });

  it('changes one list without touching the others', () => {
    const next = updateList(items, 'tacos', (mine) => [...mine.filter((i) => i.id !== '5'), { id: 'n', name: 'Salsa', done: false }]);
    expect(names(next, 'tacos')).toEqual(['Eggs', 'Salsa']);
    expect(next.find((i) => i.id === 'n')?.listId).toBe('tacos');
    expect(names(next, 'staples')).toEqual(['Eggs', 'milk', 'Bread']);
    // New items on the main list stay untagged, for older phones.
    const m = updateList(items, 'main', (mine) => [...mine, { id: 'm', name: 'Jam', done: false }]);
    expect(m.find((i) => i.id === 'm')?.listId).toBeUndefined();
    expect(removeList(items, 'staples').map((i) => i.id)).toEqual(['1', '5', '6']);
  });

  it('moves and copies an item between lists, skipping duplicates', () => {
    const moved = moveItem(items, '5', 'main', catalog);
    expect(moved.moved).toBe(true);
    expect(listOf(moved.items.find((i) => i.id === '5')!)).toBe('main');
    expect(names(moved.items, 'tacos')).toEqual(['Eggs']);

    const skip = moveItem(items, '2', 'main', catalog); // Eggs already as Milk? No - Eggs product on staples, main has Milk
    // Eggs (id 2) onto main: main has Milk only → moves
    expect(skip.moved).toBe(true);
    // Tortillas already? Copy eggs from tacos onto staples where eggs wait → skip
    const dup = copyItem(items, '6', 'staples', catalog);
    expect(dup.copied).toBe(false);
    expect(dup.skipped).toBe(true);
    const copy = copyItem(items, '5', 'main', catalog);
    expect(copy.copied).toBe(true);
    expect(names(copy.items, 'main')).toEqual(['Milk', 'Tortillas']);
    expect(names(copy.items, 'tacos')).toEqual(['Tortillas', 'Eggs']);
  });

  it('duplicates a list with unchecked items only', () => {
    const r = duplicateList(items, lists, 'staples', 'Weekly staples (again)');
    expect(r.lists.map((l) => l.name)).toEqual(['Shopping list', 'Weekly staples', 'Weekly staples (again)', 'Taco night']);
    expect(names(r.items, r.id).sort()).toEqual(['Eggs', 'milk']);
    expect(names(r.items, 'staples')).toEqual(['Eggs', 'milk', 'Bread']);
  });

  it('clears checked or to-buy items on one list', () => {
    expect(names(clearList(items, 'staples', 'checked'), 'staples')).toEqual(['Eggs', 'milk']);
    expect(names(clearList(items, 'staples', 'toBuy'), 'staples')).toEqual(['Bread']);
    expect(names(clearList(items, 'staples', 'all'), 'staples')).toEqual([]);
    expect(names(clearList(items, 'staples', 'all'), 'main')).toEqual(['Milk']);
  });

  it('reorders lists and picks a free duplicate name', () => {
    expect(moveListOrder(lists, 'tacos', -1).map((l) => l.id)).toEqual(['main', 'tacos', 'staples']);
    expect(moveListOrder(lists, 'main', -1)).toBe(lists);
    expect(copyListName('Taco night', ['Shopping list', 'Taco night'])).toBe('Taco night (again)');
    expect(copyListName('Taco night', ['Taco night', 'Taco night (again)'])).toBe('Taco night (2)');
  });
});
