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

  remote(): Remote {
    return {
      fetchAll: async () => {
        if (this.down) throw new Error('offline');
        return [...this.docs.values()].map((d) => structuredClone(d));
      },
      push: async (docs) => {
        if (this.down) throw new Error('offline');
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
    this.data = { items: [], lists: [], products: [], categories: defaultCategories, layouts: [demoLayout], ...data };
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
    expect(ben.data.categories[0].name).toBe('International');
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
