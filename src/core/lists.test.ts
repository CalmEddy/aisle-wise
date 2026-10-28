import { describe, expect, it } from 'vitest';
import { Catalog } from './catalog';
import { combineLists, itemsOn, listOf, removeList, updateList } from './lists';
import type { ListItem } from './types';

const catalog = new Catalog([{ id: 'milk', name: 'Milk' }, { id: 'eggs', name: 'Eggs' }], []);
const items: ListItem[] = [
  { id: '1', name: 'Milk', done: false, productId: 'milk' },
  { id: '2', name: 'Eggs', done: false, listId: 'staples' },
  { id: '3', name: 'milk', done: false, listId: 'staples' },
  { id: '4', name: 'Bread', done: true, listId: 'staples' },
  { id: '5', name: 'Tortillas', done: false, listId: 'tacos' },
  { id: '6', name: 'Eggs', done: false, listId: 'tacos' },
];
const names = (list: ListItem[], id: string) => itemsOn(list, id).map((i) => i.name);

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
});
