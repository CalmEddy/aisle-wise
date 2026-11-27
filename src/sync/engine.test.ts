import { describe, expect, it } from 'vitest';
import { defaultCategories } from '../core/categories';
import { demoLayout } from '../core/demoLayout';
import { setListShared } from '../core/lists';
import type { ListItem, ShoppingList } from '../core/types';
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

/** Items with no list belong to this one, so most tests share it. */
const sharedMain: ShoppingList = { id: 'main', name: 'Shopping list', shared: true };

class Phone {
  data: SyncData;
  engine: SyncEngine;
  sets = 0;
  constructor(server: MemoryServer, name: string, data: Partial<SyncData> = {}, shadow?: Record<string, string>) {
    this.data = { items: [], lists: [sharedMain], products: [], categories: defaultCategories, layouts: [demoLayout], purchases: [], ...data };
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
    const ana = new Phone(server, 'ana', { lists: [sharedMain, { id: 'party', name: 'Party', shared: true }] });
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
    const ana = new Phone(server, 'ana', { lists: [sharedMain, { id: 'party', name: 'Party', shared: true }], items: [item('1', 'Milk')] });
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

describe('choosing which lists are shared', () => {
  const party: ShoppingList = { id: 'party', name: 'Party' };
  const onParty = (id: string, name: string): ListItem => ({ ...item(id, name), listId: 'party' });
  const settle = () => new Promise((r) => setTimeout(r, 10));

  it('never sends a private list or its items', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { lists: [sharedMain, party], items: [item('1', 'Milk'), onParty('2', 'Chips')] });
    await ana.engine.start();
    expect(server.docs.has('item:1')).toBe(true);
    expect(server.docs.has('item:2')).toBe(false);
    expect(server.docs.has('list:party')).toBe(false);
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    expect(ben.names()).toEqual(['Milk']);
    expect(ben.data.lists.map((l) => l.id)).toEqual(['main']);
  });

  it('sends a list and all its items when it becomes shared', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { lists: [sharedMain, party], items: [onParty('2', 'Chips'), onParty('3', 'Soda')] });
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    await ana.edit((d) => ({ ...d, lists: setListShared(d.lists, 'party', true) }));
    expect(ben.data.lists.find((l) => l.id === 'party')).toEqual({ id: 'party', name: 'Party', shared: true });
    expect(ben.names()).toEqual(['Chips', 'Soda']);
    await ben.edit(addItem(onParty('4', 'Cups')));
    expect(ana.names()).toEqual(['Chips', 'Cups', 'Soda']);
  });

  it('unsharing leaves everyone with a private copy and deletes nothing', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { lists: [sharedMain, { ...party, shared: true }], items: [onParty('2', 'Chips')] });
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    expect(ben.names()).toEqual(['Chips']);

    await ana.edit((d) => ({ ...d, lists: setListShared(d.lists, 'party', false) }));
    expect(ana.names()).toEqual(['Chips']);
    expect(ben.names()).toEqual(['Chips']);
    expect(ben.data.lists.find((l) => l.id === 'party')?.shared).toBe(false);
    expect(server.docs.get('item:2')?.deleted).toBe(false);

    // Edits on either side no longer travel.
    await ben.edit(addItem(onParty('3', 'Soda')));
    await ana.edit((d) => ({ ...d, items: d.items.map((i) => (i.id === '2' ? { ...i, done: true } : i)) }));
    expect(ana.names()).toEqual(['Chips ✓']);
    expect(ben.names()).toEqual(['Chips', 'Soda']);

    // A phone that joins afterwards never sees the list or its leftovers.
    const cy = new Phone(server, 'cy');
    await cy.engine.start();
    expect(cy.names()).toEqual([]);
    expect(cy.data.lists.map((l) => l.id)).toEqual(['main']);
  });

  it('unsharing while offline is told to the household once back online', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { lists: [sharedMain, { ...party, shared: true }], items: [onParty('2', 'Chips')] });
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    server.down = true;
    await ana.edit((d) => ({ ...d, lists: setListShared(d.lists, 'party', false) }));
    server.down = false;
    server.reconnect();
    await settle();
    expect(ben.data.lists.find((l) => l.id === 'party')?.shared).toBe(false);
    expect(ben.names()).toEqual(['Chips']);
  });

  it('moving an item off a shared list removes it for the others; moving one on shares it', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { lists: [sharedMain, party], items: [item('1', 'Milk'), onParty('2', 'Chips')] });
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    await ana.edit((d) => ({ ...d, items: d.items.map((i) => (i.id === '1' ? { ...i, listId: 'party' } : i)) }));
    expect(ben.names()).toEqual([]);
    expect(ana.names()).toEqual(['Chips', 'Milk']);
    await ana.edit((d) => ({ ...d, items: d.items.map((i) => (i.id === '2' ? { id: '2', name: 'Chips', done: false } : i)) }));
    expect(ben.names()).toEqual(['Chips']);
  });

  it('deleting a shared list removes it and its items for everyone', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { lists: [sharedMain, { ...party, shared: true }], items: [onParty('2', 'Chips')] });
    await ana.engine.start();
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    await ana.edit((d) => ({ ...d, lists: d.lists.filter((l) => l.id !== 'party'), items: [] }));
    expect(ben.data.lists.map((l) => l.id)).toEqual(['main']);
    expect(ben.names()).toEqual([]);
  });

  it('a private list with the same id as a household list joins it (merging items)', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { lists: [sharedMain, { ...party, shared: true }], items: [onParty('2', 'Chips')] });
    await ana.engine.start();
    const ben = new Phone(server, 'ben', { lists: [sharedMain, party], items: [onParty('9', 'Mine')] });
    await ben.engine.start(); // Ben adopts Ana's "party" (same id), so it's shared on his phone too
    expect(ben.data.lists.find((l) => l.id === 'party')?.shared).toBe(true);
    expect(ben.names()).toEqual(['Chips', 'Mine']);
  });

  it('keeps an item that arrives before its list, once the list shows up', async () => {
    const server = new MemoryServer();
    const ben = new Phone(server, 'ben'); // not started: so the two documents can be delivered one at a time
    const ana = new Phone(server, 'ana', { lists: [sharedMain, { ...party, shared: true }], items: [onParty('2', 'Chips')] });
    await ana.engine.start();
    // Deliver the item first, then the list.
    const itemDoc = structuredClone(server.docs.get('item:2')!);
    const listDoc = structuredClone(server.docs.get('list:party')!);
    ben.engine['receive'](itemDoc);
    expect(ben.names()).toEqual([]);
    ben.engine['receive'](listDoc);
    await settle();
    expect(ben.names()).toEqual(['Chips']);
    await ben.engine.flush();
    expect(server.docs.get('item:2')?.deleted).toBe(false); // never mistaken for a deletion
  });

  it('treats lists and items an older version already synced as shared', async () => {
    const server = new MemoryServer();
    const ana = new Phone(server, 'ana', { lists: [sharedMain, { id: 'party', name: 'Party', shared: true }], items: [onParty('2', 'Chips'), item('1', 'Milk')] });
    await ana.engine.start();
    // Ana's phone after upgrading: same data and saved sync state, but no sharing flags.
    ana.engine.stop();
    const upgraded = new Phone(
      server, 'ana',
      { lists: [{ id: 'main', name: 'Shopping list' }, { id: 'party', name: 'Party' }], items: ana.data.items },
      ana.savedShadow,
    );
    await upgraded.engine.start();
    expect(upgraded.data.lists.every((l) => l.shared === true)).toBe(true);
    expect(server.docs.get('item:2')?.deleted).toBe(false);
    expect(server.docs.get('list:party')?.deleted).toBe(false);
  });

  it('adopts lists from the household, even from versions that did not mark them shared', async () => {
    const server = new MemoryServer();
    server.docs.set('list:party', { kind: 'list', id: 'party', data: { id: 'party', name: 'Party' }, deleted: false });
    server.docs.set('item:2', { kind: 'item', id: '2', data: onParty('2', 'Chips'), deleted: false });
    const ben = new Phone(server, 'ben');
    await ben.engine.start();
    expect(ben.data.lists.find((l) => l.id === 'party')?.shared).toBe(true);
    expect(ben.names()).toEqual(['Chips']);
  });
});
