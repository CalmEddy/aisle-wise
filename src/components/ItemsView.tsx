import { useEffect, useMemo, useRef, useState } from 'react';
import type { Snapshot } from '../App';
import { itemMatches, quickAddItems, type ItemFilter } from '../core/items';
import { normalize, type Catalog } from '../core/catalog';
import { ICON_CHOICES, PALETTE, categoryLook } from '../core/categories';
import { parseExactKey } from '../core/geometry';
import { locateProduct, resolveSpot } from '../core/locate';
import type { Category, Product, StoreLayout } from '../core/types';
import { whereText } from './ShoppingView';
import { SpotPicker } from './SpotPicker';
import { CategoryPicker, byName } from './CategoryPicker';
import { SwipeRow } from './SwipeRow';

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
  /** What Undo would put back right now, and putting it back. */
  snapshot: () => Snapshot;
  undo: (s: Snapshot) => void;
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

const FILTERS: { id: ItemFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'place', label: 'Needs a place' },
  { id: 'nocat', label: 'No category' },
  { id: 'list', label: 'On my list' },
  { id: 'notsold', label: 'Not sold here' },
];

interface ItemsToast {
  text: string;
  snapshot: Snapshot;
  /** Item to open with "Change". */
  openId?: string;
}

function ProductList({ catalog, layouts, layout, setProducts, onAddToList, onList, snapshot, undo }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ItemFilter>('all');
  const [alsoList, setAlsoList] = useState(false);
  // Open item (inline editor; "recent-" + id when opened under Just added) and expanded categories.
  const [openKey, setOpenKey] = useState<string>();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // Added this visit, shown at the top so a guessed category is easy to fix.
  const [recent, setRecent] = useState<string[]>([]);
  const [toast, setToast] = useState<ItemsToast | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  // Multi-select: pick several items, then act on them all.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const lookOf = useMemo(() => {
    const m = new Map(catalog.categories.map((c, i) => [c.id, categoryLook(c, i)]));
    return (id?: string) => (id ? m.get(id) : undefined);
  }, [catalog.categories]);

  const q = query.trim();
  const searching = q.length > 0 && !q.includes(',');
  const counts = useMemo(() => {
    const c = new Map<ItemFilter, number>();
    for (const f of FILTERS) c.set(f.id, catalog.products.filter((p) => itemMatches(p, f.id, layout, catalog, onList)).length);
    return c;
  }, [catalog, layout, onList]);

  const groups = useMemo(() => {
    const shown = (searching ? catalog.suggest(q, 500) : catalog.products)
      .filter((p) => itemMatches(p, filter, layout, catalog, onList));
    const sorted = [...shown].sort((a, b) => a.name.localeCompare(b.name));
    const byCat = new Map<string, Product[]>();
    for (const p of sorted) {
      const key = p.categoryId && catalog.categoryById.has(p.categoryId) ? p.categoryId : '';
      byCat.set(key, [...(byCat.get(key) ?? []), p]);
    }
    return [...byName(catalog.categories).map((c) => ({ id: c.id, name: c.name })), { id: '', name: 'No category' }]
      .map((c) => ({ ...c, products: byCat.get(c.id) ?? [] }))
      .filter((g) => g.products.length);
  }, [catalog, q, searching, filter, layout, onList]);

  // Searching or filtering shows everything; otherwise categories fold up into an index.
  const allOpen = searching || filter !== 'all';
  const isOpen = (id: string) => allOpen || openGroups.has(id);
  const recentProducts = recent.map((id) => catalog.productById.get(id)).filter((p): p is Product => !!p);

  /** Changes one item, with Undo. */
  function change(id: string, fn: (p: Product) => Product, text: string) {
    changeMany([id], fn, text);
  }

  /** Changes several items at once, with one Undo. */
  function changeMany(ids: string[], fn: (p: Product) => Product, text: string) {
    const snap = snapshot();
    const set = new Set(ids);
    setProducts((prev) => prev.map((p) => (set.has(p.id) ? fn(p) : p)));
    setToast({ text, snapshot: snap });
  }

  const nameList = (list: Product[]) => (list.length === 1 ? list[0].name : `${list.length} items`);

  function removeMany(list: Product[]) {
    if (!list.length) return;
    const snap = snapshot();
    const set = new Set(list.map((p) => p.id));
    setProducts((prev) => prev.filter((x) => !set.has(x.id)));
    setOpenKey(undefined);
    setSelected((prev) => new Set([...prev].filter((id) => !set.has(id))));
    setToast({ text: `Deleted ${nameList(list)}.`, snapshot: snap });
  }
  const remove = (p: Product) => removeMany([p]);

  /** Puts items on the shopping list (skipping ones already there), with Undo. */
  function addManyToList(list: Product[]) {
    const fresh = list.filter((p) => !onList.has(p.id));
    if (!fresh.length) {
      setToast({ text: `${list.length === 1 ? `${list[0].name} is` : 'They’re all'} already on your list.`, snapshot: snapshot() });
      return;
    }
    const snap = snapshot();
    for (const p of fresh) onAddToList(p);
    setToast({ text: `Added ${nameList(fresh)} to your list.`, snapshot: snap });
  }

  /** Marks items (not) sold at the current store. */
  function setSoldHere(list: Product[], sold: boolean) {
    changeMany(list.map((p) => p.id), (p) => {
      const notAt = (p.notAt ?? []).filter((id) => id !== layout.id);
      return { ...p, notAt: sold ? notAt : [...notAt, layout.id] };
    }, sold ? `${nameList(list)} sold at ${layout.name}.` : `${nameList(list)} marked not sold at ${layout.name}.`);
  }
  const notSoldHere = (p: Product) => !!p.notAt?.includes(layout.id);

  const shown = groups.flatMap((g) => g.products);
  const chosen = catalog.products.filter((p) => selected.has(p.id));
  const toggleSelect = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  /** Selects every item in `list`, or clears them if they're all selected already. */
  const selectAll = (list: Product[]) => setSelected((prev) => {
    const all = list.every((p) => prev.has(p.id));
    const next = new Set(prev);
    for (const p of list) {
      if (all) next.delete(p.id);
      else next.add(p.id);
    }
    return next;
  });
  function startSelecting(on: boolean) {
    setSelecting(on);
    setSelected(new Set());
    setOpenKey(undefined);
  }

  /** Scrolls an element to just below the sticky search bar. */
  function scrollTo(el: Element | null) {
    if (!el) return;
    const below = (topRef.current?.offsetHeight ?? 0) + 8;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - below, behavior: 'smooth' });
  }

  /** Opens an item's editor: under Just added if it's there, else in its category. */
  function openItem(p: Product, viaRecent = recent.includes(p.id)) {
    const key = viaRecent ? `recent-${p.id}` : p.id;
    if (!viaRecent) {
      const g = p.categoryId && catalog.categoryById.has(p.categoryId) ? p.categoryId : '';
      setOpenGroups((prev) => new Set(prev).add(g));
    }
    setOpenKey(key);
    requestAnimationFrame(() => scrollTo(document.getElementById(`item-${key}`)));
  }

  function submit() {
    if (!q) return;
    // Exactly one name that's already there: open it.
    const one = !q.includes(',') ? catalog.exact(q) : undefined;
    if (one && !alsoList) {
      setQuery('');
      setFilter('all');
      openItem(one, false);
      return;
    }
    const snap = snapshot();
    const { created, existing } = quickAddItems(q, catalog);
    if (created.length) setProducts((prev) => [...prev, ...created]);
    if (alsoList) for (const p of [...created, ...existing]) if (!onList.has(p.id)) onAddToList(p);
    setRecent((prev) => [...created.map((p) => p.id), ...prev.filter((id) => !created.some((p) => p.id === id))].slice(0, 12));
    setQuery('');
    const names = (list: Product[]) => list.map((p) => p.name).join(', ');
    const one1 = created.length === 1 ? created[0] : undefined;
    const catName = one1?.categoryId ? catalog.categoryById.get(one1.categoryId)?.name : undefined;
    const parts = [
      created.length ? (one1 ? `Added ${one1.name} · ${catName ? `${catName} (guessed)` : 'no category'}.` : `Added ${names(created)}.`) : '',
      existing.length ? `${names(existing)} ${existing.length === 1 ? 'was' : 'were'} already in your items.` : '',
      alsoList ? 'On your list now.' : '',
    ].filter(Boolean);
    setToast({ text: parts.join(' '), snapshot: snap, openId: one1?.id });
  }

  const row = (p: Product, keyPrefix = '') => {
    const key = keyPrefix + p.id;
    const open = openKey === key;
    return (
    <li key={key} id={`item-${key}`} className={`item-entry${open ? ' open' : ''}${selecting && selected.has(p.id) ? ' chosen' : ''}`}>
      <SwipeRow
        disabled={selecting || open}
        onSwipeRight={onList.has(p.id) ? undefined : () => addManyToList([p])}
        rightLabel={<>＋ Add to list</>}
        leftActions={(close) => (
          <>
            <button className="swipe-btn sold" onClick={() => { close(); setSoldHere([p], notSoldHere(p)); }}>
              {notSoldHere(p) ? '✓ Sold here' : '🚫 Not sold here'}
            </button>
            <button className="swipe-btn delete" onClick={() => { close(); remove(p); }}>Delete</button>
          </>
        )}
      >
      <div className="row">
        {selecting && (
          <input type="checkbox" className="select-box" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`Select ${p.name}`} />
        )}
        <button className="product-row" onClick={() => (selecting ? toggleSelect(p.id) : setOpenKey(open ? undefined : key))} aria-expanded={selecting ? undefined : open}>
          <span className="name">{keyPrefix && <span aria-hidden="true">{lookOf(p.categoryId)?.icon ?? '·'} </span>}{p.name}</span>
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
      </div>
      </SwipeRow>
      {open && (
        <ItemEditor
          product={p}
          catalog={catalog}
          layouts={layouts}
          layout={layout}
          iconOf={(id) => lookOf(id)?.icon}
          onChange={(fn, text) => change(p.id, fn, text)}
          onDelete={() => remove(p)}
          onClose={() => setOpenKey(undefined)}
        />
      )}
    </li>
    );
  };

  return (
    <div className={`items-view${selecting ? ' selecting' : ''}`}>
      <div className="items-top" ref={topRef}>
        <form className="add-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search or add · ${catalog.products.length} items`}
            aria-label="Search or add grocery items"
            type="search"
            enterKeyHint="done"
          />
          <button type="submit" disabled={!q}>{q && !q.includes(',') && catalog.exact(q) && !alsoList ? 'Open' : '+ Add'}</button>
        </form>
        <div className="items-sub">
          <label className="also-list">
            <input type="checkbox" checked={alsoList} onChange={(e) => setAlsoList(e.target.checked)} />
            <span>Also add to my list</span>
          </label>
          <span className="muted small hint">
            {q.includes(',') ? 'Enter adds each name.' : q ? (catalog.exact(q) ? 'Already in your items.' : `Enter adds “${q}”.`) : selecting ? 'Tap items to select.' : 'Swipe an item for shortcuts.'}
          </span>
          <button className={`chip select-toggle${selecting ? ' active' : ''}`} aria-pressed={selecting} onClick={() => startSelecting(!selecting)}>
            {selecting ? 'Done' : '☑ Select'}
          </button>
        </div>
        <div className="chips filters" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'chip active' : 'chip'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}{f.id !== 'all' && <span className="count"> {counts.get(f.id)}</span>}
            </button>
          ))}
        </div>
        {groups.length > 1 && (
          <div className="chips jump" role="navigation" aria-label="Jump to category">
            {groups.map((g) => (
              <button key={g.id || 'none'} className="chip" onClick={() => {
                setOpenGroups((prev) => new Set(prev).add(g.id));
                requestAnimationFrame(() => scrollTo(document.getElementById(`grp-${g.id || 'none'}`)));
              }}>
                <span aria-hidden="true">{lookOf(g.id)?.icon ?? '·'}</span> {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {recentProducts.length > 0 && !searching && filter === 'all' && (
        <section className="card group recent">
          <h3>
            Just added <span className="muted small">{recentProducts.length}</span>
            <span style={{ flex: 1 }} />
            <button className="link" onClick={() => setRecent([])}>Clear</button>
          </h3>
          <ul className="items">{recentProducts.map((p) => row(p, 'recent-'))}</ul>
        </section>
      )}

      {!allOpen && groups.length > 0 && (
        <div className="fold-all">
          <button className="link" onClick={() => setOpenGroups(openGroups.size ? new Set() : new Set(groups.map((g) => g.id)))}>
            {openGroups.size ? 'Fold all' : 'Show all items'}
          </button>
        </div>
      )}

      {groups.map((g) => {
        const look = lookOf(g.id);
        const open = isOpen(g.id);
        return (
          <section className={`card group${open ? '' : ' folded'}`} key={g.id || 'none'} id={`grp-${g.id || 'none'}`}>
            <h3>
              <button className="group-head" aria-expanded={open} disabled={allOpen} onClick={() => setOpenGroups((prev) => {
                const next = new Set(prev);
                if (next.has(g.id)) next.delete(g.id);
                else next.add(g.id);
                return next;
              })}>
                {look ? <span className="cat-dot" style={{ background: look.color }} aria-hidden="true">{look.icon}</span> : null}
                <span>{g.name}</span> <span className="muted small">{g.products.length}</span>
                <span style={{ flex: 1 }} />
                {!allOpen && <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>}
              </button>
              {selecting && (
                <button className="link group-select" onClick={() => selectAll(g.products)}>
                  {g.products.every((p) => selected.has(p.id)) ? 'None' : 'All'}
                </button>
              )}
            </h3>
            {open && <ul className="items">{g.products.map((p) => row(p))}</ul>}
          </section>
        );
      })}

      {groups.length === 0 && (
        <div className="empty">
          {q ? (
            <>
              <p>No items match “{q}”.</p>
              <button className="btn primary" onClick={submit}>Add “{q}”</button>
            </>
          ) : <p>Nothing here{filter !== 'all' ? ' – all sorted!' : ' yet.'}</p>}
        </div>
      )}

      {selecting && (
        <div className="bulk-bar" role="toolbar" aria-label="Selected items">
          <div className="bulk-head">
            <b>{chosen.length} selected</b>
            <button className="link" onClick={() => selectAll(shown)}>
              {shown.length && shown.every((p) => selected.has(p.id)) ? 'Select none' : `Select all ${shown.length}`}
            </button>
            <span style={{ flex: 1 }} />
            <button className="icon" onClick={() => startSelecting(false)} aria-label="Stop selecting">×</button>
          </div>
          <div className="bulk-actions">
            <button className="btn" disabled={!chosen.length} onClick={() => setBulkCategory(true)}>Category…</button>
            <button className="btn" disabled={!chosen.length} onClick={() => addManyToList(chosen)}>＋ List</button>
            <button className="btn" disabled={!chosen.length} onClick={() => setSoldHere(chosen, chosen.every(notSoldHere))}>
              {chosen.length && chosen.every(notSoldHere) ? 'Sold here' : 'Not sold here'}
            </button>
            <button className="btn danger" disabled={!chosen.length} onClick={() => removeMany(chosen)}>Delete</button>
          </div>
        </div>
      )}

      {bulkCategory && (
        <div className="sheet-backdrop" onClick={() => setBulkCategory(false)}>
          <div className="sheet" role="dialog" aria-label="Category for selected items" onClick={(e) => e.stopPropagation()}>
            <h2>Category for {nameList(chosen)}</h2>
            <CategoryPicker
              categories={catalog.categories}
              onPick={(categoryId) => {
                changeMany(chosen.map((p) => p.id), (p) => ({ ...p, categoryId }),
                  `${nameList(chosen)} → ${categoryId ? catalog.categoryById.get(categoryId)?.name : 'no category'}.`);
                setBulkCategory(false);
              }}
              iconOf={(id) => lookOf(id)?.icon}
              noneLabel="No category"
              label="Category"
              placeholder="Type to search categories"
              autoFocus
            />
            <div className="sheet-actions">
              <span style={{ flex: 1 }} />
              <button className="btn" onClick={() => setBulkCategory(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <span className="toast-text">{toast.text}</span>
          <button className="toast-btn" onClick={() => { undo(toast.snapshot); setToast(null); }}>Undo</button>
          {toast.openId && catalog.productById.has(toast.openId) && (
            <button className="toast-btn" onClick={() => { openItem(catalog.productById.get(toast.openId!)!); setToast(null); }}>Change</button>
          )}
          <button className="icon" onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  );
}

/**
 * An item opened in place: every change saves straight away (with Undo).
 * Name, category, and for each store whether it's sold there and where.
 */
function ItemEditor({ product, catalog, layouts, layout, iconOf, onChange, onDelete, onClose }: {
  product: Product;
  catalog: Catalog;
  layouts: StoreLayout[];
  /** The store being shopped; other stores are folded away. */
  layout: StoreLayout;
  iconOf: (categoryId: string) => string | undefined;
  onChange: (fn: (p: Product) => Product, text: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(product.name);
  useEffect(() => setName(product.name), [product.name]);
  const [mapFor, setMapFor] = useState<StoreLayout | null>(null);
  const duplicate = catalog.products.find((p) => p.id !== product.id && normalize(p.name) === normalize(name));

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed || duplicate || trimmed === product.name) {
      if (!trimmed) setName(product.name);
      return;
    }
    onChange((p) => ({ ...p, name: trimmed }), `Renamed to ${trimmed}.`);
  }

  const setSold = (l: StoreLayout, sold: boolean) => onChange((p) => {
    const notAt = (p.notAt ?? []).filter((id) => id !== l.id);
    return { ...p, notAt: sold ? notAt : [...notAt, l.id] };
  }, sold ? `${product.name} is sold at ${l.name}.` : `${product.name} marked not sold at ${l.name}.`);

  const setLocation = (l: StoreLayout, key: string) => onChange((p) => {
    const locations = { ...p.locations };
    if (key) locations[l.id] = key;
    else delete locations[l.id];
    return { ...p, locations };
  }, key ? `${product.name}: ${resolveSpot(key, l, catalog)?.label ?? 'place saved'}.` : `${product.name}: automatic place.`);

  const storeRow = (l: StoreLayout) => {
    const sold = !product.notAt?.includes(l.id);
    // What "automatic" resolves to: the place stocking this item's category.
    const auto = locateProduct({ ...product, locations: {}, notAt: [] }, l, catalog);
    const autoText = auto.kind === 'spot' ? auto.spot.label : 'nowhere yet – pick a place';
    const key = product.locations?.[l.id];
    const exactSpot = key && parseExactKey(key) ? resolveSpot(key, l, catalog) : undefined;
    return (
      <div className="store-row" key={l.id}>
        <label className="check">
          <input type="checkbox" checked={sold} onChange={(e) => setSold(l, e.target.checked)} />
          <span>Sold at <b>{l.name}</b></span>
        </label>
        {sold && (
          <div className="location-row">
            <select value={key ?? ''} onChange={(e) => setLocation(l, e.target.value)} aria-label={`Location at ${l.name}`}>
              <option value="">Automatic: {autoText}</option>
              {exactSpot && <option value={key}>📍 {exactSpot.label}</option>}
              {l.places.map((pl) => (
                <optgroup key={pl.id} label={pl.label || 'Unnamed'}>
                  <option value={pl.id}>{pl.label || 'Unnamed'}</option>
                  {pl.categories.length > 1 && pl.categories.map((cid) => (
                    <option key={cid} value={`${pl.id}:${cid}`}>
                      {pl.label} · {catalog.categoryById.get(cid)?.name ?? cid}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button type="button" className="btn" onClick={() => setMapFor(l)}>📍 Map</button>
          </div>
        )}
      </div>
    );
  };
  const others = layouts.filter((l) => l.id !== layout.id);

  return (
    <div className="item-editor">
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitName(); } }} aria-label="Item name" />
        {duplicate && <span className="error">“{duplicate.name}” is already in the list.</span>}
      </label>
      <div className="field">
        <span>Category</span>
        <CategoryPicker
          value={product.categoryId}
          categories={catalog.categories}
          onPick={(categoryId) => onChange((p) => ({ ...p, categoryId }),
            `${product.name} → ${categoryId ? catalog.categoryById.get(categoryId)?.name : 'no category'}.`)}
          iconOf={iconOf}
          noneLabel="No category"
          label="Category"
        />
      </div>
      {storeRow(layout)}
      {others.length > 0 && (
        <details className="other-stores">
          <summary className="muted small">Other stores ({others.length})</summary>
          {others.map(storeRow)}
        </details>
      )}

      {mapFor && (
        <SpotPicker
          title={`Where is ${product.name} at ${mapFor.name}?`}
          layout={mapFor}
          catalog={catalog}
          current={(() => {
            const loc = locateProduct(product, mapFor, catalog);
            return loc.kind === 'spot' ? loc.spot.key : undefined;
          })()}
          onPick={(key) => {
            setLocation(mapFor, key);
            setMapFor(null);
          }}
          onCancel={() => setMapFor(null)}
        />
      )}

      <div className="editor-row">
        <button className="btn danger" onClick={onDelete}>Delete</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Done</button>
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

  const [iconFor, setIconFor] = useState<string | null>(null);
  const update = (id: string, patch: Partial<Category>) =>
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const rename = (id: string, value: string) => update(id, { name: value });

  // Shown A–Z. Re-sorted when a rename is finished, so rows don't jump while typing.
  const [sortTick, setSortTick] = useState(0);
  const order = useMemo(
    () => byName(catalog.categories).map((c) => c.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.categories.length, sortTick],
  );
  const shownCategories = order
    .map((id) => ({ c: catalog.categories.find((x) => x.id === id), i: catalog.categories.findIndex((x) => x.id === id) }))
    .filter((r): r is { c: Category; i: number } => !!r.c);

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
    setCategories((prev) => {
      // Next colour not already used, so new categories stand out.
      const used = new Set(prev.map((c, i) => categoryLook(c, i).color));
      const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[prev.length % PALETTE.length];
      return [...prev, { id: `c-${newId()}`, name: trimmed, color, icon: '🛒' }];
    });
    setName('');
  }

  return (
    <div className="categories-view">
      <form className="add-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. International" aria-label="New category name" />
        <button type="submit" disabled={!name.trim()}>Add</button>
      </form>
      <p className="muted small">
        Tap a colour or icon to change it. Rename categories here; they’re listed A–Z.
        To set where a category is in a store, open <b>Store layout</b> and tap an aisle or area.
      </p>
      <ul className="card cat-list">
        {shownCategories.map(({ c, i }) => {
          const look = categoryLook(c, i);
          return (
          <li key={c.id} className="cat-item">
           <div className="row">
            <label className="swatch" style={{ background: look.color }} title="Change colour">
              <input type="color" value={look.color} onChange={(e) => update(c.id, { color: e.target.value })} aria-label={`Colour for ${c.name}`} />
            </label>
            <button className="icon-pick" onClick={() => setIconFor(iconFor === c.id ? null : c.id)} aria-label={`Icon for ${c.name}`} aria-expanded={iconFor === c.id}>
              {look.icon}
            </button>
            <input value={c.name} onChange={(e) => rename(c.id, e.target.value)} onBlur={() => setSortTick((t) => t + 1)} aria-label={`Category name`} />
            <span className="muted small count">{counts.get(c.id) ?? 0}</span>
            <button className="icon" onClick={() => remove(c)} aria-label={`Delete ${c.name}`}>×</button>
           </div>
           {iconFor === c.id && (
             <div className="icon-grid" role="listbox" aria-label={`Choose an icon for ${c.name}`}>
               {ICON_CHOICES.map((icon) => (
                 <button key={icon} role="option" aria-selected={icon === look.icon} className={icon === look.icon ? 'active' : ''}
                   onClick={() => { update(c.id, { icon }); setIconFor(null); }}>{icon}</button>
               ))}
               <input
                 className="icon-own"
                 placeholder="Or type any emoji"
                 aria-label="Type an emoji"
                 onChange={(e) => {
                   const own = [...e.target.value.trim()].slice(0, 2).join('');
                   if (own) update(c.id, { icon: own });
                 }}
               />
             </div>
           )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
