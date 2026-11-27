import { describe, expect, it } from 'vitest';
import { clearShared, setListShared, sharedListIds } from './lists';
import type { ShoppingList } from './types';

const lists: ShoppingList[] = [{ id: 'main', name: 'Shopping list', shared: true }, { id: 'party', name: 'Party' }];

describe('which lists are shared', () => {
  it('only lists flagged shared count', () => {
    expect([...sharedListIds(lists)]).toEqual(['main']);
  });

  it('shares and unshares one list, leaving others alone', () => {
    const on = setListShared(lists, 'party', true);
    expect([...sharedListIds(on)].sort()).toEqual(['main', 'party']);
    const off = setListShared(on, 'main', false);
    expect(off[0].shared).toBe(false); // explicit, so the household hears about it
    expect([...sharedListIds(off)]).toEqual(['party']);
  });

  it('clearing makes every list private again', () => {
    expect(clearShared(lists)).toEqual([{ id: 'main', name: 'Shopping list' }, { id: 'party', name: 'Party' }]);
    const plain: ShoppingList[] = [{ id: 'main', name: 'Shopping list' }];
    expect(clearShared(plain)).toBe(plain);
  });
});
