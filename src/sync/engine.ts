import type { Category, ListItem, Product, ShoppingList, StoreLayout } from '../core/types';

/**
 * Keeps a phone's data in step with its household.
 *
 * Everything shared is split into small documents (one per list item,
 * grocery item and store, plus one for the category list). The engine
 * remembers the last version it saw on the server for each document (the
 * "shadow"); whatever differs from the shadow is a local change to send,
 * and anything arriving from the server updates both the data and the
 * shadow. The last write to a document wins.
 */

export type Kind = 'item' | 'product' | 'layout' | 'categories' | 'list';

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
  add('categories', 'all', d.categories);
  return docs;
}

/** Applies server documents to local data. */
export function applyDocs(d: SyncData, docs: Doc[]): SyncData {
  let { items, lists, products, categories, layouts } = d;
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
    else if (doc.kind === 'categories' && doc.id === 'all' && !doc.deleted && Array.isArray(doc.data)) categories = doc.data as Category[];
  }
  return { items, lists, products, categories, layouts };
}

export class SyncEngine {
  private shadow: Map<string, string>;
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private flushing?: Promise<void>;
  private stopped = false;
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
      if (!firstTime) await this.flush();
      const docs = await this.remote.fetchAll();
      if (this.stopped) return;
      const fresh = docs.filter((d) => this.shadow.get(key(d.kind, d.id)) !== (d.deleted ? '' : stable(d.data)));
      for (const d of docs) this.shadow.set(key(d.kind, d.id), d.deleted ? '' : stable(d.data));
      if (fresh.length) this.set(applyDocs(this.get(), fresh));
      this.saveShadow();
      await this.flush();
    } catch {
      this.setStatus('offline');
    }
  }

  private receive(doc: Doc) {
    if (this.stopped || doc.device === this.device) return; // our own echo
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
