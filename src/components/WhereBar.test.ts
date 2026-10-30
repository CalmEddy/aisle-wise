import { describe, expect, it } from 'vitest';
import { guessTemp, nextAisles } from './WhereBar';

describe('quick bar guesses', () => {
  it('offers the aisle you’re in, then the next ones the way you’ve been going', () => {
    expect(nextAisles([])).toEqual([]);
    expect(nextAisles(['3'])).toEqual(['3', '4', '5', '2']);
    expect(nextAisles(['3', '5'])).toEqual(['5', '7', '9', '4']);
    expect(nextAisles(['9', '8'])).toEqual(['8', '7', '6', '9']);
    expect(nextAisles(['2', '1'])).toEqual(['1', '2']);
    expect(nextAisles(['12B'])).toEqual(['12', '13', '14', '11']);
  });
  it('guesses fridge or freezer from the category', () => {
    expect(guessTemp('icecream')).toBe('frozen');
    expect(guessTemp('dairy')).toBe('chilled');
    expect(guessTemp('pasta')).toBeUndefined();
  });
});
