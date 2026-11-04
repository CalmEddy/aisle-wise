import type { Catalog } from './catalog';
import { formatPrice } from './items';
import { productFor } from './locate';
import type { ItemUnit, ListItem, Product, StoreLayout, StorePrice } from './types';

/** Treat missing and `each` as the same unit for comparisons. */
export function unitKey(unit?: ItemUnit): string {
  return !unit || unit === 'each' ? 'each' : unit;
}

/** Read the remembered price for a product at one store. */
export function priceAt(product: Product, layoutId: string): StorePrice | undefined {
  return product.prices?.[layoutId];
}

/** Set (or overwrite) the latest price at a store. Clearing is `clearStorePrice`. */
export function setStorePrice(
  product: Product,
  layoutId: string,
  amount: number,
  unit?: ItemUnit,
  at = new Date().toISOString(),
): Product {
  if (!Number.isFinite(amount) || amount < 0) return product;
  const rounded = Math.round(amount * 100) / 100;
  const entry: StorePrice = {
    amount: rounded,
    at,
    ...(unit && unit !== 'each' ? { unit } : {}),
  };
  return { ...product, prices: { ...product.prices, [layoutId]: entry } };
}

/** Forget the remembered price at a store (Items editor clear). */
export function clearStorePrice(product: Product, layoutId: string): Product {
  if (!product.prices?.[layoutId]) return product;
  const prices = { ...product.prices };
  delete prices[layoutId];
  return Object.keys(prices).length ? { ...product, prices } : { ...product, prices: undefined };
}

export interface BestPrice extends StorePrice {
  layoutId: string;
}

/**
 * Cheapest known price across stores that sell the item.
 * Only compares entries whose units match (missing/`each` count as the same).
 * When several unit groups exist, prefers `opts.preferUnit`, else the largest group.
 */
export function bestPrice(
  product: Product,
  layouts: Pick<StoreLayout, 'id'>[],
  opts?: { preferUnit?: ItemUnit; layoutIds?: Set<string> },
): BestPrice | undefined {
  const allowed = opts?.layoutIds;
  const byUnit = new Map<string, BestPrice[]>();
  for (const l of layouts) {
    if (allowed && !allowed.has(l.id)) continue;
    if (product.notAt?.includes(l.id)) continue;
    const p = priceAt(product, l.id);
    if (!p) continue;
    const key = unitKey(p.unit);
    const list = byUnit.get(key) ?? [];
    list.push({ ...p, layoutId: l.id });
    byUnit.set(key, list);
  }
  if (!byUnit.size) return undefined;

  const prefer = opts?.preferUnit !== undefined ? unitKey(opts.preferUnit) : undefined;
  let group = prefer ? byUnit.get(prefer) : undefined;
  if (!group) {
    let bestKey = '';
    let bestLen = -1;
    for (const [k, list] of byUnit) {
      if (list.length > bestLen) {
        bestKey = k;
        bestLen = list.length;
      }
    }
    group = byUnit.get(bestKey);
  }
  if (!group?.length) return undefined;
  return group.reduce((a, b) => (b.amount < a.amount ? b : a));
}

export interface ProductPriceInfo {
  best?: BestPrice;
  byStore: Map<string, StorePrice>;
}

/** One pass over products for O(1) row lookups. */
export function indexPrices(
  products: Product[],
  layouts: Pick<StoreLayout, 'id'>[],
): Map<string, ProductPriceInfo> {
  const out = new Map<string, ProductPriceInfo>();
  for (const p of products) {
    const byStore = new Map<string, StorePrice>();
    if (p.prices) {
      for (const l of layouts) {
        const sp = p.prices[l.id];
        if (sp && !p.notAt?.includes(l.id)) byStore.set(l.id, sp);
      }
    }
    out.set(p.id, { best: bestPrice(p, layouts), byStore });
  }
  return out;
}

export interface StoreListTotal {
  layoutId: string;
  /** Sum of known line totals (amount × qty). */
  knownTotal: number;
  /** List lines with no usable price at this store. */
  missingCount: number;
  /** List lines counted (to-buy, with a resolvable product or name). */
  itemCount: number;
}

/**
 * Estimated list cost per store from remembered product prices.
 * Uses amount × qty; skips `notAt` and unknown prices (tracked in missingCount).
 */
export function listTotals(
  items: ListItem[],
  catalog: Catalog,
  layouts: Pick<StoreLayout, 'id'>[],
): StoreListTotal[] {
  const toBuy = items.filter((i) => !i.done);
  return layouts.map((l) => {
    let knownTotal = 0;
    let missingCount = 0;
    let itemCount = 0;
    for (const item of toBuy) {
      itemCount++;
      const product = productFor(item, catalog);
      if (product?.notAt?.includes(l.id)) {
        missingCount++;
        continue;
      }
      const sp = product ? priceAt(product, l.id) : undefined;
      if (!sp) {
        missingCount++;
        continue;
      }
      const qty = item.qty && item.qty > 1 ? item.qty : 1;
      knownTotal += Math.round(sp.amount * qty * 100) / 100;
    }
    return {
      layoutId: l.id,
      knownTotal: Math.round(knownTotal * 100) / 100,
      missingCount,
      itemCount,
    };
  });
}

/** Store with the best list estimate: fewest missing, then lowest known total. */
export function cheapestStoreTotal(totals: StoreListTotal[]): StoreListTotal | undefined {
  const priced = totals.filter((t) => t.itemCount > 0 && t.missingCount < t.itemCount);
  if (!priced.length) return undefined;
  return priced.reduce((a, b) => {
    if (b.missingCount !== a.missingCount) return b.missingCount < a.missingCount ? b : a;
    return b.knownTotal < a.knownTotal ? b : a;
  });
}

/**
 * Short cue for a row: active-store price (when the list line has none) and
 * "Best: Store $x.xx" when another store is cheaper in a comparable unit.
 */
export function priceCue(
  product: Product | undefined,
  layoutId: string,
  layouts: StoreLayout[],
  listPrice?: number,
): string | undefined {
  if (!product) return undefined;
  const here = priceAt(product, layoutId);
  const best = bestPrice(product, layouts, { preferUnit: here?.unit });
  const parts: string[] = [];
  if (listPrice === undefined && here) {
    const f = formatPrice(here.amount);
    if (f) parts.push(f);
  }
  if (best && best.layoutId !== layoutId) {
    const name = layouts.find((l) => l.id === best.layoutId)?.name;
    const f = formatPrice(best.amount);
    if (name && f) {
      const hereAmount = listPrice ?? here?.amount;
      if (hereAmount === undefined || best.amount < hereAmount) {
        parts.push(`Best: ${name} ${f}`);
      }
    }
  }
  return parts.length ? parts.join(' · ') : undefined;
}
