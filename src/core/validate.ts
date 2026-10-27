import type { Floor } from './floor';
import { footprint, spotPoint } from './geometry';
import type { Category, StoreLayout } from './types';

/** Plain-language problems with a layout, for the editor to show. */
export function checkLayout(layout: StoreLayout, floor: Floor, categories: Category[]): string[] {
  const problems: string[] = [];
  if (!floor.walkable(layout.entrance)) problems.push('The entrance is on a shelf.');
  if (!floor.walkable(layout.checkout)) problems.push('The checkout is on a shelf.');
  if (!floor.reachable(layout.entrance, layout.checkout)) problems.push('The checkout can’t be reached from the entrance.');

  for (const place of layout.places) {
    if (!floor.reachable(layout.entrance, spotPoint(place))) {
      problems.push(`${place.label || 'An unnamed place'} can’t be reached from the entrance – shelves are blocking it.`);
    }
  }

  for (const place of layout.places) {
    if (place.kind !== 'shelf') continue;
    const f = footprint(place);
    let boxed = 0;
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) if (floor.boxedIn({ x, y })) boxed++;
    if (boxed) {
      problems.push(`${place.label || 'A shelf'} has shelves or a wall on both sides${boxed < place.length ? ' in places' : ''}, so its items can only be reached from the ends.`);
    }
  }

  const stocked = new Set(layout.places.flatMap((p) => p.categories));
  const missing = categories.filter((c) => !stocked.has(c.id)).map((c) => c.name);
  if (missing.length) {
    const shown = missing.slice(0, 4).join(', ');
    const more = missing.length > 4 ? ` and ${missing.length - 4} more` : '';
    problems.push(`Not stocked anywhere yet: ${shown}${more}. Items like these will ask where they are.`);
  }
  return problems;
}
