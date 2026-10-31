import { DEPTS } from './clues';
import type { Dept, MainWall as Wall, Shelf, StoreLayout } from './types';

/**
 * The departments screen: what's on each outside wall, in order, as the
 * built map has it (side walls front to back, the back wall left to right).
 */

export type WallOrder = Record<Wall, string[]>;

export const WALL_KEYS: Wall[] = ['left', 'back', 'right'];

/** A section's name and icon for the screen ("produce" → Produce 🥬, "left-frozen" → Freezers ❄). */
export function sectionTitle(key: string): { name: string; icon: string } {
  const d = DEPTS.find((x) => x.id === key);
  if (d) return { name: d.name, icon: d.icon };
  if (key.endsWith('-frozen')) return { name: 'Freezers', icon: '❄' };
  if (key.endsWith('-chilled')) return { name: 'Fridges', icon: '🧊' };
  return { name: 'Wall shelves', icon: '▭' };
}

/** The key a generated wall shelf stands for (g-dept-bakery → bakery, g-wall-left-frozen → left-frozen). */
function keyOf(id: string): string | undefined {
  return /^g-dept-(.+)$/.exec(id)?.[1] ?? /^g-wall-(.+)$/.exec(id)?.[1];
}

/** What's on each wall now: the built map's wall shelves, plus anything the shopper put there that isn't built yet. */
export function currentWalls(l: StoreLayout): WallOrder {
  const out: WallOrder = { left: [], back: [], right: [] };
  const shelves = l.places.filter((p): p is Shelf => p.kind === 'shelf' && !!keyOf(p.id));
  // (A front wall run, along the bottom with its back to the outside, isn't on this screen.)
  const on = (s: Shelf): Wall | undefined => (s.orientation === 'horizontal' ? ((s.back ?? -1) < 0 ? 'back' : undefined) : (s.back ?? 0) < 0 ? 'left' : 'right');
  for (const w of WALL_KEYS) {
    out[w] = shelves.filter((s) => on(s) === w)
      // Side walls from the front (the bottom of the map); the back wall from the left.
      .sort((a, b) => (w === 'back' ? a.x - b.x : b.y - a.y))
      .map((s) => keyOf(s.id)!);
  }
  const saved = l.gen?.wallOrder;
  if (saved) {
    for (const w of WALL_KEYS) {
      saved[w].forEach((k, i) => {
        if (WALL_KEYS.some((x) => out[x].includes(k))) return;
        out[w].splice(Math.min(i, out[w].length), 0, k);
      });
    }
  }
  return out;
}

/** Departments not on any wall yet (not heard of in this store, or out on the floor). */
export function trayFor(walls: WallOrder): string[] {
  const on = new Set(WALL_KEYS.flatMap((w) => walls[w]));
  return DEPTS.map((d) => d.id as string).filter((id) => !on.has(id));
}

/** Moves a section to a wall, before `before` (or at the end), or off the walls (wall undefined). */
export function moveSection(walls: WallOrder, key: string, wall: Wall | undefined, before?: string): WallOrder {
  const out: WallOrder = { left: walls.left.filter((k) => k !== key), back: walls.back.filter((k) => k !== key), right: walls.right.filter((k) => k !== key) };
  if (!wall) return out;
  const i = before ? out[wall].indexOf(before) : -1;
  if (i < 0) out[wall].push(key);
  else out[wall].splice(i, 0, key);
  return out;
}

/** Offer the screen after a trip: a few departments are known, and it's not been offered. */
export function offerWalls(l: StoreLayout): boolean {
  const g = l.gen;
  if (!g?.enabled || g.wallOrder || g.wallsOffered) return false;
  return l.places.filter((p) => /^g-dept-/.test(p.id)).length >= 2;
}

export const isDept = (key: string): key is Dept => DEPTS.some((d) => d.id === key);
