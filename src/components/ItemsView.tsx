import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { inWalkingOrder, orderOf } from '../core/taxonomy';
import type { QuickAddResult, Snapshot } from '../App';
import { formatPrice, itemMatches, parsePrice, quickAddItems, type ItemFilter } from '../core/items';
import { normalize, type Catalog } from '../core/catalog';
import { ICON_CHOICES, PALETTE, categoryLook } from '../core/categories';
import { parseExactKey } from '../core/geometry';
import { locateProduct, resolveSpot } from '../core/locate';
import { addCategory, productCategoryIds, removeCategory, withCategories } from '../core/productCategories';
import { bestPrice, clearStorePrice, priceAt, priceCue, setStorePrice } from '../core/prices';
import type { Category, ListItem, Product, StoreLayout } from '../core/types';
import { resolveItemsGroupByCategory, resolveItemsSort, type Display } from '../display';
import { autoWhereText, whereText } from './whereText';
import { SpotPicker } from './SpotPicker';
import { CategoryPicker } from './CategoryPicker';
import { DisplayToggles, ItemsSortToggle } from './DisplayToggles';
import { ListsSheet, type ListsApi } from './ListsSheet';
import { AddItemsSheet } from './AddItemsSheet';
import { InlinePrice, QtyStepper, type ItemPatch } from './ItemRows';
import { SwipeRow } from './SwipeRow';
import { WherePanel } from './WherePanel';
import { aislesUsed, describeClue } from '../core/clues';
import { isUncategorizedPlace } from '../core/taxonomy';

interface Props {
  catalog: Catalog;
  layouts: StoreLayout[];
  layout: StoreLayout;
  setProducts: (fn: (prev: Product[]) => Product[]) => void;
  setCategories: (fn: (prev: Category[]) => Category[]) => void;
  setLayouts: (fn: (prev: StoreLayout[]) => StoreLayout[]) => void;
  onAddToList: (product: Product) => void;
  /** Ids of products already on the active shopping list. */
  onList: Set<string>;
  /** Active-list rows keyed by product id (unchecked first). */
  listItemOf: (productId: string) => ListItem | undefined;
  /**
   * Patch qty / price on the active list for this product.
   * Adds the product to the list first when it isn't there yet, so the × / $
   * toggles do something while browsing the catalog.
   */
  onPatchProduct: (product: Product, patch: ItemPatch) => void;
  /** Name of the list being stocked (where adds go). */
  listName: string;
  /** What Undo would put back right now, and putting it back. */
  snapshot: () => Snapshot;
  undo: (s: Snapshot) => void;
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
  listsOpen: boolean;
  onListsClose: () => void;
  lists: ListsApi;
  /** Product ids still to buy on a given list (for AddItemsSheet targeting). */
  onListIds: (listId: string) => Set<string>;
  /** Add names onto any list without forcing a switch. */
  quickAddTo: (listId: string, names: string[], mode: 'list' | 'cart') => QuickAddResult;
}

const newId = () => Math.random().toString(36).slice(2, 10);

export function ItemsView(props: Props) {
  const [tab, setTab] = useState<'items' | 'categories'>('items');
  /** Stock a (possibly non-active) list from ListsSheet without switching the trip. */
  const [addingFor, setAddingFor] = useState<string>();
  const [listToast, setListToast] = useState<{ text: string; snapshot: Snapshot } | null>(null);

  useEffect(() => {
    if (!listToast) return;
    const t = setTimeout(() => setListToast(null), 7000);
    return () => clearTimeout(t);
  }, [listToast]);

  const lookOf = useMemo(() => {
    const m = new Map(props.catalog.categories.map((c, i) => [c.id, categoryLook(c, i)]));
    return (id?: string) => (id ? m.get(id) : undefined);
  }, [props.catalog.categories]);

  return (
    <>
      {props.listsOpen && (
        <ListsSheet
          lists={props.lists}
          onClose={props.onListsClose}
          onCombined={(note, snap) => setListToast({ text: note, snapshot: snap })}
          onRemoved={(note, snap) => setListToast({ text: note, snapshot: snap })}
          onCleared={(note, snap) => setListToast({ text: note, snapshot: snap })}
          onDuplicated={(note, snap) => setListToast({ text: note, snapshot: snap })}
          onAddItems={(id) => { props.onListsClose(); setAddingFor(id); }}
        />
      )}
      {addingFor && (
        <AddItemsSheet
          listName={props.lists.all.find((l) => l.id === addingFor)?.name ?? props.listName}
          catalog={props.catalog}
          onList={props.onListIds(addingFor)}
          whereText={(p) => whereText(p, props.layout, props.catalog)}
          iconOf={(id) => lookOf(id)?.icon}
          onAdd={(names, mode) => props.quickAddTo(addingFor, names, mode)}
          onUndo={props.undo}
          onClose={() => setAddingFor(undefined)}
        />
      )}
      {listToast && (
        <div className="toast" role="status">
          <span className="toast-text">{listToast.text}</span>
          <button className="toast-btn" onClick={() => { props.undo(listToast.snapshot); setListToast(null); }}>Undo</button>
          <button className="icon" onClick={() => setListToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}
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
  { id: 'list', label: 'On list' },
  { id: 'notsold', label: 'Not sold here' },
];

interface ItemsToast {
  text: string;
  snapshot: Snapshot;
  /** Item to open with "Change". */
  openId?: string;
}

function ProductList({
  catalog, layouts, layout, setProducts, setCategories, onAddToList, onList, listItemOf, onPatchProduct,
  snapshot, undo, listName, display, setDisplay,
}: Props) {
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
  /** Subcategory heading being edited (from a tap on the grey sub-head). */
  const [editSubId, setEditSubId] = useState<string>();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const lookOf = useMemo(() => {
    const m = new Map(catalog.categories.map((c, i) => [c.id, categoryLook(c, i)]));
    return (id?: string) => (id ? m.get(id) : undefined);
  }, [catalog.categories]);

  const itemsSort = resolveItemsSort(display);
  const groupByCategory = resolveItemsGroupByCategory(display);
  const showQty = display.listQty ?? true;
  const showPrice = display.listPrice ?? false;

  const q = query.trim();
  const searching = q.length > 0 && !q.includes(',');
  const counts = useMemo(() => {
    const c = new Map<ItemFilter, number>();
    for (const f of FILTERS) c.set(f.id, catalog.products.filter((p) => itemMatches(p, f.id, layout, catalog, onList)).length);
    return c;
  }, [catalog, layout, onList]);

  /** An item's category group (the category its subcategory is in), or '' for none. */
  const groupOf = (p: Product) => (p.categoryId && catalog.categoryById.has(p.categoryId) ? catalog.topOf(p.categoryId) : '');

  const filtered = useMemo(() => {
    const shown = (searching ? catalog.suggest(q, 500) : catalog.products)
      .filter((p) => itemMatches(p, filter, layout, catalog, onList));
    const byName = (a: Product, b: Product) => a.name.localeCompare(b.name);
    const byCategoryThenName = (a: Product, b: Product) =>
      orderOf(a.categoryId ?? '') - orderOf(b.categoryId ?? '') || byName(a, b);
    return [...shown].sort(itemsSort === 'alpha' ? byName : byCategoryThenName);
  }, [catalog, q, searching, filter, layout, onList, itemsSort]);

  const groups = useMemo(() => {
    if (!groupByCategory) return [];
    const byCat = new Map<string, Product[]>();
    for (const p of filtered) {
      const key = groupOf(p);
      byCat.set(key, [...(byCat.get(key) ?? []), p]);
    }
    const byName = (a: Product, b: Product) => a.name.localeCompare(b.name);
    // Alpha sort: keep A–Z within each section; category sort already ordered by walking order.
    return [...inWalkingOrder(catalog.tops()).map((c) => ({ id: c.id, name: c.name })), { id: '', name: 'No category' }]
      .map((c) => ({
        ...c,
        products: itemsSort === 'alpha'
          ? [...(byCat.get(c.id) ?? [])].sort(byName)
          : (byCat.get(c.id) ?? []),
      }))
      .filter((g) => g.products.length);
  }, [catalog, filtered, groupByCategory, itemsSort]);

  // Searching, filtering, or flat mode shows everything; otherwise categories fold up into an index.
  const allOpen = searching || filter !== 'all' || !groupByCategory;
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

  /** Puts items on the active shopping list (skipping ones already there), with Undo. */
  function addManyToList(list: Product[]) {
    const fresh = list.filter((p) => !onList.has(p.id));
    if (!fresh.length) {
      setToast({
        text: `${list.length === 1 ? `${list[0].name} is` : 'They’re all'} already on “${listName}”.`,
        snapshot: snapshot(),
      });
      return;
    }
    const snap = snapshot();
    for (const p of fresh) onAddToList(p);
    setToast({ text: `Added ${nameList(fresh)} to “${listName}”.`, snapshot: snap });
  }

  /** Marks items (not) sold at the current store. */
  function setSoldHere(list: Product[], sold: boolean) {
    changeMany(list.map((p) => p.id), (p) => {
      const notAt = (p.notAt ?? []).filter((id) => id !== layout.id);
      return { ...p, notAt: sold ? notAt : [...notAt, layout.id] };
    }, sold ? `${nameList(list)} sold at ${layout.name}.` : `${nameList(list)} marked not sold at ${layout.name}.`);
  }
  const notSoldHere = (p: Product) => !!p.notAt?.includes(layout.id);

  const shown = groupByCategory ? groups.flatMap((g) => g.products) : filtered;
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
      const g = groupOf(p);
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
      alsoList ? `On “${listName}” now.` : '',
    ].filter(Boolean);
    setToast({ text: parts.join(' '), snapshot: snap, openId: one1?.id });
  }

  const row = (p: Product, keyPrefix = '') => {
    const key = keyPrefix + p.id;
    const open = openKey === key;
    const listed = onList.has(p.id);
    const listItem = listed ? listItemOf(p.id) : undefined;
    return (
    <li key={key} id={`item-${key}`} className={`item-entry${open ? ' open' : ''}${selecting && selected.has(p.id) ? ' chosen' : ''}`}>
      <SwipeRow
        disabled={selecting || open}
        onSwipeRight={listed ? undefined : () => addManyToList([p])}
        rightLabel={<>＋ Add to “{listName}”</>}
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
          <span className={`muted small where${p.locations?.[layout.id] ? ' set' : ''}`}>
            {[whereText(p, layout, catalog), showPrice ? priceCue(p, layout.id, layouts, listItem?.price) : undefined].filter(Boolean).join(' · ')}
          </span>
        </button>
        {showQty && (
          <QtyStepper
            item={listItem ?? { id: `new-${p.id}`, name: p.name, done: false }}
            onPatch={(patch) => onPatchProduct(p, patch)}
          />
        )}
        {showPrice && (
          <InlinePrice
            item={listItem ?? { id: `new-${p.id}`, name: p.name, done: false }}
            onPatch={(patch) => onPatchProduct(p, patch)}
          />
        )}
        <button
          className="icon add-icon"
          onClick={() => addManyToList([p])}
          disabled={listed}
          aria-label={listed ? `${p.name} is on “${listName}”` : `Add ${p.name} to “${listName}”`}
        >
          {listed ? '✓' : '+'}
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
            <span>Add to “{listName}”</span>
          </label>
          <span className="muted small hint">
            {q.includes(',') ? 'Enter adds each name.' : q ? (catalog.exact(q) ? 'Already in your items.' : `Enter adds “${q}”.`) : selecting ? 'Tap items to select.' : 'Swipe an item for shortcuts.'}
          </span>
          <button className={`chip select-toggle${selecting ? ' active' : ''}`} aria-pressed={selecting} onClick={() => startSelecting(!selecting)}>
            {selecting ? 'Done' : '☑ Select'}
          </button>
        </div>
        <DisplayToggles
          display={display}
          setDisplay={setDisplay}
          show={['itemsGroupByCategory', 'listQty', 'listPrice']}
          offByDefault={['buildMode', 'buildArea', 'buildDouble', 'listPrice']}
          lead={<ItemsSortToggle display={display} setDisplay={setDisplay} />}
        />
        <div className="chips filters" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'chip active' : 'chip'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.id === 'list' ? `On “${listName}”` : f.label}{f.id !== 'all' && <span className="count"> {counts.get(f.id)}</span>}
            </button>
          ))}
        </div>
        {groupByCategory && groups.length > 1 && (
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

      {groupByCategory && !allOpen && groups.length > 0 && (
        <div className="fold-all">
          <button className="link" onClick={() => setOpenGroups(openGroups.size ? new Set() : new Set(groups.map((g) => g.id)))}>
            {openGroups.size ? 'Fold all' : 'Show all items'}
          </button>
        </div>
      )}

      {!groupByCategory && filtered.length > 0 && (
        <section className="card group" aria-label="Grocery items">
          <ul className="items">
            {filtered.map((p) => row(p))}
          </ul>
        </section>
      )}

      {groupByCategory && groups.map((g) => {
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
            {open && (
              <ul className="items">
                {g.products.map((p, i) => {
                  // A subheading where the subcategory changes — tap to rename or move it.
                  const sub = p.categoryId && p.categoryId !== g.id ? catalog.categoryById.get(p.categoryId) : undefined;
                  const prevSub = i > 0 ? g.products[i - 1].categoryId : undefined;
                  return (
                    <Fragment key={p.id}>
                      {sub && sub.id !== prevSub && (
                        <li className="sub-head">
                          <button
                            type="button"
                            className="sub-head-btn"
                            onClick={() => setEditSubId(sub.id)}
                            aria-label={`Edit subcategory ${sub.name}`}
                          >
                            <span className="sub-head-name">{sub.name}</span>
                            <span className="muted small sub-head-hint">Edit</span>
                          </button>
                        </li>
                      )}
                      {row(p)}
                    </Fragment>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      {filtered.length === 0 && (
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
            <button
              className="btn"
              disabled={!chosen.length}
              onClick={() => addManyToList(chosen)}
              aria-label={`Add selected to “${listName}”`}
            >
              ＋ “{listName}”
            </button>
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

      {editSubId && catalog.categoryById.get(editSubId) && (
        <SubcategoryEditor
          category={catalog.categoryById.get(editSubId)!}
          catalog={catalog}
          iconOf={(id) => lookOf(id)?.icon}
          itemCount={catalog.products.filter((p) => p.categoryId === editSubId || p.extraCategoryIds?.includes(editSubId)).length}
          onSave={(patch, text) => {
            const snap = snapshot();
            setCategories((prev) => prev.map((c) => {
              if (c.id !== editSubId) return c;
              const next = { ...c };
              if (patch.name !== undefined) next.name = patch.name;
              if ('parent' in patch) {
                if (patch.parent) next.parent = patch.parent;
                else delete next.parent;
              }
              return next;
            }));
            setToast({ text, snapshot: snap });
            setEditSubId(undefined);
          }}
          onClose={() => setEditSubId(undefined)}
        />
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
 * Rename a subcategory or move it under a different top category (or promote
 * it). Opened by tapping a grey subcategory heading in the items list.
 */
function SubcategoryEditor({ category, catalog, iconOf, itemCount, onSave, onClose }: {
  category: Category;
  catalog: Catalog;
  iconOf: (id: string) => string | undefined;
  itemCount: number;
  onSave: (patch: Partial<Category>, text: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(category.name);
  const parentId = catalog.parentOf(category.id);
  const [under, setUnder] = useState<string | undefined>(parentId);
  const tops = useMemo(() => inWalkingOrder(catalog.tops().filter((c) => c.id !== category.id)), [catalog, category.id]);
  const commit = (nextParent: string | undefined) => {
    const trimmed = name.trim() || category.name;
    const parentChanged = nextParent !== parentId;
    const nameChanged = trimmed !== category.name;
    if (!parentChanged && !nameChanged) { onClose(); return; }
    const patch: Partial<Category> = { parent: nextParent };
    if (nameChanged) patch.name = trimmed;
    const parentName = nextParent ? catalog.categoryById.get(nextParent)?.name : undefined;
    const text = parentChanged
      ? (nextParent
        ? `“${trimmed}” moved under ${parentName}.`
        : `“${trimmed}” is now a top-level category.`)
      : `Renamed to “${trimmed}”.`;
    onSave(patch, text);
  };
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet subcat-sheet" role="dialog" aria-label={`Edit ${category.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>Subcategory</h2>
        <p className="muted small">{itemCount} item{itemCount === 1 ? '' : 's'} · change where it sits in the store order</p>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Subcategory name"
            autoFocus
          />
        </label>
        <div className="field">
          <span>Under</span>
          <div className="parent-chips" role="group" aria-label="Parent category">
            {tops.map((t) => (
              <button
                key={t.id}
                type="button"
                className={under === t.id ? 'chip active' : 'chip'}
                aria-pressed={under === t.id}
                onClick={() => setUnder(t.id)}
              >
                <span aria-hidden="true">{iconOf(t.id) ?? '·'}</span> {t.name}
              </button>
            ))}
          </div>
          <CategoryPicker
            value={under}
            categories={catalog.categories}
            topsOnly
            exclude={[category.id]}
            onPick={(id) => { if (id) setUnder(id); }}
            iconOf={iconOf}
            label="Search parent category"
            placeholder="Or search a parent category…"
          />
        </div>
        <button
          type="button"
          className="pick"
          onClick={() => { setUnder(undefined); commit(undefined); }}
        >
          Make its own top-level category
        </button>
        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => commit(under)}>Save</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Primary + extra categories, with one-tap sibling chips to switch subcategory
 * and an “Add another” picker for a second category (e.g. peanut butter).
 */
function CategoriesEditor({ product, catalog, iconOf, onChange }: {
  product: Product;
  catalog: Catalog;
  iconOf: (categoryId: string) => string | undefined;
  onChange: (fn: (p: Product) => Product, text: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const ids = productCategoryIds(product);
  const primary = ids[0];
  const parentId = primary ? catalog.parentOf(primary) : undefined;
  const siblings = useMemo(() => {
    if (!parentId) return [] as Category[];
    return inWalkingOrder(catalog.categories.filter((c) => catalog.parentOf(c.id) === parentId));
  }, [catalog, parentId]);
  const parentName = parentId ? catalog.categoryById.get(parentId)?.name : undefined;
  const labelOf = (id: string) => {
    const c = catalog.categoryById.get(id);
    if (!c) return id;
    const topId = catalog.topOf(c.id);
    const top = catalog.categoryById.get(topId);
    return top && top.id !== c.id ? `${c.name} · ${top.name}` : c.name;
  };

  return (
    <div className="field categories-editor">
      <span>Categories</span>
      {ids.length === 0 ? (
        <CategoryPicker
          categories={catalog.categories}
          onPick={(categoryId) => onChange((p) => withCategories(p, categoryId ? [categoryId] : []),
            `${product.name} → ${categoryId ? catalog.categoryById.get(categoryId)?.name : 'no category'}.`)}
          iconOf={iconOf}
          noneLabel="No category"
          label="Category"
        />
      ) : (
        <>
          <ul className="cat-chips" aria-label="Assigned categories">
            {ids.map((id, i) => (
              <li key={id} className={`cat-chip${i === 0 ? ' primary' : ''}`}>
                <span aria-hidden="true">{iconOf(id) ?? '·'}</span>
                <span className="cat-chip-name">{labelOf(id)}{i === 0 ? '' : ''}</span>
                {i === 0 && ids.length > 1 && <span className="muted small">Primary</span>}
                <button
                  type="button"
                  className="icon"
                  aria-label={`Remove ${catalog.categoryById.get(id)?.name ?? id}`}
                  onClick={() => onChange((p) => removeCategory(p, id),
                    `${product.name}: removed ${catalog.categoryById.get(id)?.name ?? 'category'}.`)}
                >×</button>
              </li>
            ))}
          </ul>
          {siblings.length > 1 && (
            <div className="subcat-quick" role="group" aria-label={`Switch subcategory${parentName ? ` in ${parentName}` : ''}`}>
              <span className="muted small">{parentName ? `${parentName} · tap to switch` : 'Subcategory'}</span>
              <div className="chips subcat-chips">
                {siblings.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={c.id === primary ? 'chip active' : 'chip'}
                    aria-pressed={c.id === primary}
                    onClick={() => {
                      if (c.id === primary) return;
                      onChange((p) => withCategories(p, [c.id, ...productCategoryIds(p).slice(1)]),
                        `${product.name} → ${c.name}.`);
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {adding ? (
            <CategoryPicker
              categories={catalog.categories}
              exclude={ids}
              onPick={(categoryId) => {
                setAdding(false);
                if (!categoryId) return;
                onChange((p) => addCategory(p, categoryId),
                  `${product.name}: also ${catalog.categoryById.get(categoryId)?.name}.`);
              }}
              iconOf={iconOf}
              noneLabel="Cancel"
              label="Add another category"
              placeholder="Add another category…"
              clearOnPick
              autoFocus
            />
          ) : (
            <button type="button" className="link add-cat" onClick={() => setAdding(true)}>
              ＋ Add another category
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Per-store price input for the item editor. */
function StorePriceRow({ product, layout, layouts, onSave, onClear }: {
  product: Product;
  layout: StoreLayout;
  layouts: StoreLayout[];
  onSave: (raw: string) => void;
  onClear: () => void;
}) {
  const known = priceAt(product, layout.id);
  const [text, setText] = useState(known ? String(known.amount) : '');
  useEffect(() => {
    setText(known ? String(known.amount) : '');
  }, [product.id, layout.id, known?.amount]);
  const best = bestPrice(product, layouts, { preferUnit: known?.unit });
  const elsewhere = best && best.layoutId !== layout.id
    ? `Best: ${layouts.find((l) => l.id === best.layoutId)?.name ?? 'elsewhere'} ${formatPrice(best.amount)}`
    : undefined;
  return (
    <div className="price-row store-price-row">
      <label className="price-field">
        <span className="muted small">Price at {layout.name}</span>
        <input
          className="price-input"
          inputMode="decimal"
          placeholder="0.00"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => onSave(text)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSave(text); (e.target as HTMLInputElement).blur(); } }}
          aria-label={`Price for ${product.name} at ${layout.name}`}
        />
      </label>
      {known && <span className="muted small price-preview">{formatPrice(known.amount)}</span>}
      {known && <button type="button" className="link" onClick={() => { setText(''); onClear(); }}>Clear</button>}
      {elsewhere && <span className="muted small price-cue">{elsewhere}</span>}
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
  const [whereAt, setWhereAt] = useState<StoreLayout | null>(null);
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

  const savePrice = (l: StoreLayout, raw: string) => {
    const next = parsePrice(raw);
    const cur = priceAt(product, l.id)?.amount;
    if (next === undefined) {
      if (cur === undefined) return;
      onChange((p) => clearStorePrice(p, l.id), `${product.name}: price cleared at ${l.name}.`);
      return;
    }
    if (next === cur) return;
    onChange((p) => setStorePrice(p, l.id, next), `${product.name}: ${formatPrice(next)} at ${l.name}.`);
  };

  const setLocation = (l: StoreLayout, key: string) => onChange((p) => {
    const locations = { ...p.locations };
    if (key) locations[l.id] = key;
    else delete locations[l.id];
    // Choosing a place (or restoring Automatic) undoes "unknown here".
    const next: Product = { ...p, locations };
    const clearedAt = (p.clearedAt ?? []).filter((id) => id !== l.id);
    if (clearedAt.length) next.clearedAt = clearedAt;
    else delete next.clearedAt;
    if (p.mapClues?.[l.id]) {
      const { [l.id]: _m, ...mapClues } = p.mapClues;
      void _m;
      if (Object.keys(mapClues).length) next.mapClues = mapClues;
      else delete next.mapClues;
    }
    return next;
  }, key ? `${product.name}: ${resolveSpot(key, l, catalog)?.label ?? 'place saved'}.` : `${product.name}: automatic place.`);

  /** Clears saved place + aisle answer so the item is unknown here (not Automatic). */
  const clearLocation = (l: StoreLayout) => onChange((p) => {
    const { [l.id]: _loc, ...locations } = p.locations ?? {};
    const { [l.id]: answer, ...clues } = p.clues ?? {};
    void _loc;
    const next: Product = {
      ...p,
      locations,
      clues,
      clearedAt: [...new Set([...(p.clearedAt ?? []), l.id])],
    };
    if (answer) next.mapClues = { ...p.mapClues, [l.id]: answer };
    return next;
  }, `${product.name}: location cleared at ${l.name}.`);

  const storeRow = (l: StoreLayout) => {
    const sold = !product.notAt?.includes(l.id);
    const unknown = !!product.clearedAt?.includes(l.id) || !!product.mapClues?.[l.id];
    // What "automatic" resolves to: the place stocking this item's top-level category (ignoring a clear).
    const auto = locateProduct({ ...product, locations: {}, notAt: [], clearedAt: undefined, mapClues: undefined }, l, catalog);
    const autoText = autoWhereText(auto, catalog);
    const clue = product.clues?.[l.id];
    const key = product.locations?.[l.id];
    const exactSpot = key && parseExactKey(key) ? resolveSpot(key, l, catalog) : undefined;
    const selectValue = unknown ? '__unknown__' : (key ?? '');
    // Location choices correspond to top-level categories: matching tops first, then other
    // categorized places, then uncategorized (marked so they're recognizable).
    const productTops = new Set(productCategoryIds(product).map((id) => catalog.topOf(id)));
    const placeTopIds = (pl: typeof l.places[number]) =>
      [...new Set(pl.categories.map((cid) => catalog.topOf(cid)))];
    const matchesTop = (pl: typeof l.places[number]) => placeTopIds(pl).some((t) => productTops.has(t));
    const forTops = l.places.filter((pl) => !isUncategorizedPlace(pl) && matchesTop(pl));
    const otherCat = l.places.filter((pl) => !isUncategorizedPlace(pl) && !matchesTop(pl));
    const noCat = l.places.filter((pl) => isUncategorizedPlace(pl));
    const placeOption = (pl: typeof l.places[number], markNoCat = false) => {
      const label = pl.label || 'Unnamed';
      const suffix = markNoCat ? ' · no category' : '';
      // Location sections are top-level categories (subs collapse to their live top).
      const sectionIds = placeTopIds(pl);
      return (
        <optgroup key={pl.id} label={`${label}${suffix}`}>
          <option value={pl.id}>{label}{suffix}</option>
          {sectionIds.length > 1 && sectionIds.map((cid) => (
            <option key={cid} value={`${pl.id}:${cid}`}>
              {label} · {catalog.categoryById.get(cid)?.name ?? cid}
            </option>
          ))}
        </optgroup>
      );
    };
    return (
      <div className="store-row" key={l.id}>
        <label className="check">
          <input type="checkbox" checked={sold} onChange={(e) => setSold(l, e.target.checked)} />
          <span>Sold at <b>{l.name}</b></span>
        </label>
        {sold && (
          <div className="location-row">
            <select
              value={selectValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__unknown__') clearLocation(l);
                else setLocation(l, v);
              }}
              aria-label={`Location at ${l.name}`}
            >
              <option value="">Automatic: {autoText}</option>
              <option value="__unknown__">Unknown — no place yet</option>
              {exactSpot && <option value={key}>📍 {exactSpot.label}</option>}
              {forTops.map((pl) => placeOption(pl))}
              {otherCat.map((pl) => placeOption(pl))}
              {noCat.map((pl) => placeOption(pl, true))}
            </select>
            <button type="button" className="btn" onClick={() => setMapFor(l)}>📍 Map</button>
            {!unknown && (
              <button type="button" className="btn" onClick={() => clearLocation(l)} aria-label={`Clear location of ${product.name} at ${l.name}`}>
                Clear
              </button>
            )}
          </div>
        )}
        {sold && (
          <div className="clue-row">
            <span className="muted small">🏷 {clue ? describeClue(clue) : 'No aisle or department yet'}</span>
            <button type="button" className="link" onClick={() => setWhereAt(l)}>{clue ? 'Change' : 'Set'}</button>
            {clue && (
              <button type="button" className="link" onClick={() => onChange((p) => {
                const clues = { ...p.clues };
                delete clues[l.id];
                return { ...p, clues };
              }, `${product.name}: aisle info cleared at ${l.name}.`)}>Clear</button>
            )}
          </div>
        )}
        {sold && (
          <StorePriceRow
            product={product}
            layout={l}
            layouts={layouts}
            onSave={(raw) => savePrice(l, raw)}
            onClear={() => {
              if (priceAt(product, l.id) === undefined) return;
              onChange((p) => clearStorePrice(p, l.id), `${product.name}: price cleared at ${l.name}.`);
            }}
          />
        )}
      </div>
    );
  };
  const others = layouts.filter((l) => l.id !== layout.id);
  const best = bestPrice(product, layouts);

  return (
    <div className="item-editor">
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitName(); } }} aria-label="Item name" />
        {duplicate && <span className="error">“{duplicate.name}” is already in the list.</span>}
      </label>
      <CategoriesEditor
        product={product}
        catalog={catalog}
        iconOf={iconOf}
        onChange={onChange}
      />
      {best && (
        <p className="muted small best-price-hint">
          Best known: {formatPrice(best.amount)} at {layouts.find((l) => l.id === best.layoutId)?.name ?? 'a store'}
        </p>
      )}
      {storeRow(layout)}
      {others.length > 0 && (
        <details className="other-stores">
          <summary className="muted small">Other stores ({others.length})</summary>
          {others.map(storeRow)}
        </details>
      )}

      {whereAt && (
        <WherePanel
          itemName={product.name}
          categoryId={product.categoryId}
          storeName={whereAt.name}
          recentAisles={aislesUsed(catalog.products, whereAt.id)}
          current={product.clues?.[whereAt.id]}
          onSave={(c) => {
            const at = whereAt;
            onChange((p) => {
              const clearedAt = (p.clearedAt ?? []).filter((id) => id !== at.id);
              const { [at.id]: _m, ...mapClues } = p.mapClues ?? {};
              void _m;
              return {
                ...p,
                clues: { ...p.clues, [at.id]: c },
                clearedAt: clearedAt.length ? clearedAt : undefined,
                mapClues,
              };
            }, `${product.name}: ${describeClue(c)} at ${at.name}.`);
            setWhereAt(null);
          }}
          onSkip={() => setWhereAt(null)}
        />
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
  const [editSubId, setEditSubId] = useState<string>();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of catalog.products) if (p.categoryId) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1);
    return m;
  }, [catalog]);

  const [iconFor, setIconFor] = useState<string | null>(null);
  const update = (id: string, patch: Partial<Category>) =>
    setCategories((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, ...patch };
      if ('parent' in patch && !patch.parent) delete next.parent;
      return next;
    }));
  const rename = (id: string, value: string) => update(id, { name: value });

  const tree = useMemo(() => {
    const tops = inWalkingOrder(catalog.tops());
    return tops.map((top, i) => ({
      top,
      i,
      subs: inWalkingOrder(catalog.categories.filter((c) => catalog.parentOf(c.id) === top.id)),
    }));
  }, [catalog]);

  function remove(cat: Category) {
    const n = counts.get(cat.id) ?? 0;
    const kids = catalog.categories.filter((c) => catalog.parentOf(c.id) === cat.id);
    const msg = n || kids.length
      ? `Delete “${cat.name}”?${n ? ` Its ${n} item${n === 1 ? '' : 's'} will have no category.` : ''}${kids.length ? ` ${kids.length} subcategor${kids.length === 1 ? 'y becomes' : 'ies become'} top-level.` : ''} It will be removed from every store layout.`
      : `Delete “${cat.name}”? It will be removed from every store layout.`;
    if (!confirm(msg)) return;
    setCategories((prev) => prev
      .filter((c) => c.id !== cat.id)
      .map((c) => {
        if (c.parent !== cat.id) return c;
        const n = { ...c };
        delete n.parent;
        return n;
      }));
    setProducts((prev) => prev.map((p) => (p.categoryId === cat.id ? { ...p, categoryId: undefined } : p)));
    setLayouts((prev) => prev.map((l) => ({
      ...l,
      places: l.places.map((p) => ({ ...p, categories: p.categories.filter((id) => id !== cat.id) })),
    })));
  }

  function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCategories((prev) => {
      const used = new Set(prev.map((c, i) => categoryLook(c, i).color));
      const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[prev.length % PALETTE.length];
      return [...prev, { id: `c-${newId()}`, name: trimmed, color, icon: '🛒' }];
    });
    setName('');
  }

  const row = (c: Category, i: number, nested: boolean) => {
    const look = categoryLook(c, i);
    const parentId = catalog.parentOf(c.id);
    return (
      <li key={c.id} className={`cat-item${nested ? ' cat-sub-item' : ''}`}>
        <div className="row">
          <label className="swatch" style={{ background: look.color }} title="Change colour">
            <input type="color" value={look.color} onChange={(e) => update(c.id, { color: e.target.value })} aria-label={`Colour for ${c.name}`} />
          </label>
          <button className="icon-pick" onClick={() => setIconFor(iconFor === c.id ? null : c.id)} aria-label={`Icon for ${c.name}`} aria-expanded={iconFor === c.id}>
            {look.icon}
          </button>
          <input value={c.name} onChange={(e) => rename(c.id, e.target.value)} aria-label={nested ? 'Subcategory name' : 'Category name'} />
          <span className="muted small count">{counts.get(c.id) ?? 0}</span>
          {nested && (
            <button type="button" className="link cat-move" onClick={() => setEditSubId(c.id)} aria-label={`Move ${c.name}`}>
              {parentId ? catalog.categoryById.get(parentId)?.name ?? 'Move' : 'Move'}
            </button>
          )}
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
  };

  return (
    <div className="categories-view">
      <form className="add-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. International" aria-label="New category name" />
        <button type="submit" disabled={!name.trim()}>Add</button>
      </form>
      <p className="muted small">
        Categories are grouped with their subcategories. Tap <b>Move</b> (or a subcategory heading on the Items tab) to put a subcategory under a different section.
      </p>
      <ul className="card cat-list">
        {tree.map(({ top, i, subs }) => (
          <Fragment key={top.id}>
            {row(top, i, false)}
            {subs.map((s, si) => row(s, i * 20 + si + 1, true))}
          </Fragment>
        ))}
      </ul>
      {editSubId && catalog.categoryById.get(editSubId) && (
        <SubcategoryEditor
          category={catalog.categoryById.get(editSubId)!}
          catalog={catalog}
          iconOf={(id) => categoryLook(catalog.categoryById.get(id), 0).icon}
          itemCount={counts.get(editSubId) ?? 0}
          onSave={(patch) => {
            update(editSubId, patch);
            setEditSubId(undefined);
          }}
          onClose={() => setEditSubId(undefined)}
        />
      )}
    </div>
  );
}
