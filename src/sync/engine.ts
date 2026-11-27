import { listOf, sharedListIds } from '../core/lists';
import type { Purchase } from '../core/purchases';
import type { Category, ListItem, Product, ShoppingList, StoreLayout } from '../core/types';

/**
 * Keeps a phone's data in step with its household.
 *
 * Everything shared is split into small documents (one per list, list item,
 * grocery item and store, plus one for the category list). Only lists marked
 * `shared` (and their items) take part; private lists never leave the phone.
 * Grocery items, stores, categories and purchases sync for the whole
 * household. The engine
 * remembers the last version it saw on the server for each document (the
 * "shadow"); whatever differs from the shadow is a local change to send,
 * and anything arriving from the server updates both the data and the
 * shadow. The last write to a document wins.
 */

export type Kind = 'item' | 'product' | 'layout' | 'categories' | 'list' | 'purchase';

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

/** The documents this phone should have on the server. Private lists and their items are left out. */
export function toDocs(d: SyncData, shared: Set<string> = sharedListIds(d.lists)): Map<string, Doc> {
  const docs = new Map<string, Doc>();
  const add = (kind: Kind, id: string, data: unknown) => docs.set(key(kind, id), { kind, id, data, deleted: false });
  // Lists first, so other phones know a list is shared before its items arrive.
  d.lists.filter((x) => shared.has(x.id)).forEach((x) => add('list', x.id, { ...x, shared: true }));
  d.items.filter((x) => shared.has(listOf(x))).forEach((x) => add('item', x.id, x));
  d.products.forEach((x) => add('product', x.id, x));
  d.layouts.forEach((x) => add('layout', x.id, x));
  d.purchases.forEach((x) => add('purchase', x.id, x));
  add('categories', 'all', d.categories);
  return docs;
}

export interface Accepted {
  data: SyncData;
  /** The documents that belong on this phone (the rest are ignored, not remembered). */
  accepted: Doc[];
  /** A list just became shared here, so its items may not have arrived yet. */
  adopted: boolean;
  /** Lists the household stopped sharing: this phone keeps them as private copies. */
  detached: string[];
}

/**
 * Applies server documents to local data, skipping anything for a list that
 * isn't shared on this phone (for example items left behind by a list that was
 * later unshared).
 */
export function acceptDocs(d: SyncData, docs: Doc[]): Accepted {
  let { items, lists, products, categories, layouts, purchases } = d;
  const accepted: Doc[] = [];
  const detached: string[] = [];
  let adopted = false;
  const put = <T extends { id: string }>(list: T[], doc: Doc): T[] => {
    const without = list.filter((x) => x.id !== doc.id);
    if (doc.deleted || !doc.data) return without.length === list.length ? list : without;
    const i = list.findIndex((x) => x.id === doc.id);
    if (i < 0) return [...list, doc.data as T];
    const next = [...list];
    next[i] = doc.data as T;
    return next;
  };

  // Lists first: they decide which items belong here.
  for (const doc of docs) {
    if (doc.kind !== 'list') continue;
    const local = lists.find((l) => l.id === doc.id);
    if (doc.deleted || !doc.data) {
      if (local && local.shared !== true) continue; // a private list of the same name isn't theirs to delete
      accepted.push(doc);
      if (local) {
        lists = lists.filter((l) => l.id !== doc.id);
        items = items.filter((i) => listOf(i) !== doc.id);
      }
      continue;
    }
    const data = doc.data as ShoppingList;
    if (data.shared === false) {
      // Unshared: keep our copy, but private. Nothing to do if we never had it.
      if (!local) continue;
      accepted.push(doc);
      detached.push(doc.id);
      lists = lists.map((l) => (l.id === doc.id ? { ...l, shared: false } : l));
      continue;
    }
    // Lists from older versions have no flag; being on the server means shared.
    if (!local || local.shared !== true) adopted = true;
    accepted.push(doc);
    lists = put(lists, { ...doc, data: { ...data, shared: true } });
  }

  const shared = sharedListIds(lists);
  for (const doc of docs) {
    if (doc.kind === 'list') continue;
    if (doc.kind === 'item') {
      const local = items.find((i) => i.id === doc.id);
      const gone = doc.deleted || !doc.data;
      const listId = gone ? (local ? listOf(local) : undefined) : listOf(doc.data as ListItem);
      if (listId !== undefined && !shared.has(listId)) continue;
      accepted.push(doc);
      items = put(items, doc);
      continue;
    }
    accepted.push(doc);
    if (doc.kind === 'product') products = put(products, doc);
    else if (doc.kind === 'layout') layouts = put(layouts, doc);
    else if (doc.kind === 'purchase') purchases = put(purchases, doc);
    else if (doc.kind === 'categories' && doc.id === 'all' && !doc.deleted && Array.isArray(doc.data)) categories = doc.data as Category[];
  }
  return { data: { items, lists, products, categories, layouts, purchases }, accepted, adopted, detached };
}

/** Applies server documents to local data. */
export const applyDocs = (d: SyncData, docs: Doc[]): SyncData => acceptDocs(d, docs).data;

/** The list a saved item document belonged to. */
function savedListId(json: string): string {
  try {
    return listOf(JSON.parse(json) as ListItem);
  } catch {
    return listOf({} as ListItem);
  }
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
    this.adoptLegacy();
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

  private live(k: string) {
    const json = this.shadow.get(k);
    return json !== undefined && json !== '';
  }

  /** Lists this phone shares, including ones whose flag was lost but that the server still has. */
  private sharedIds(d: SyncData) {
    return new Set(d.lists.filter((l) => l.shared === true || (l.shared === undefined && this.live(key('list', l.id)))).map((l) => l.id));
  }

  /** Stops tracking a list's items, without deleting them from the server. */
  private forgetItems(listId: string) {
    for (const [k, json] of this.shadow) {
      if (k.startsWith('item:') && json !== '' && savedListId(json) === listId) this.shadow.set(k, '');
    }
  }

  /**
   * Phones that were in a household before lists could be private shared
   * everything. Whatever they already sent counts as shared, so upgrading
   * never turns a shared list private (which would delete it for everyone).
   */
  private adoptLegacy() {
    if (!this.shadow.size) return;
    const d = this.get();
    const used = new Set<string>();
    for (const [k, json] of this.shadow) if (k.startsWith('item:') && json !== '') used.add(savedListId(json));
    let changed = false;
    const lists = d.lists.map((l) => {
      if (l.shared !== undefined || !(this.live(key('list', l.id)) || used.has(l.id))) return l;
      changed = true;
      return { ...l, shared: true };
    });
    if (changed) this.set({ ...d, lists });
  }

  /** Records documents that were applied here, and lets go of lists the household stopped sharing. */
  private record(r: Accepted) {
    for (const doc of r.accepted) this.shadow.set(key(doc.kind, doc.id), doc.deleted ? '' : stable(doc.data));
    for (const id of r.detached) {
      this.shadow.set(key('list', id), '');
      this.forgetItems(id);
    }
  }

  private async doFlush() {
    if (this.stopped) return;
    const data = this.get();
    const current = toDocs(data, this.sharedIds(data));
    const out: Doc[] = [];
    const sent = new Map<string, string>();
    // Lists made private here: tell the household once, and keep the items on this phone only.
    const unshared = new Set<string>();
    for (const l of data.lists) {
      if (l.shared !== false || !this.live(key('list', l.id))) continue;
      unshared.add(l.id);
      this.forgetItems(l.id);
      out.push({ kind: 'list', id: l.id, data: { ...l, shared: false }, deleted: false, device: this.device });
      sent.set(key('list', l.id), '');
    }
    for (const [k, doc] of current) {
      const json = stable(doc.data);
      if (this.shadow.get(k) !== json) {
        out.push({ ...doc, device: this.device });
        sent.set(k, json);
      }
    }
    for (const [k, json] of this.shadow) {
      if (current.has(k) || json === '' || (k.startsWith('list:') && unshared.has(k.slice(5)))) continue;
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
      const r = acceptDocs(this.get(), fresh);
      this.record(r);
      if (r.accepted.length) this.set(r.data);
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
    const r = acceptDocs(this.get(), [doc]);
    if (!r.accepted.length) return;
    this.record(r);
    this.saveShadow();
    this.set(r.data);
    // Items sent before their list was shared here were skipped; fetch them now.
    if (r.adopted) void this.resync();
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
