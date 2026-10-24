import { useEffect, useMemo, useState } from 'react';
import { ItemsView } from './components/ItemsView';
import { LayoutEditor } from './components/LayoutEditor';
import { HouseholdButton, HouseholdSheet } from './components/HouseholdSheet';
import { ImportSheet, ShareSheet } from './components/ShareSheets';
import { ShoppingView } from './components/ShoppingView';
import { Catalog, normalize } from './core/catalog';
import { defaultCategories, defaultProducts } from './core/categories';
import { demoLayout } from './core/demoLayout';
import { Floor } from './core/floor';
import { productFor, resolveSpot } from './core/locate';
import {
  applyListShare, applyStoreShare, buildListShare, buildStoreShare, decodeShare, shareFromHash, type Share,
} from './core/share';
import type { Category, ListItem, Point, Product, StoreLayout } from './core/types';
import { useHousehold } from './sync/useHousehold';
import { usePersistentState } from './usePersistentState';

type View = 'list' | 'items' | 'layout';

export interface QuickAddResult {
  snapshot: { items: ListItem[]; products: Product[] };
  added: {
    productId: string;
    name: string;
    isNew: boolean;
    /** Spot key saved as the item's location in this store by this add. */
    savedAt?: string;
    alreadyOnList: boolean;
    /** The item was put in the cart away from its saved location: ask before moving it. */
    conflict?: { savedKey: string; hereKey: string };
  }[];
}

const newId = () => Math.random().toString(36).slice(2, 10);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function App() {
  const [layouts, setLayouts] = usePersistentState<StoreLayout[]>('aw.layouts', [demoLayout]);
  const [activeId, setActiveId] = usePersistentState('aw.activeLayout', demoLayout.id);
  const [view, setView] = usePersistentState<View>('aw.view', 'list');
  const [items, setItems] = usePersistentState<ListItem[]>('aw.items', []);
  const [products, setProducts] = usePersistentState<Product[]>('aw.products', defaultProducts);
  const [categories, setCategories] = usePersistentState<Category[]>('aw.categories', defaultCategories);
  const [pos, setPos] = usePersistentState<{ layoutId: string; point: Point } | null>('aw.position.v2', null);

  useMoveOldLocationsIntoProducts(setProducts);

  // Live sharing with a household (Supabase). Off unless configured and joined.
  const syncData = useMemo(() => ({ items, products, categories, layouts }), [items, products, categories, layouts]);
  const household = useHousehold(syncData, (d) => {
    setItems(() => d.items);
    setProducts(() => d.products);
    setCategories(() => d.categories);
    setLayouts(() => (d.layouts.length ? d.layouts : [demoLayout]));
  });
  const [householdOpen, setHouseholdOpen] = useState(false);
  const [joinCode, setJoinCode] = useState<string>();

  // Sharing: what we're sending, and anything that arrived in a link.
  const [sending, setSending] = useState<{ title: string; summary: string; share: Share } | null>(null);
  const [incoming, setIncoming] = useState<Share | 'error' | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const check = () => {
      const join = /^#join=([A-Za-z0-9]+)$/.exec(location.hash)?.[1];
      if (join) {
        history.replaceState(null, '', location.pathname + location.search);
        setJoinCode(join.toUpperCase());
        setHouseholdOpen(true);
        return;
      }
      const text = shareFromHash(location.hash);
      if (!text) return;
      history.replaceState(null, '', location.pathname + location.search);
      decodeShare(text).then(setIncoming, () => setIncoming('error'));
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const layout = layouts.find((l) => l.id === activeId) ?? layouts[0] ?? demoLayout;
  const floor = useMemo(() => new Floor(layout), [layout]);
  const catalog = useMemo(() => new Catalog(products, categories), [products, categories]);
  const position = pos?.layoutId === layout.id ? pos.point : layout.entrance;
  const done = items.filter((i) => i.done).length;
  const onList = useMemo(
    () => new Set(items.filter((i) => !i.done).map((i) => productFor(i, catalog)?.id).filter(Boolean) as string[]),
    [items, catalog],
  );

  /** Remembers where an item is in the current store, adding it to the master list if it's new. */
  function setLocation(item: ListItem, spotKey: string) {
    const product = productFor(item, catalog);
    if (product) {
      setProducts((prev) => prev.map((p) => (p.id === product.id
        ? { ...p, locations: { ...p.locations, [layout.id]: spotKey }, notAt: p.notAt?.filter((id) => id !== layout.id) }
        : p)));
      return;
    }
    const created: Product = { id: `p-${newId()}`, name: capitalize(item.name.trim()), locations: { [layout.id]: spotKey } };
    setProducts((prev) => [...prev, created]);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, productId: created.id } : i)));
  }

  /**
   * Adds items while shopping. `mode: 'cart'` means the shopper is holding
   * it, so it's checked off and its location here is saved. New items join
   * the master list at `hereKey` (where the shopper is standing).
   */
  function quickAdd(names: string[], mode: 'list' | 'cart', hereKey?: string): QuickAddResult {
    const snapshot = { items, products };
    let nextProducts = products;
    let nextItems = items;
    const results: QuickAddResult['added'] = [];

    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      let product = new Catalog(nextProducts, categories).exact(name);
      let saved: string | undefined;
      let conflict: QuickAddResult['added'][number]['conflict'];

      if (!product) {
        product = { id: `p-${newId()}`, name: capitalize(name), ...(hereKey && { locations: { [layout.id]: hereKey } }) };
        nextProducts = [...nextProducts, product];
        saved = hereKey;
      } else if (mode === 'cart' && hereKey) {
        // You're holding it, so it's sold here. Save where you are only if it had no saved
        // location in this store; if it's saved somewhere else, ask before moving it.
        const savedKey = product.locations?.[layout.id];
        const savedSpot = savedKey ? resolveSpot(savedKey, layout, catalog) : undefined;
        const soldHere = !product.notAt?.includes(layout.id);
        if (!savedSpot || !soldHere) {
          const updated: Product = {
            ...product,
            locations: savedSpot ? product.locations : { ...product.locations, [layout.id]: hereKey },
            notAt: product.notAt?.filter((id) => id !== layout.id),
          };
          nextProducts = nextProducts.map((p) => (p.id === updated.id ? updated : p));
          if (!savedSpot) saved = hereKey;
          product = updated;
        }
        if (savedSpot && savedKey && savedSpot.placeId !== hereKey.split(':')[0]) {
          conflict = { savedKey, hereKey };
        }
      }

      const pid = product.id;
      const waiting = nextItems.find((i) => !i.done && (i.productId === pid || productFor(i, catalog)?.id === pid));
      if (waiting && mode === 'cart') {
        nextItems = nextItems.map((i) => (i.id === waiting.id ? { ...i, done: true, productId: pid } : i));
      } else if (!waiting) {
        nextItems = [...nextItems, { id: newId(), name: product.name, done: mode === 'cart', productId: pid }];
      }
      results.push({ productId: pid, name: product.name, isNew: !snapshot.products.some((p) => p.id === pid), savedAt: saved, alreadyOnList: !!waiting && mode === 'list', conflict });
    }

    setProducts(() => nextProducts);
    setItems(() => nextItems);
    return { snapshot, added: results };
  }

  function undo(snapshot: QuickAddResult['snapshot']) {
    setProducts(() => snapshot.products);
    setItems(() => snapshot.items);
  }

  /** Sets (or clears, with `null`) where a master-list item is in the current store. */
  function setProductLocation(productId: string, spotKey: string | null) {
    setProducts((prev) => prev.map((p) => {
      if (p.id !== productId) return p;
      const locations = { ...p.locations };
      if (spotKey) locations[layout.id] = spotKey;
      else delete locations[layout.id];
      return { ...p, locations, notAt: p.notAt?.filter((id) => id !== layout.id) };
    }));
  }

  /**
   * Marks a list item as (not) available at the current store, adding it to the
   * master list if it's new. Returns what to restore for Undo.
   */
  function setAvailable(item: ListItem, available: boolean): QuickAddResult['snapshot'] {
    const snapshot = { items, products };
    const product = productFor(item, catalog);
    if (product) {
      setProducts((prev) => prev.map((p) => {
        if (p.id !== product.id) return p;
        const notAt = (p.notAt ?? []).filter((id) => id !== layout.id);
        return { ...p, notAt: available ? notAt : [...notAt, layout.id] };
      }));
    } else if (!available) {
      const created: Product = { id: `p-${newId()}`, name: capitalize(item.name.trim()), notAt: [layout.id] };
      setProducts((prev) => [...prev, created]);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, productId: created.id } : i)));
    }
    return snapshot;
  }

  /** A copied store starts with the same item locations and "not sold here" settings. */
  function copyItemLocations(fromId: string, toId: string) {
    setProducts((prev) => prev.map((p) => ({
      ...p,
      locations: p.locations?.[fromId] ? { ...p.locations, [toId]: p.locations[fromId] } : p.locations,
      notAt: p.notAt?.includes(fromId) ? [...p.notAt, toId] : p.notAt,
    })));
  }

  function addToList(product: Product) {
    setItems((prev) => [...prev, { id: newId(), name: product.name, done: false, productId: product.id }]);
  }

  function shareList() {
    const share = buildListShare(items, catalog);
    setSending({ title: 'your list', summary: `${share.items.length} item${share.items.length === 1 ? '' : 's'} still to get.`, share });
  }

  function shareStore(l: StoreLayout) {
    const share = buildStoreShare(l, catalog);
    const located = share.items.filter((i) => i.at).length;
    const unavailable = share.items.filter((i) => i.notAvailable).length;
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const summary = `The store layout and ${plural(located, 'item location')}`
      + (unavailable ? `, plus ${plural(unavailable, 'item')} not available there.` : '.');
    setSending({ title: `“${l.name}”`, summary, share });
  }

  const data = () => ({ items, products, categories, layouts });

  function importList() {
    if (!incoming || incoming === 'error' || incoming.kind !== 'list') return;
    const r = applyListShare(incoming, data());
    setCategories(() => r.categories);
    setProducts(() => r.products);
    setItems(() => r.items);
    setIncoming(null);
    setView('list');
    setNotice(`Added ${r.added} item${r.added === 1 ? '' : 's'} to your list${r.skipped ? ` (${r.skipped} already on it)` : ''}.`);
  }

  function importStore(replaceId?: string) {
    if (!incoming || incoming === 'error' || incoming.kind !== 'store') return;
    const r = applyStoreShare(incoming, data(), replaceId);
    setCategories(() => r.categories);
    setProducts(() => r.products);
    setLayouts(() => r.layouts);
    setActiveId(r.layoutId);
    setIncoming(null);
    setView('list');
    const name = r.layouts.find((l) => l.id === r.layoutId)?.name;
    setNotice(replaceId ? `Updated “${name}”.` : `Added “${name}”. You’re now shopping there.`);
  }

  const tab = (id: View, label: string) => (
    <button role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
      {label}
    </button>
  );

  return (
    <div className="app">
      <header className="top">
        <div className="title">
          <h1>Aisle Wise</h1>
          {view !== 'layout' && layouts.length > 1 ? (
            <select className="store-pick" value={layout.id} onChange={(e) => setActiveId(e.target.value)} aria-label="Store">
              {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          ) : (
            <p className="muted">{layout.name}</p>
          )}
          <HouseholdButton api={household} onClick={() => setHouseholdOpen(true)} />
        </div>
        {view === 'list' && (
          <div className="top-right">
            {items.length > done && (
              <button className="btn share-btn" onClick={shareList} aria-label="Share list">Share</button>
            )}
            <div className="progress" aria-label="Progress">
              <strong>{done}</strong>/{items.length}
            </div>
          </div>
        )}
      </header>

      <nav className="tabs" role="tablist">
        {tab('list', 'List')}
        {tab('items', 'Items')}
        {tab('layout', 'Store layout')}
      </nav>

      {view === 'list' && (
        <ShoppingView
          layout={layout}
          floor={floor}
          catalog={catalog}
          items={items}
          setItems={setItems}
          setLocation={setLocation}
          quickAdd={quickAdd}
          undo={undo}
          setProductLocation={setProductLocation}
          setAvailable={setAvailable}
          position={position}
          setPosition={(point) => setPos({ layoutId: layout.id, point })}
          onEditLayout={() => setView('layout')}
        />
      )}
      {view === 'items' && (
        <ItemsView
          catalog={catalog}
          layouts={layouts}
          layout={layout}
          setProducts={setProducts}
          setCategories={setCategories}
          setLayouts={setLayouts}
          onAddToList={addToList}
          onList={onList}
        />
      )}
      {view === 'layout' && (
        <LayoutEditor
          layouts={layouts}
          setLayouts={setLayouts}
          activeId={layout.id}
          setActiveId={setActiveId}
          categories={categories}
          onCopied={copyItemLocations}
          onShare={shareStore}
          onDone={() => setView('list')}
        />
      )}
      {householdOpen && (
        <HouseholdSheet
          api={household}
          joinCode={household.household ? undefined : joinCode}
          onClose={() => { setHouseholdOpen(false); setJoinCode(undefined); }}
        />
      )}
      {sending && <ShareSheet {...sending} onClose={() => setSending(null)} />}
      {incoming && (
        <ImportSheet
          share={incoming}
          layouts={layouts}
          onAddList={importList}
          onAddStore={importStore}
          onCancel={() => setIncoming(null)}
        />
      )}
      {notice && <div className="toast top" role="status"><span className="toast-text">{notice}</span></div>}
    </div>
  );
}

/**
 * The previous version kept taught locations in a separate table keyed by
 * item name. Move them onto master-list items once, then drop the table.
 */
function useMoveOldLocationsIntoProducts(setProducts: (fn: (prev: Product[]) => Product[]) => void) {
  useEffect(() => {
    let old: Record<string, Record<string, string>> | null = null;
    try {
      old = JSON.parse(localStorage.getItem('aw.learned.v2') ?? 'null');
    } catch {
      return;
    }
    if (!old) return;
    setProducts((prev) => {
      const next = [...prev];
      for (const [layoutId, byName] of Object.entries(old!)) {
        for (const [name, spot] of Object.entries(byName)) {
          let i = next.findIndex((p) => normalize(p.name) === name);
          if (i < 0) {
            next.push({ id: `p-${newId()}`, name: capitalize(name) });
            i = next.length - 1;
          }
          next[i] = { ...next[i], locations: { ...next[i].locations, [layoutId]: spot } };
        }
      }
      return next;
    });
    try {
      localStorage.removeItem('aw.learned.v2');
    } catch {
      // ignore
    }
  }, [setProducts]);
}
