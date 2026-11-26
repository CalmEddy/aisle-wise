import { topOf } from '../core/taxonomy';
import { aisleNumber } from '../core/clues';
import type { Clue, Temp } from '../core/types';

/** Cold or not, as a first guess from the category. */
export function guessTemp(categoryId?: string): Temp | undefined {
  if (!categoryId) return undefined;
  const top = topOf(categoryId);
  if (top === 'frozen') return 'frozen';
  if (top === 'dairy_eggs' || top === 'cheese') return 'chilled';
  return undefined;
}

/**
 * The aisles you're most likely in next: the one you're in, then the next
 * ones in the direction you've been going (3 then 5 → 5, 7, 9), then the
 * one behind you.
 */
export function nextAisles(trail: string[]): string[] {
  const nums = trail.map((a) => Math.floor(aisleNumber(a))).filter((n) => !Number.isNaN(n));
  if (!nums.length) return [];
  const last = nums[nums.length - 1];
  const prev = nums.length > 1 ? nums[nums.length - 2] : undefined;
  const step = prev === undefined || prev === last ? 1 : Math.max(-2, Math.min(2, last - prev));
  const out = [last, last + step, last + 2 * step, last - Math.sign(step)].filter((n) => n > 0);
  return [...new Set(out)].map(String);
}

/** A spot on the map that already stocks this kind of thing: one tap to say it was there. */
export interface MapSpot {
  key: string;
  label: string;
  /** Saved as an answer… */
  clue?: Clue;
  /** …or (a place drawn by hand) as the item's spot. */
  spot?: string;
}
