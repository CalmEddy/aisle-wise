import { useEffect, useMemo } from 'react';
import { ItemsView } from './components/ItemsView';
import { LayoutEditor } from './components/LayoutEditor';
import { ShoppingView } from './components/ShoppingView';
import { Catalog, normalize } from './core/catalog';
import { defaultCategories, defaultProducts } from './core/categories';
import { demoLayout } from './core/demoLayout';
import { Floor } from './core/floor';
import { productFor } from './core/locate';
import type { Category, ListItem, Point, Product, StoreLayout } from './core/types';
import { usePersistentState } from './usePersistentState';

type View = 'list' | 'items' | 'layout';

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

  function setSoldHere(product: Product, sold: boolean) {
    setProducts((prev) => prev.map((p) => {
      if (p.id !== product.id) return p;
      const notAt = (p.notAt ?? []).filter((id) => id !== layout.id);
      return { ...p, notAt: sold ? notAt : [...notAt, layout.id] };
    }));
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
        </div>
        {view === 'list' && (
          <div className="progress" aria-label="Progress">
            <strong>{done}</strong>/{items.length}
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
          setSoldHere={setSoldHere}
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
          onDone={() => setView('list')}
        />
      )}
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
