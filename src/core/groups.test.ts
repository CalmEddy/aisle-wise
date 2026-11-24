import { describe, expect, it } from 'vitest';
import { expandSelection, groupPlaces, isExactGroup, pruneGroups, ungroupPlaces } from './groups';
import type { StoreLayout } from './types';

const blank = (): StoreLayout => ({
  id: 't', name: 'T', width: 20, height: 20, places: [
    { kind: 'shelf', id: 'a', label: 'A', orientation: 'vertical', x: 1, y: 1, length: 3, categories: [] },
    { kind: 'shelf', id: 'b', label: 'B', orientation: 'vertical', x: 3, y: 1, length: 3, categories: [] },
    { kind: 'shelf', id: 'c', label: 'C', orientation: 'vertical', x: 5, y: 1, length: 3, categories: [] },
  ], entrance: { x: 1, y: 19 }, checkout: { x: 5, y: 19 },
});

describe('place groups', () => {
  it('groups and expands selection to the whole set', () => {
    const l = groupPlaces(blank(), ['a', 'b']);
    expect(l.groups).toHaveLength(1);
    expect(expandSelection(l, ['a']).sort()).toEqual(['a', 'b']);
    expect(isExactGroup(l, ['a', 'b'])?.id).toBe(l.groups![0].id);
  });

  it('ungroups and prunes deleted members', () => {
    let l = groupPlaces(blank(), ['a', 'b', 'c']);
    l = ungroupPlaces(l, ['a', 'b', 'c']);
    expect(l.groups).toBeUndefined();
    l = groupPlaces(blank(), ['a', 'b']);
    l = { ...l, places: l.places.filter((p) => p.id !== 'b') };
    l = pruneGroups(l);
    expect(l.groups).toBeUndefined();
  });
});
