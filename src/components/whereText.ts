import type { Catalog } from '../core/catalog';
import { locateProduct } from '../core/locate';
import type { Product, StoreLayout } from '../core/types';
import { DEPTS, describeClue, guessDept } from '../core/clues';

/** Where a category usually is: its department ("Produce"), or "with the <category>" in the aisles. */
export function typicalWhere(categoryId: string, catalog?: Catalog): string {
  const dept = guessDept(categoryId);
  if (dept) return `in ${DEPTS.find((d) => d.id === dept)!.name}`;
  const name = catalog?.categoryById.get(categoryId)?.name;
  return name ? `in the aisles (${name})` : 'in the aisles';
}

/** Short "where is it" text for a master-list item in this store. */
export function whereText(product: Product, layout: StoreLayout, catalog: Catalog): string {
  const loc = locateProduct(product, layout, catalog);
  if (loc.kind === 'spot') return loc.spot.label;
  if (loc.kind === 'not-sold') return 'Not available here';
  if (loc.kind === 'clue') return describeClue(loc.clue);
  if (loc.kind === 'guess') return `Usually ${typicalWhere(loc.categoryId, catalog)}`;
  return catalog.categoryById.get(product.categoryId ?? '')?.name ?? 'No location yet';
}

export const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
