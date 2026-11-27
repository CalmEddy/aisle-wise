import type { Purchase } from '../core/purchases';
import type { Category, ListItem, Product, ShoppingList, StoreLayout } from '../core/types';

/**
 * Keeps a phone's data in step with its household.
 *
 * Everything shared is split into small documents (one per list item,
 * grocery item, category and store). The engine
 * remembers the last version it saw on the server for each document (the
 * "shadow"); whatever differs from the shadow is a local change to send,
 * and anything arriving from the server updates both the data and the
 * shadow. The last write to a document wins.
 */

/**
 * 'categories' is the old single document holding every category. It is only
 * read, once, to move a household over to one 'category' document each (so
 * two people editing different categories no longer overwrite each other).
 */
export type Kind = 'item' | 'product' | 'layout' | 'category' | 'categories' | 'list' | 'purchase';

export interface Doc {
  kind: Kind;
  id: string;
  data: unknown;
  deleted: boolean;
  /** Phone that made the change. */
  device?: string;
}

export interface SyncData {
  items: ListItem[];
  /** Named shopping lists. */
  lists: ShoppingList[];
  products: Product[];
  categories: Category[];
  layouts: StoreLayout[];
  /** What was bought on past trips (feeds Buy again). */
  purchases: Purchase[];
}

/** Where documents are stored and how changes arrive. Supabase in the app; memory in tests. */
export interface Remote {
  fetchAll(): Promise<Doc[]>;
  /**
   * Saves documents. If the server can't store some kinds yet (its setup is
   * older than this app), it saves the rest and says which it refused; those
   * are tried again on the next save.
   */
  push(docs: Doc[]): Promise<void | { refused: Kind[] }>;
  /** Calls `onChange` for every change, including this phone's own. `onReconnect` after a dropped connection. */
  subscribe(onChange: (doc: Doc) => void, onReconnect: () => void): () => void;
}

export type SyncStatus = 'connecting' | 'synced' | 'saving' | 'offline';

const key = (kind: Kind, id: string) => `${kind}:${id}`;

/** JSON with sorted keys, so equal data always compares equal (Postgres reorders keys). */
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function toDocs(d: SyncData): Map<string, Doc> {
  const docs = new Map<string, Doc>();
  const add = (kind: Kind, id: string, data: unknown) => docs.set(key(kind, id), { kind, id, data, deleted: false });
  d.items.forEach((x) => add('item', x.id, x));
  d.lists.forEach((x) => add('list', x.id, x));
  d.products.forEach((x) => add('product', x.id, x));
  d.layouts.forEach((x) => add('layout', x.id, x));
  d.purchases.forEach((x) => add('purchase', x.id, x));
  d.categories.forEach((x) => add('category', x.id, x));
  return docs;
}

/** Applies server documents to local data. */
export function applyDocs(d: SyncData, docs: Doc[]): SyncData {
  let { items, lists, products, categories, layouts, purchases } = d;
  const put = <T extends { id: string }>(list: T[], doc: Doc): T[] => {
    const without = list.filter((x) => x.id !== doc.id);
    if (doc.deleted || !doc.data) return without.length === list.length ? list : without;
    const i = list.findIndex((x) => x.id === doc.id);
    if (i < 0) return [...list, doc.data as T];
    const next = [...list];
    next[i] = doc.data as T;
    return next;
  };
  for (const doc of docs) {
    if (doc.kind === 'item') items = put(items, doc);
    else if (doc.kind === 'list') lists = put(lists, doc);
    else if (doc.kind === 'product') products = put(products, doc);
    else if (doc.kind === 'layout') layouts = put(layouts, doc);
    else if (doc.kind === 'purchase') purchases = put(purchases, doc);
    else if (doc.kind === 'category') categories = put(categories, doc);
  }
  return { items, lists, products, categories, layouts, purchases };
}

export class SyncEngine {
  private shadow: Map<string, string>;
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private flushing?: Promise<void>;
  private stopped = false;
  /** Category documents assumed synced from the old single category document, until the server confirms. */
  private seeded = new Set<string>();
  status: SyncStatus = 'connecting';

  constructor(
    private remote: Remote,
    private device: string,
    private get: () => SyncData,
    private set: (d: SyncData) => void,
    private opts: {
      /** Wait this long after a change before sending (batches quick edits). */
      delay?: number;
      onStatus?: (s: SyncStatus) => void;
      /** Saved shadow from an earlier session, so offline edits survive a restart. */
      shadow?: Record<string, string>;
      saveShadow?: (s: Record<string, string>) => void;
      /** The server refused some kinds of document (its setup needs updating). Empty once all are accepted. */
      onRefused?: (kinds: Kind[]) => void;
    } = {},
  ) {
    this.shadow = new Map(Object.entries(opts.shadow ?? {}));
  }

  /**
   * First sync. With no shadow (first time on this phone) the server wins for
   * anything it has, and everything else here is uploaded – so joining a
   * household merges this phone's list into it. With a shadow, local edits
   * made while offline are sent first.
   */
  async start(): Promise<void> {
    this.setStatus('connecting');
    this.unsubscribe = this.remote.subscribe((doc) => this.receive(doc), () => void this.resync());
    await this.resync();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.unsubscribe?.();
  }

  /** Call whenever local data changes. */
  changed() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.delay ?? 400);
  }

  /** Sends local changes. Safe to call any time; failures are retried on the next change or reconnect. */
  async flush(): Promise<void> {
    if (this.flushing) {
      await this.flushing;
    }
    this.flushing = this.doFlush().finally(() => (this.flushing = undefined));
    return this.flushing;
  }

  /**
   * Phones that synced before categories became one document each remember
   * the old single document in their shadow. Treat each of its categories as
   * already synced, so only real edits made since are sent (not the whole
   * list, which could overwrite newer changes on the server). `resync` then
   * checks the server and uploads whatever it doesn't have yet.
   */
  private adoptLegacyShadow() {
    const legacyKey = key('categories', 'all');
    const legacy = this.shadow.get(legacyKey);
    if (legacy === undefined) return;
    this.shadow.delete(legacyKey);
    if ([...this.shadow.keys()].some((k) => k.startsWith('category:'))) return;
    try {
      const list: unknown = JSON.parse(legacy || 'null');
      if (!Array.isArray(list)) return;
      for (const c of list as Category[]) {
        if (!c || typeof c.id !== 'string') continue;
        this.shadow.set(key('category', c.id), stable(c));
        this.seeded.add(key('category', c.id));
      }
    } catch {
      // Unreadable old shadow: nothing to carry over.
    }
  }

  /**
   * Categories in the server's old single document that don't have a document
   * of their own yet (live or deleted). A deleted category isn't brought back,
   * and one that already has its own document is never overwritten.
   */
  private legacyCategories(all: Doc[]): Doc[] {
    const old = all.find((d) => d.kind === 'categories' && d.id === 'all' && !d.deleted && Array.isArray(d.data));
    if (!old) return [];
    const have = new Set(all.filter((d) => d.kind === 'category').map((d) => d.id));
    return (old.data as Category[])
      .filter((c) => c && typeof c.id === 'string' && !have.has(c.id))
      .map((c) => ({ kind: 'category' as const, id: c.id, data: c, deleted: false }));
  }

  private async doFlush() {
    if (this.stopped) return;
    const current = toDocs(this.get());
    const out: Doc[] = [];
    const sent = new Map<string, string>();
    for (const [k, doc] of current) {
      const json = stable(doc.data);
      if (this.shadow.get(k) !== json) {
        out.push({ ...doc, device: this.device });
        sent.set(k, json);
      }
    }
    for (const [k, json] of this.shadow) {
      if (current.has(k) || json === '') continue;
      const [kind, ...rest] = k.split(':');
      out.push({ kind: kind as Kind, id: rest.join(':'), data: null, deleted: true, device: this.device });
      sent.set(k, '');
    }
    if (!out.length) {
      if (this.status !== 'offline') this.setStatus('synced');
      return;
    }
    this.setStatus('saving');
    try {
      const result = await this.remote.push(out);
      const refused = new Set(result?.refused ?? []);
      // Refused documents stay "unsent" so they go again next time.
      for (const [k, json] of sent) if (!refused.has(k.split(':')[0] as Kind)) this.shadow.set(k, json);
      this.opts.onRefused?.([...refused]);
      this.saveShadow();
      this.setStatus('synced');
    } catch {
      this.setStatus('offline');
    }
  }

  /** Re-reads everything from the server: after starting and after a dropped connection. */
  async resync(): Promise<void> {
    const firstTime = this.shadow.size === 0;
    try {
      this.adoptLegacyShadow();
      if (!firstTime) await this.flush();
      const all = await this.remote.fetchAll();
      if (this.stopped) return;
      // The old single category document is never kept in the shadow (or deleted): old phones still use it.
      const docs = all.filter((d) => d.kind !== 'categories');
      const imported = this.legacyCategories(all);
      const fresh = docs.filter((d) => this.shadow.get(key(d.kind, d.id)) !== (d.deleted ? '' : stable(d.data)));
      for (const d of docs) this.shadow.set(key(d.kind, d.id), d.deleted ? '' : stable(d.data));
      // Categories the server doesn't have as documents yet get uploaded by the flush below.
      const onServer = new Set(docs.map((d) => key(d.kind, d.id)));
      for (const k of this.seeded) if (!onServer.has(k)) this.shadow.delete(k);
      for (const d of imported) this.shadow.delete(key(d.kind, d.id));
      this.seeded.clear();
      // The server's version of an imported category wins here, as it did before (skip ones this phone already has).
      const have = new Map(this.get().categories.map((c) => [c.id, stable(c)]));
      const toApply = [...fresh, ...imported.filter((d) => have.get(d.id) !== stable(d.data))];
      if (toApply.length) this.set(applyDocs(this.get(), toApply));
      this.saveShadow();
      await this.flush();
    } catch {
      this.setStatus('offline');
    }
  }

  private receive(doc: Doc) {
    if (this.stopped || doc.device === this.device) return; // our own echo
    if (doc.kind === 'categories') return; // old single category document: handled in resync
    const k = key(doc.kind, doc.id);
    const json = doc.deleted ? '' : stable(doc.data);
    if (this.shadow.get(k) === json) return;
    this.shadow.set(k, json);
    this.saveShadow();
    this.set(applyDocs(this.get(), [doc]));
  }

  private saveShadow() {
    this.opts.saveShadow?.(Object.fromEntries(this.shadow));
  }

  private setStatus(s: SyncStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }
}
