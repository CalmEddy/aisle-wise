import { Catalog, normalize } from './catalog';
import { withSides } from './geometry';
import type { Category, ListItem, Product, StoreLayout } from './types';

/**
 * Sharing without a server: everything needed is packed into the link
 * itself (JSON → deflate → base64url, after `#share=`). The part after `#`
 * never leaves the phone when the link is opened, so nothing is uploaded.
 */

export interface SharedItem {
  name: string;
  /** Category name (ids can differ between phones). */
  category?: string;
  /** Spot key in the shared store. */
  at?: string;
  notAvailable?: true;
}

export interface ListShare {
  v: 1;
  kind: 'list';
  items: SharedItem[];
}

export interface StoreShare {
  v: 1;
  kind: 'store';
  layout: StoreLayout;
  categories: Category[];
  items: SharedItem[];
}

export type Share = ListShare | StoreShare;

const newId = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Building

export function buildListShare(items: ListItem[], catalog: Catalog): ListShare {
  return {
    v: 1,
    kind: 'list',
    items: items.filter((i) => !i.done).map((i) => {
      const p = (i.productId && catalog.productById.get(i.productId)) || catalog.exact(i.name);
      const category = p?.categoryId ? catalog.categoryById.get(p.categoryId)?.name : undefined;
      return { name: p?.name ?? i.name, ...(category && { category }) };
    }),
  };
}

export function buildStoreShare(layout: StoreLayout, catalog: Catalog): StoreShare {
  const items: SharedItem[] = [];
  for (const p of catalog.products) {
    const at = p.locations?.[layout.id];
    const notAvailable = p.notAt?.includes(layout.id);
    if (!at && !notAvailable) continue;
    const category = p.categoryId ? catalog.categoryById.get(p.categoryId)?.name : undefined;
    items.push({ name: p.name, ...(category && { category }), ...(at && { at }), ...(notAvailable && { notAvailable: true as const }) });
  }
  const used = new Set(layout.places.flatMap((p) => p.categories));
  return { v: 1, kind: 'store', layout, categories: catalog.categories.filter((c) => used.has(c.id)), items };
}

// ---------------------------------------------------------------------------
// Encoding

export async function encodeShare(share: Share): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(share));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < packed.length; i += 0x8000) bin += String.fromCharCode(...packed.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeShare(text: string): Promise<Share> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const share = JSON.parse(await new Response(stream).text());
  if (!isShare(share)) throw new Error('Not an Aisle Wise share');
  return share;
}

export async function shareUrl(share: Share, base: string): Promise<string> {
  return `${base}#share=${await encodeShare(share)}`;
}

/** The share in a URL hash, if any. */
export function shareFromHash(hash: string): string | undefined {
  const m = /^#share=([A-Za-z0-9_-]+)$/.exec(hash);
  return m?.[1];
}

function isShare(x: unknown): x is Share {
  const s = x as Share;
  if (!s || s.v !== 1 || !Array.isArray(s.items) || !s.items.every((i) => typeof i?.name === 'string')) return false;
  if (s.kind === 'list') return true;
  const l = s.kind === 'store' ? s.layout : undefined;
  return !!l && typeof l.name === 'string' && Array.isArray(l.places) && Array.isArray(s.categories)
    && Number.isFinite(l.width) && Number.isFinite(l.height) && !!l.entrance && !!l.checkout;
}

// ---------------------------------------------------------------------------
// Importing

export interface Data {
  items: ListItem[];
  products: Product[];
  categories: Category[];
  layouts: StoreLayout[];
}

/** Finds (or creates) the local category for a shared one: same id, then same name. */
function categoryFor(name: string | undefined, id: string | undefined, cats: Category[], look?: Pick<Category, 'color' | 'icon'>): string | undefined {
  if (id && cats.some((c) => c.id === id)) return id;
  if (!name) return undefined;
  const byName = cats.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (byName) return byName.id;
  const created: Category = { id: id ?? `c-${newId()}`, name, ...(look?.color && { color: look.color }), ...(look?.icon && { icon: look.icon }) };
  cats.push(created);
  return created.id;
}

/** Finds (or creates) the local product for a shared item. */
function productForShared(item: SharedItem, products: Product[], cats: Category[]): Product {
  const key = normalize(item.name);
  const existing = products.find((p) => normalize(p.name) === key);
  if (existing) return existing;
  const created: Product = { id: `p-${newId()}`, name: item.name, categoryId: categoryFor(item.category, undefined, cats) };
  products.push(created);
  return created;
}

/** Adds shared list items to the local list, skipping ones already on it. */
export function applyListShare(share: ListShare, data: Data): Data & { added: number; skipped: number } {
  const categories = [...data.categories];
  const products = [...data.products];
  const items = [...data.items];
  const catalog = new Catalog(data.products, data.categories);
  let added = 0;
  let skipped = 0;
  for (const shared of share.items) {
    const product = productForShared(shared, products, categories);
    const onList = items.some((i) => !i.done && (i.productId === product.id || (catalog.exact(i.name)?.id ?? '') === product.id
      || normalize(i.name) === normalize(product.name)));
    if (onList) {
      skipped++;
      continue;
    }
    items.push({ id: newId(), name: product.name, done: false, productId: product.id });
    added++;
  }
  return { ...data, items, products, categories, added, skipped };
}

/**
 * Adds a shared store. `replaceId` updates that local store instead of
 * adding a new one. Item locations and "not available" settings come along.
 */
export function applyStoreShare(share: StoreShare, data: Data, replaceId?: string): Data & { layoutId: string } {
  const categories = [...data.categories];
  // Shared category id → local category id.
  const catMap = new Map(share.categories.map((c) => [c.id, categoryFor(c.name, c.id, categories, c)!]));
  // Keep the sender's id when we can, so a later share of the same store is recognised.
  const layoutId = replaceId ?? (data.layouts.some((l) => l.id === share.layout.id) ? `l-${newId()}` : share.layout.id);
  const names = new Set(data.layouts.filter((l) => l.id !== replaceId).map((l) => l.name));
  let name = share.layout.name;
  if (!replaceId && names.has(name)) name = `${name} (shared)`;

  const layout: StoreLayout = {
    ...share.layout,
    id: layoutId,
    name,
    places: share.layout.places.map((p) => {
      const map = (ids: string[]) => ids.map((c) => catMap.get(c) ?? c).filter((c) => categories.some((x) => x.id === c));
      const place = { ...p, categories: map(p.categories) };
      return place.kind === 'aisle' && place.sides ? withSides(place, [map(place.sides[0]), map(place.sides[1])]) : place;
    }),
  };
  const remapKey = (key: string) => {
    const [placeId, cat] = key.split(':');
    return cat ? `${placeId}:${catMap.get(cat) ?? cat}` : placeId;
  };

  const products = data.products.map((p) => {
    if (!replaceId) return p;
    // Updating a store: the shared copy's item locations replace ours.
    const locations = { ...p.locations };
    delete locations[replaceId];
    return { ...p, locations, notAt: p.notAt?.filter((id) => id !== replaceId) };
  });
  for (const shared of share.items) {
    const product = productForShared(shared, products, categories);
    const i = products.indexOf(product);
    products[i] = {
      ...product,
      locations: shared.at ? { ...product.locations, [layoutId]: remapKey(shared.at) } : product.locations,
      notAt: shared.notAvailable ? [...(product.notAt ?? []).filter((id) => id !== layoutId), layoutId] : product.notAt,
    };
  }

  const layouts = replaceId
    ? data.layouts.map((l) => (l.id === replaceId ? layout : l))
    : [...data.layouts, layout];
  return { ...data, layouts, products, categories, layoutId };
}
