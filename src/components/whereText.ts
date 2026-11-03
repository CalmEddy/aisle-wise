import type { Catalog } from '../core/catalog';
import type { Location } from '../core/locate';
import { locateProduct } from '../core/locate';
import type { Product, StoreLayout } from '../core/types';
import { DEPTS, describeClue, guessDept } from '../core/clues';

/** Where a category usually is: its department ("Produce"), or "with the <category>" in the aisles. */
export function typicalWhere(categoryId: string, catalog?: Catalog): string {
  // Prefer the live top so a reparented subcategory names its new department.
  const top = catalog?.topOf(categoryId) ?? categoryId;
  const dept = guessDept(top) ?? guessDept(categoryId);
  if (dept) return `in ${DEPTS.find((d) => d.id === dept)!.name}`;
  const name = catalog?.categoryById.get(top)?.name ?? catalog?.categoryById.get(categoryId)?.name;
  return name ? `in the aisles (${name})` : 'in the aisles';
}

/** Short name of a top-level category for "no X shelf" copy. */
export function topCategoryName(categoryId: string, catalog: Catalog): string | undefined {
  const top = catalog.topOf(categoryId);
  return catalog.categoryById.get(top)?.name;
}

/**
 * What Automatic resolves to when there's no map place yet: names the missing
 * top-level shelf so the shopper knows which department to mark on the map.
 */
export function noShelfText(categoryId: string, catalog: Catalog): string {
  const name = topCategoryName(categoryId, catalog);
  return name ? `No ${name} shelf on the map` : 'No shelf on the map yet';
}

/** Automatic / where-line copy for a locate result (spot, clue, or missing shelf). */
export function autoWhereText(loc: Location, catalog: Catalog): string {
  if (loc.kind === 'spot') return loc.spot.label;
  if (loc.kind === 'clue') return describeClue(loc.clue);
  if (loc.kind === 'guess') return noShelfText(loc.categoryId, catalog);
  if (loc.kind === 'not-sold') return 'Not available here';
  return 'nowhere yet – pick a place';
}

/** Short "where is it" text for a master-list item in this store. */
export function whereText(product: Product, layout: StoreLayout, catalog: Catalog): string {
  const loc = locateProduct(product, layout, catalog);
  if (loc.kind === 'spot') return loc.spot.label;
  if (loc.kind === 'not-sold') return 'Not available here';
  if (loc.kind === 'clue') return describeClue(loc.clue);
  if (loc.kind === 'guess') {
    // Efficient: name the missing top shelf (Automatic / editor expand on the rest).
    return noShelfText(loc.categoryId, catalog);
  }
  const top = product.categoryId ? catalog.topOf(product.categoryId) : undefined;
  return (top && catalog.categoryById.get(top)?.name) ?? 'No location yet';
}

export const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
