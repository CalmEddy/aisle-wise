import { describe, expect, it } from 'vitest';
import { defaultCategories } from '../core/categories';
import { demoLayout } from '../core/demoLayout';
import type { ListItem } from '../core/types';
import { SyncEngine, stable, type Doc, type Kind, type Remote, type SyncData } from './engine';

/** A pretend server shared by several phones. Like Supabase, it reorders JSON keys and echoes changes to everyone. */
class MemoryServer {
  docs = new Map<string, Doc>();
  listeners = new Set<{ onChange: (d: Doc) => void; onReconnect: () => void }>();
  down = false;
  /** Kinds an older database setup won't store. */
  refuse = new Set<Kind>();
  /** Everything phones have sent, batch by batch. */
  pushed: Doc[][] = [];

  remote(): Remote {
    return {
      fetchAll: async () => {
        if (this.down) throw new Error('offline');
        return [...this.docs.values()].map((d) => structuredClone(d));
      },
      push: async (docs) => {
        if (this.down) throw new Error('offline');
        this.pushed.push(docs.map((d) => structuredClone(d)));
        const refused = new Set<Kind>();
        for (const d of docs) {
          if (this.refuse.has(d.kind)) {
            refused.add(d.kind);
            continue;
          }
          const stored = { ...d, data: d.data === null ? null : JSON.parse(stable(d.data)) };
          // Postgres jsonb sorts keys; reverse them to make sure order never matters.
          if (stored.data && typeof stored.data === 'object' && !Array.isArray(stored.data)) {
            stored.data = Object.fromEntries(Object.entries(stored.data).reverse());
          }
          this.docs.set(`${d.kind}:${d.id}`, stored);
          for (const l of this.listeners) l.onChange(structuredClone(stored));
        }
        return refused.size ? { refused: [...refused] } : undefined;
      },
      subscribe: (onChange, onReconnect) => {
        const l = { onChange, onReconnect };
        this.listeners.add(l);
        return () => this.listeners.delete(l);
      },
    };
  }

  reconnect() {
    for (const l of this.listeners) l.onReconnect();
  }
}

class Phone {
  data: SyncData;
  engine: SyncEngine;
  sets = 0;
  constructor(server: MemoryServer, name: string, data: Partial<SyncData> = {}, shadow?: Record<string, string>) {
    this.data = { items: [], lists: [], products: [], categories: defaultCategories, layouts: [demoLayout], purchases: [], ...data };
    this.engine = new SyncEngine(server.remote(), name, () => this.data, (d) => { this.data = d; this.sets++; }, { delay: 0, shadow, saveShadow: (s) => (this.savedShadow = s) });
  }
  savedShadow: Record<string, string> = {};
  async edit(fn: (d: SyncData) => SyncData) {
    this.data = fn(this.data);
    await this.engine.flush();
  }
  names() {
    return this.data.items.map((i) => `${i.name}${i.done ? ' ✓' : ''}`).sort();
  }
}

const item = (id: string, name: string, done = false): ListItem => ({ id, name, done });
const addItem = (i: ListItem) => (d: SyncData) => ({ ...d, items: [...d.items, i] });

describe('household sync', () => {
  it('shares list changes both ways, including check-offs and deletes', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { items: [item('1', 'Milk')] });
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    expect(ben.names()).toEqual(['Milk']);

    await ben.edit(addItem(item('2', 'Bread')));
    expect(ana.names()).toEqual(['Bread', 'Milk']);

    await ana.edit((d) => ({ ...d, items: d.items.map((i) => (i.id === '1' ? { ...i, done: true } : i)) }));
    expect(ben.names()).toEqual(['Bread', 'Milk ✓']);

    await ben.edit((d) => ({ ...d, items: d.items.filter((i) => i.id !== '2') }));
    expect(ana.names()).toEqual(['Milk ✓']);
  });

  it('merges a joining phone’s own list into the household (server wins on clashes)', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { items: [item('1', 'Milk'), item('shared', 'Eggs')] });
    await ana.engine.start();
    const ben = new Phone(server, 'ben', { items: [item('2', 'Coffee'), item('shared', 'Eggs', true)] });
    await ben.engine.start();
    expect(ben.names()).toEqual(['Coffee', 'Eggs', 'Milk']);
    expect(ana.names()).toEqual(['Coffee', 'Eggs', 'Milk']);
  });

  it('shares purchase history between phones', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana');
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    const purchase = { id: 'p1', name: 'Milk', productId: 'milk', tripId: 't1', at: 5 };
    await ana.edit((d) => ({ ...d, purchases: [purchase] }));
    expect(ben.data.purchases).toEqual([purchase]);
    await ana.edit((d) => ({ ...d, purchases: [] }));
    expect(ben.data.purchases).toEqual([]);
  });

  it('syncs categories, grocery items and stores', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana');
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    await ana.edit((d) => ({
      ...d,
      categories: [{ id: 'intl', name: 'International' }, ...d.categories],
      products: [{ id: 'k', name: 'Kombucha', categoryId: 'intl', locations: { demo: 'a3' } }],
      layouts: [{ ...d.layouts[0], name: 'Renamed Market' }],
    }));
    expect(ben.data.categories.find((c) => c.id === 'intl')?.name).toBe('International');
    expect(ben.data.products).toEqual([{ id: 'k', name: 'Kombucha', categoryId: 'intl', locations: { demo: 'a3' } }]);
    expect(ben.data.layouts[0].name).toBe('Renamed Market');
  });

  it('does not echo changes back or loop', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana');
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    const before = ana.sets;
    await ana.edit(addItem(item('1', 'Milk')));
    expect(ana.sets).toBe(before); // own change isn't re-applied
    let pushes = 0;
    const push = server.remote().push;
    ben.engine['remote'].push = async (d) => { pushes++; return push(d); };
    await ben.engine.flush();
    expect(pushes).toBe(0); // Ben received it and has nothing new to send
  });

  it('keeps working offline and catches up when back', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana');
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();

    server.down = true;
    await ana.edit(addItem(item('1', 'Milk')));
    expect(ana.engine.status).toBe('offline');
    expect(ben.names()).toEqual([]);

    server.down = false;
    server.reconnect();
    await new Promise((r) => setTimeout(r, 10));
    expect(ben.names()).toEqual(['Milk']);
    expect(ana.engine.status).toBe('synced');
  });

  it('remembers unsent changes across an app restart', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana');
    await ana.engine.start();
    server.down = true;
    await ana.edit(addItem(item('1', 'Milk')));
    ana.engine.stop();

    // App reopened later, with signal again.
    server.down = false;
    const again = new Phone(server, 'ana', { items: ana.data.items }, ana.savedShadow);
    await again.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    expect(ben.names()).toEqual(['Milk']);
  });

  it('applies a change made elsewhere while this phone was offline', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { items: [item('1', 'Milk')] });
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    ben.engine.stop(); // Ben's phone goes to sleep
    await ana.edit((d) => ({ ...d, items: [] }));
    const benAgain = new Phone(server, 'ben', { items: ben.data.items }, ben.savedShadow);
    await benAgain.engine.start();
    expect(benAgain.names()).toEqual([]);
  });
});

describe('named lists', () => {
  it('sync, and items keep their list', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { lists: [{ id: 'main', name: 'Shopping list' }, { id: 'party', name: 'Party' }] });
    await ana.engine.start();
    await ana.edit(addItem({ ...item('1', 'Chips'), listId: 'party' }));
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    expect(ben.data.lists.map((l) => l.name).sort()).toEqual(['Party', 'Shopping list']);
    expect(ben.data.items[0].listId).toBe('party');
  });

  it('an older database setup refuses lists but everything else still syncs; lists go once it is updated', async () => {
    const server = new MemoryServer();
    server.refuse.add('list');
    const refusedSeen: Kind[][] = [];
    const ana = new Phone(server, 'ana', { lists: [{ id: 'party', name: 'Party' }], items: [item('1', 'Milk')] });
    ana.engine = new SyncEngine(server.remote(), 'ana', () => ana.data, (d) => { ana.data = d; }, { delay: 0, onRefused: (k) => refusedSeen.push(k) });
    await ana.engine.start();
    expect(server.docs.has('item:1')).toBe(true);
    expect(server.docs.has('list:party')).toBe(false);
    expect(refusedSeen[refusedSeen.length - 1]).toEqual(['list']);

    // The setup SQL is re-run: the next save sends the list.
    server.refuse.clear();
    await ana.edit(addItem(item('2', 'Eggs')));
    expect(server.docs.has('list:party')).toBe(true);
    expect(refusedSeen[refusedSeen.length - 1]).toEqual([]);
  });
});


describe('categories (one document each)', () => {
  const cats = defaultCategories.slice(0, 6);
  const named = (d: SyncData, id: string) => d.categories.find((c) => c.id === id)?.name;
  const ids = (d: SyncData) => d.categories.map((c) => c.id).sort();
  const categoryDocs = (server: MemoryServer) => [...server.docs.values()].filter((d) => d.kind === 'category' && !d.deleted);
  const withCats = (c: typeof cats) => ({ categories: c });
  const rename = (id: string, name: string) => (d: SyncData) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, name } : c)) });

  it('keeps edits to different categories made at the same time', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', withCats(cats));
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    server.down = true;
    await ana.edit(rename(cats[0].id, 'Fresh'));
    await ben.edit(rename(cats[1].id, 'Cold'));
    server.down = false;
    server.reconnect();
    await ana.engine.resync();
    await ben.engine.resync();
    await ana.engine.resync();
    for (const phone of [ana, ben]) {
      expect(named(phone.data, cats[0].id)).toBe('Fresh');
      expect(named(phone.data, cats[1].id)).toBe('Cold');
    }
  });

  it('shares a new category, a deletion, and does not bring the deleted one back', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', withCats(cats));
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    await ana.edit((d) => ({ ...d, categories: [...d.categories, { id: 'c-new', name: 'Pet food' }] }));
    expect(named(ben.data, 'c-new')).toBe('Pet food');
    await ben.edit((d) => ({ ...d, categories: d.categories.filter((c) => c.id !== cats[2].id) }));
    expect(ids(ana.data)).not.toContain(cats[2].id);
    // A phone that comes online later hears about the deletion too.
    const cal = new Phone(server, 'cal', withCats(cats));
    await cal.engine.start();
    expect(ids(cal.data)).not.toContain(cats[2].id);
    expect(ids(cal.data)).toContain('c-new');
  });

  it('sends only the category that changed', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', withCats(cats));
    await ana.engine.start();
    server.pushed.length = 0;
    await ana.edit(rename(cats[0].id, 'Fresh'));
    expect(server.pushed.flat().map((d) => `${d.kind}:${d.id}`)).toEqual([`category:${cats[0].id}`]);
  });

  describe('moving a household over from the old single category document', () => {
    const legacyDoc = (list: typeof cats): Doc => ({ kind: 'categories', id: 'all', data: list, deleted: false });
    const putLegacy = (server: MemoryServer, list: typeof cats) => server.docs.set('categories:all', legacyDoc(list));
    /** A phone as the previous version left it: its shadow holds the old single document. */
    const oldPhone = (server: MemoryServer, name: string, list: typeof cats) =>
      new Phone(server, name, withCats(list), { 'categories:all': stable(list) });

    it('uploads each category as its own document, leaving the old document alone', async () => {
      const server = new MemoryServer();
      putLegacy(server, cats);
      const ana = oldPhone(server, 'ana', cats);
      await ana.engine.start();
      expect(categoryDocs(server).map((d) => d.id).sort()).toEqual(ids(ana.data));
      expect(server.docs.get('categories:all')?.deleted).toBe(false);
      expect(server.docs.get('categories:all')?.data).toEqual(cats);
      // The old document is forgotten locally, so it's never sent or deleted.
      expect(Object.keys(ana.savedShadow)).not.toContain('categories:all');
      expect(server.pushed.flat().some((d) => d.kind === 'categories')).toBe(false);
    });

    it('does nothing more on later starts', async () => {
      const server = new MemoryServer();
      putLegacy(server, cats);
      const ana = oldPhone(server, 'ana', cats);
      await ana.engine.start();
      server.pushed.length = 0;
      const again = new Phone(server, 'ana', withCats(cats), ana.savedShadow);
      await again.engine.start();
      expect(server.pushed).toEqual([]);
    });

    it('does not overwrite newer edits already on the server with a phone’s older copy', async () => {
      const server = new MemoryServer();
      putLegacy(server, cats);
      const ana = oldPhone(server, 'ana', cats);
      await ana.engine.start();
      await ana.edit(rename(cats[0].id, 'Fresh'));
      // Ben still has the old list in his shadow and hasn't heard about Ana's edit.
      const ben = oldPhone(server, 'ben', cats);
      await ben.engine.start();
      expect(named(ben.data, cats[0].id)).toBe('Fresh');
      expect((server.docs.get(`category:${cats[0].id}`)?.data as { name: string }).name).toBe('Fresh');
    });

    it('keeps an edit made on the phone just before the update', async () => {
      const server = new MemoryServer();
      putLegacy(server, cats);
      const edited = cats.map((c, i) => (i === 1 ? { ...c, name: 'Mine' } : c));
      const ben = new Phone(server, 'ben', withCats(edited), { 'categories:all': stable(cats) });
      await ben.engine.start();
      expect((server.docs.get(`category:${cats[1].id}`)?.data as { name: string }).name).toBe('Mine');
      expect(named(ben.data, cats[1].id)).toBe('Mine');
      expect(categoryDocs(server)).toHaveLength(cats.length);
    });

    it('keeps a category deleted on the phone just before the update deleted', async () => {
      const server = new MemoryServer();
      putLegacy(server, cats);
      const fewer = cats.filter((_, i) => i !== 3);
      const ben = new Phone(server, 'ben', withCats(fewer), { 'categories:all': stable(cats) });
      await ben.engine.start();
      expect(server.docs.get(`category:${cats[3].id}`)?.deleted).toBe(true);
      expect(ids(ben.data)).not.toContain(cats[3].id);
    });

    it('does not bring back a category that was deleted after the move', async () => {
      const server = new MemoryServer();
      putLegacy(server, cats);
      const ana = oldPhone(server, 'ana', cats);
      await ana.engine.start();
      await ana.edit((d) => ({ ...d, categories: d.categories.filter((c) => c.id !== cats[4].id) }));
      const ben = oldPhone(server, 'ben', cats);
      await ben.engine.start();
      expect(ids(ben.data)).not.toContain(cats[4].id);
    });

    it('moves over a phone that has never synced, taking the household’s categories', async () => {
      const server = new MemoryServer();
      putLegacy(server, cats.map((c, i) => (i === 0 ? { ...c, name: 'Household name' } : c)));
      const cal = new Phone(server, 'cal', withCats(cats));
      await cal.engine.start();
      expect(named(cal.data, cats[0].id)).toBe('Household name');
      expect(categoryDocs(server).map((d) => d.id).sort()).toEqual(ids(cal.data));
    });

    it('ignores the old document when a phone that hasn’t updated yet changes it', async () => {
      const server = new MemoryServer();
      putLegacy(server, cats);
      const ana = oldPhone(server, 'ana', cats);
      await ana.engine.start();
      await ana.edit(rename(cats[0].id, 'Fresh'));
      // A phone on the previous version saves its own (older) idea of the list.
      const stale = cats.map((c, i) => (i === 0 ? { ...c, name: 'Stale' } : c));
      putLegacy(server, stale);
      for (const l of server.listeners) l.onChange(structuredClone(legacyDoc(stale)));
      server.reconnect();
      await ana.engine.resync();
      expect(named(ana.data, cats[0].id)).toBe('Fresh');
      // The next save must not delete the old document (phones on the previous version still use it).
      await ana.edit(rename(cats[1].id, 'Cold'));
      expect(server.docs.get('categories:all')?.deleted).toBe(false);
      expect(Object.keys(ana.savedShadow)).not.toContain('categories:all');
      expect(server.pushed.flat().some((d) => d.kind === 'categories')).toBe(false);
    });

    it('ignores a live change to the old document, and a following save never deletes it', async () => {
      const server = new MemoryServer();
      putLegacy(server, cats);
      const ana = oldPhone(server, 'ana', cats);
      await ana.engine.start();
      const stale = cats.map((c, i) => (i === 0 ? { ...c, name: 'Stale' } : c));
      putLegacy(server, stale);
      for (const l of server.listeners) l.onChange(structuredClone(legacyDoc(stale)));
      expect(named(ana.data, cats[0].id)).toBe(cats[0].name);
      await ana.edit(rename(cats[1].id, 'Cold'));
      expect(server.docs.get('categories:all')?.deleted).toBe(false);
      expect(server.pushed.flat().some((d) => d.kind === 'categories')).toBe(false);
      expect(Object.keys(ana.savedShadow)).not.toContain('categories:all');
    });

    it('re-uploads categories the server lost, when only the old shadow remembers them', async () => {
      const server = new MemoryServer(); // no categories on the server at all
      const ana = oldPhone(server, 'ana', cats);
      await ana.engine.start();
      expect(categoryDocs(server).map((d) => d.id).sort()).toEqual(ids(ana.data));
    });

    it('keeps categories on the phone while the database can’t store them yet, and sends them once it can', async () => {
      const server = new MemoryServer();
      server.refuse.add('category');
      putLegacy(server, cats);
      let refused: Kind[] = [];
      const ana = oldPhone(server, 'ana', cats);
      (ana.engine as unknown as { opts: { onRefused: (k: Kind[]) => void } }).opts.onRefused = (k) => (refused = k);
      await ana.engine.start();
      await ana.edit(addItem(item('1', 'Milk')));
      expect(refused).toEqual(['category']);
      expect(server.docs.get('item:1')).toBeTruthy();
      expect(ids(ana.data)).toEqual(ids({ categories: cats } as SyncData));
      server.refuse.clear();
      await ana.edit(rename(cats[0].id, 'Fresh'));
      expect(categoryDocs(server).map((d) => d.id).sort()).toEqual(ids(ana.data));
    });
  });
});
