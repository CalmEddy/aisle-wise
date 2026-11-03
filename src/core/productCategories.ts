import type { Product } from './types';

/**
 * Every category id on a product: primary `categoryId` first, then any extras.
 * Duplicates and blanks are dropped.
 */
export function productCategoryIds(p: Pick<Product, 'categoryId' | 'extraCategoryIds'>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [p.categoryId, ...(p.extraCategoryIds ?? [])]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Sets the product's categories. The first id is primary (`categoryId`); the
 * rest are extras. Empty list clears all categories.
 */
export function withCategories(
  p: Product,
  ids: readonly (string | undefined)[],
): Product {
  const clean = [...new Set(ids.filter((id): id is string => !!id))];
  const [primary, ...extra] = clean;
  const next: Product = { ...p, categoryId: primary };
  if (extra.length) next.extraCategoryIds = extra;
  else delete next.extraCategoryIds;
  if (!primary) delete next.categoryId;
  return next;
}

/** Adds a category without removing existing ones (no-op if already present). */
export function addCategory(p: Product, id: string): Product {
  const ids = productCategoryIds(p);
  if (ids.includes(id)) return p;
  return withCategories(p, [...ids, id]);
}

/** Removes a category; if the primary is removed, the next extra becomes primary. */
export function removeCategory(p: Product, id: string): Product {
  return withCategories(p, productCategoryIds(p).filter((c) => c !== id));
}
