import { describe, expect, it } from 'vitest';
import { aisleClueFromRegion, regionOf } from './AisleRegionPicker';
import { wallClueFromSegment } from './WallRegionPicker';

describe('aisle region → clue', () => {
  it('maps the six cells with top = back of store', () => {
    expect(aisleClueFromRegion('3', 'TL')).toEqual({ kind: 'aisle', aisle: '3', side: 'L', pos: 'back' });
    expect(aisleClueFromRegion('3', 'TR')).toEqual({ kind: 'aisle', aisle: '3', side: 'R', pos: 'back' });
    expect(aisleClueFromRegion('3', 'ML')).toEqual({ kind: 'aisle', aisle: '3', side: 'L', pos: 'middle' });
    expect(aisleClueFromRegion('3', 'MR', 'chilled')).toEqual({ kind: 'aisle', aisle: '3', side: 'R', pos: 'middle', temp: 'chilled' });
    expect(aisleClueFromRegion('12', 'BL')).toEqual({ kind: 'aisle', aisle: '12', side: 'L', pos: 'front' });
    expect(aisleClueFromRegion('12', 'BR')).toEqual({ kind: 'aisle', aisle: '12', side: 'R', pos: 'front' });
  });

  it('round-trips regionOf', () => {
    expect(regionOf('L', 'back')).toBe('TL');
    expect(regionOf('R', 'front')).toBe('BR');
    expect(regionOf(undefined, 'middle')).toBeUndefined();
  });
});

describe('wall segment → clue', () => {
  it('stores side-wall TOP as part back (back of store)', () => {
    expect(wallClueFromSegment({ wall: 'left', part: 'back' })).toEqual({ kind: 'wall', wall: 'left', part: 'back' });
    expect(wallClueFromSegment({ wall: 'right', part: 'front' }, 'frozen')).toEqual({
      kind: 'wall', wall: 'right', part: 'front', temp: 'frozen',
    });
    expect(wallClueFromSegment({ wall: 'back', part: 'middle' })).toEqual({ kind: 'wall', wall: 'back', part: 'middle' });
  });
});
