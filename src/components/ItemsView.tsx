import { useMemo, useState } from 'react';
import { normalize, type Catalog } from '../core/catalog';
import { parseExactKey } from '../core/geometry';
import { locateProduct, resolveSpot } from '../core/locate';
import type { Category, Product, StoreLayout } from '../core/types';
import { whereText } from './ShoppingView';
import { SpotPicker } from './SpotPicker';

interface Props {
  catalog: Catalog;
  layouts: StoreLayout[];
  layout: StoreLayout;
  setProducts: (fn: (prev: Product[]) => Product[]) => void;
  setCategories: (fn: (prev: Category[]) => Category[]) => void;
  setLayouts: (fn: (prev: StoreLayout[]) => StoreLayout[]) => void;
  onAddToList: (product: Product) => void;
  /** Ids of products already on the shopping list. */
  onList: Set<string>;
}

const newId = () => Math.random().toString(36).slice(2, 10);

export function ItemsView(props: Props) {
  const [tab, setTab] = useState<'items' | 'categories'>('items');
  return (
    <>
      <div className="segmented" role="tablist">
        <button className={tab === 'items' ? 'active' : ''} onClick={() => setTab('items')}>Grocery items</button>
        <button className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}>Categories</button>
      </div>
      {tab === 'items' ? <ProductList {...props} /> : <CategoryList {...props} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Master list of grocery items

function ProductList({ catalog, layouts, layout, setProducts, onAddToList, onList }: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q ? catalog.suggest(q, 500) : catalog.products;
    const sorted = [...shown].sort((a, b) => a.name.localeCompare(b.name));
    const byCat = new Map<string, Product[]>();
    for (const p of sorted) {
      const key = p.categoryId && catalog.categoryById.has(p.categoryId) ? p.categoryId : '';
      byCat.set(key, [...(byCat.get(key) ?? []), p]);
    }
    return [...catalog.categories.map((c) => ({ id: c.id, name: c.name })), { id: '', name: 'No category' }]
      .map((c) => ({ ...c, products: byCat.get(c.id) ?? [] }))
      .filter((g) => g.products.length);
  }, [catalog, query]);

  const startNew = () =>
    setEditing({ id: `p-${newId()}`, name: query.trim(), categoryId: catalog.categories[0]?.id });

  return (
    <div className="items-view">
      <div className="add-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${catalog.products.length} items`}
          aria-label="Search grocery items"
          type="search"
        />
        <button type="button" onClick={startNew}>+ New</button>
      </div>
      <p className="muted small">
        Tap an item to change its name, category, which stores sell it, and where it is in each store.
        Locations shown are for <b>{layout.name}</b>.
      </p>

      {groups.map((g) => (
        <section className="card group" key={g.id || 'none'}>
          <h3>{g.name} <span className="muted small">{g.products.length}</span></h3>
          <ul className="items">
            {g.products.map((p) => (
              <li key={p.id} className="row">
                <button className="product-row" onClick={() => setEditing(p)}>
                  <span className="name">{p.name}</span>
                  <span className={`muted small where${p.locations?.[layout.id] ? ' set' : ''}`}>{whereText(p, layout, catalog)}</span>
                </button>
                <button
                  className="icon add-icon"
                  onClick={() => onAddToList(p)}
                  disabled={onList.has(p.id)}
                  aria-label={onList.has(p.id) ? `${p.name} is on your list` : `Add ${p.name} to list`}
                >
                  {onList.has(p.id) ? '✓' : '+'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {groups.length === 0 && (
        <div className="empty">
          <p>No items match “{query}”.</p>
          <button className="btn primary" onClick={startNew}>Add “{query.trim()}” as a new item</button>
        </div>
      )}

      {editing && (
        <ProductSheet
          product={editing}
          isNew={!catalog.productById.has(editing.id)}
          catalog={catalog}
          layouts={layouts}
          onCancel={() => setEditing(null)}
          onSave={(p) => {
            setProducts((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]));
            setEditing(null);
          }}
          onDelete={() => {
            setProducts((prev) => prev.filter((x) => x.id !== editing.id));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ProductSheet({ product, isNew, catalog, layouts, onSave, onCancel, onDelete }: {
  product: Product;
  isNew: boolean;
  catalog: Catalog;
  layouts: StoreLayout[];
  onSave: (p: Product) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Product>(product);
  const [mapFor, setMapFor] = useState<StoreLayout | null>(null);
  const duplicate = catalog.products.find((p) => p.id !== draft.id && normalize(p.name) === normalize(draft.name));
  const valid = draft.name.trim() && !duplicate;

  const setSold = (layoutId: string, sold: boolean) =>
    setDraft((d) => {
      const notAt = (d.notAt ?? []).filter((id) => id !== layoutId);
      return { ...d, notAt: sold ? notAt : [...notAt, layoutId] };
    });

  const setLocation = (layoutId: string, key: string) =>
    setDraft((d) => {
      const locations = { ...d.locations };
      if (key) locations[layoutId] = key;
      else delete locations[layoutId];
      return { ...d, locations };
    });

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-label={isNew ? 'New item' : `Edit ${product.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>{isNew ? 'New grocery item' : 'Edit item'}</h2>
        <label className="field">
          <span>Name</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Kombucha" autoFocus={isNew} />
          {duplicate && <span className="error">“{duplicate.name}” is already in the list.</span>}
        </label>
        <label className="field">
          <span>Category</span>
          <select value={draft.categoryId ?? ''} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value || undefined })}>
            <option value="">No category</option>
            {catalog.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <div className="field">
          <span>Stores</span>
          {layouts.map((l) => {
            const sold = !draft.notAt?.includes(l.id);
            // What "automatic" resolves to: the place stocking this item's category.
            const auto = locateProduct({ ...draft, locations: {}, notAt: [] }, l, catalog);
            const autoText = auto.kind === 'spot' ? auto.spot.label : 'nowhere yet – pick a place';
            return (
              <div className="store-row" key={l.id}>
                <label className="check">
                  <input type="checkbox" checked={sold} onChange={(e) => setSold(l.id, e.target.checked)} />
                  <span>Available at <b>{l.name}</b></span>
                </label>
                {sold && (
                  <div className="location-row">
                  <select
                    value={draft.locations?.[l.id] ?? ''}
                    onChange={(e) => setLocation(l.id, e.target.value)}
                    aria-label={`Location at ${l.name}`}
                  >
                    <option value="">Automatic: {autoText}</option>
                    {(() => {
                      const key = draft.locations?.[l.id];
                      const spot = key && parseExactKey(key) ? resolveSpot(key, l, catalog) : undefined;
                      return spot && <option value={key}>📍 {spot.label}</option>;
                    })()}
                    {l.places.map((p) => (
                      <optgroup key={p.id} label={p.label || 'Unnamed'}>
                        <option value={p.id}>{p.label || 'Unnamed'}</option>
                        {p.categories.length > 1 && p.categories.map((cid) => (
                          <option key={cid} value={`${p.id}:${cid}`}>
                            {p.label} · {catalog.categoryById.get(cid)?.name ?? cid}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={() => setMapFor(l)}>Pick on map</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {mapFor && (
          <SpotPicker
            title={`Where is ${draft.name || 'this item'} at ${mapFor.name}?`}
            layout={mapFor}
            catalog={catalog}
            current={(() => {
              const loc = locateProduct(draft, mapFor, catalog);
              return loc.kind === 'spot' ? loc.spot.key : undefined;
            })()}
            onPick={(key) => {
              setLocation(mapFor.id, key);
              setMapFor(null);
            }}
            onCancel={() => setMapFor(null)}
          />
        )}

        <div className="sheet-actions">
          {!isNew && (
            <button
              className="btn danger"
              onClick={() => confirm(`Delete “${product.name}” from your grocery items?`) && onDelete()}
            >
              Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!valid} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories

function CategoryList({ catalog, setCategories, setProducts, setLayouts }: Props) {
  const [name, setName] = useState('');
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of catalog.products) if (p.categoryId) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1);
    return m;
  }, [catalog]);

  const rename = (id: string, value: string) =>
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name: value } : c)));

  const move = (index: number, delta: number) =>
    setCategories((prev) => {
      const next = [...prev];
      const [c] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, c);
      return next;
    });

  function remove(cat: Category) {
    const n = counts.get(cat.id) ?? 0;
    const msg = n
      ? `Delete “${cat.name}”? Its ${n} item${n === 1 ? '' : 's'} will have no category, and it will be removed from every store layout.`
      : `Delete “${cat.name}”? It will be removed from every store layout.`;
    if (!confirm(msg)) return;
    setCategories((prev) => prev.filter((c) => c.id !== cat.id));
    setProducts((prev) => prev.map((p) => (p.categoryId === cat.id ? { ...p, categoryId: undefined } : p)));
    setLayouts((prev) => prev.map((l) => ({
      ...l,
      places: l.places.map((p) => ({ ...p, categories: p.categories.filter((c) => c !== cat.id) })),
    })));
  }

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCategories((prev) => [...prev, { id: `c-${newId()}`, name: trimmed }]);
    setName('');
  }

  return (
    <div className="categories-view">
      <form className="add-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. International" aria-label="New category name" />
        <button type="submit" disabled={!name.trim()}>Add</button>
      </form>
      <p className="muted small">
        Rename categories here. This order is used for the grocery item list. To set where a category is in a store,
        open <b>Store layout</b> and tap an aisle or area.
      </p>
      <ul className="card cat-list">
        {catalog.categories.map((c, i) => (
          <li key={c.id} className="row">
            <input value={c.name} onChange={(e) => rename(c.id, e.target.value)} aria-label={`Category name`} />
            <span className="muted small count">{counts.get(c.id) ?? 0}</span>
            <button className="icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${c.name} up`}>↑</button>
            <button className="icon" onClick={() => move(i, 1)} disabled={i === catalog.categories.length - 1} aria-label={`Move ${c.name} down`}>↓</button>
            <button className="icon" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}>×</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
