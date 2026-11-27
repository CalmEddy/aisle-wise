import { useEffect, useMemo, useState } from 'react';
import { Icon } from './Icon';
import { MAIN_LIST } from '../core/types';
import type { ListItem, StoreLayout } from '../core/types';
import type { Catalog } from '../core/catalog';
import { itemsOn } from '../core/lists';
import { productFor } from '../core/locate';
import { orderOf } from '../core/taxonomy';
import type { QuickAddResult, Snapshot } from '../App';
import { resolveListsEditSort, type Display } from '../display';
import { AddItemsSheet } from './AddItemsSheet';
import type { Purchase } from '../core/purchases';
import { ListsEditSortToggle } from './DisplayToggles';
import { ItemRows, type ItemPatch } from './ItemRows';
import { type ListsApi } from './ListsSheet';
import { ToastBar, type Toast } from './ToastBar';
import { whereText } from './whereText';

const NEW_LIST = '__new__';

/**
 * Setup → Lists: pick/create a list, add items inline, edit like Shop
 * (qty / rename / remove) without cart check-off.
 * Selecting a list here does not change the Shop trip list.
 */
export function ListsManageView({ onShare, lists, catalog, layout, looks, allItems, purchases, setListItems, onListIds, inCartIds, onAnyListIds, quickAddTo, undo, snapshot, display, setDisplay }: {
  /** Opens the share sheet for the list being edited. */
  onShare: (listId: string) => void;
  lists: ListsApi;
  catalog: Catalog;
  layout: StoreLayout;
  looks: Map<string, { icon?: string; color?: string }>;
  allItems: ListItem[];
  /** Past purchases (for Buy again). */
  purchases: Purchase[];
  /** Update one list's items without touching others. */
  setListItems: (listId: string, fn: (prev: ListItem[]) => ListItem[]) => void;
  onListIds: (listId: string) => Set<string>;
  /** Product ids checked off (in cart) on any list. */
  inCartIds: Set<string>;
  /** Product ids waiting (to-buy) on any list. */
  onAnyListIds: Set<string>;
  quickAddTo: (listId: string, names: string[], mode: 'list' | 'cart') => QuickAddResult;
  undo: (s: Snapshot) => void;
  snapshot: () => Snapshot;
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
}) {
  const [editId, setEditId] = useState(lists.current);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newShared, setNewShared] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  // If the focused list was deleted (or first mount with stale id), fall back.
  useEffect(() => {
    if (!lists.all.some((l) => l.id === editId)) {
      setEditId(lists.all[0]?.id ?? MAIN_LIST);
    }
  }, [lists.all, editId]);

  const current = lists.all.find((l) => l.id === editId) ?? lists.all[0]!;
  const items = useMemo(() => itemsOn(allItems, current.id), [allItems, current.id]);
  const sort = resolveListsEditSort(display);
  const waiting = useMemo(() => items.filter((i) => !i.done), [items]);

  const sorted = useMemo(() => {
    if (sort === 'entry') return waiting;
    const withCat = waiting.map((item, index) => {
      const p = productFor(item, catalog);
      const catId = p?.categoryId ?? '';
      return { item, index, catId, name: (item.name || p?.name || '').toLowerCase() };
    });
    withCat.sort((a, b) => {
      if (sort === 'alpha') return a.name.localeCompare(b.name) || a.index - b.index;
      const oa = orderOf(a.catId);
      const ob = orderOf(b.catId);
      return oa - ob || a.name.localeCompare(b.name) || a.index - b.index;
    });
    return withCat.map((x) => x.item);
  }, [waiting, sort, catalog]);

  const showCatHeads = sort === 'category';
  const catsOf = useMemo(() => {
    if (!showCatHeads) return undefined;
    return (item: ListItem) => {
      const p = productFor(item, catalog);
      const id = p?.categoryId ?? '';
      const cat = id ? catalog.categoryById.get(id) : undefined;
      const parent = cat?.parent ? catalog.categoryById.get(cat.parent) : undefined;
      if (parent) return { top: parent.name, sub: cat?.name };
      if (cat) return { top: cat.name };
      return { top: 'Uncategorized' };
    };
  }, [showCatHeads, catalog]);

  const nameTaken = (n: string, except?: string) =>
    lists.all.some((l) => l.id !== except && l.name.trim().toLowerCase() === n.trim().toLowerCase());

  function note(text: string, snap: Snapshot) {
    setToast({ snapshot: snap, added: [], mode: 'list', note: text });
  }

  function onSelectChange(value: string) {
    if (value === NEW_LIST) {
      setCreating(true);
      setNewName('');
      return;
    }
    setCreating(false);
    setConfirmDelete(false);
    setRenaming(false);
    setEditId(value);
  }

  function createList() {
    const n = newName.trim();
    if (!n || nameTaken(n)) return;
    const id = lists.create(n, lists.household ? newShared : false);
    setEditId(id);
    setCreating(false);
    setNewName('');
    setNewShared(false);
  }

  function patchItem(item: ListItem, patch: ItemPatch) {
    setListItems(current.id, (prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
  }

  function removeItem(item: ListItem) {
    const snap = snapshot();
    setListItems(current.id, (prev) => prev.filter((i) => i.id !== item.id));
    note(`Removed ${item.name} from “${current.name}”.`, snap);
  }

  const iconOf = (item: ListItem) => {
    if (!display.listIcons) return undefined;
    const p = productFor(item, catalog);
    return p?.categoryId ? looks.get(p.categoryId)?.icon : undefined;
  };

  return (
    <div className="lists-manage">
      <p className="muted small lists-manage-lead">
        Build lists here. On Shop, pick which list to shop and use the cart.
      </p>

      <div className="lists-manage-pick">
        <label className="lists-select-label">
          <span className="sr-only">Which list</span>
          <select
            className="lists-select"
            aria-label="Which list"
            value={creating ? NEW_LIST : current.id}
            onChange={(e) => onSelectChange(e.target.value)}
          >
            {lists.all.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}{l.shared ? ' · shared' : ''}{(lists.counts.get(l.id) ?? 0) > 0 ? ` · ${lists.counts.get(l.id)} to buy` : ''}
              </option>
            ))}
            <option value={NEW_LIST}>＋ New list…</option>
          </select>
        </label>
        {!creating && (
          <button
            type="button"
            className="icon"
            aria-label={`More for ${current.name}`}
            aria-expanded={renaming || confirmDelete}
            onClick={() => {
              setConfirmDelete(false);
              setRenaming((v) => !v);
              setRenameText(current.name);
            }}
          >⋯</button>
        )}
      </div>

      {creating && (
        <form className="lists-create-form" onSubmit={(e) => { e.preventDefault(); createList(); }}>
        <div className="add-row lists-create">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New list, e.g. Taco night"
            aria-label="New list name"
            autoFocus
          />
          <button type="submit" disabled={!newName.trim() || nameTaken(newName)}>+ Create</button>
          <button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button>
        </div>
        {lists.household && (
          <label className="check share-option">
            <input type="checkbox" checked={newShared} onChange={(e) => setNewShared(e.target.checked)} />
            <span className="muted small">Share with {lists.household}</span>
          </label>
        )}
        </form>
      )}
      {creating && newName.trim() && nameTaken(newName) && (
        <p className="muted small list-warn">You already have a list with that name.</p>
      )}

      {!creating && renaming && (
        <form className="rename-list" onSubmit={(e) => {
          e.preventDefault();
          if (renameText.trim()) lists.rename(current.id, renameText.trim());
          setRenaming(false);
        }}>
          <input value={renameText} onChange={(e) => setRenameText(e.target.value)} aria-label="List name" autoFocus />
          <button className="btn primary">Save</button>
          <button type="button" className="btn" onClick={() => setRenaming(false)}>Cancel</button>
        </form>
      )}

      {!creating && !renaming && (
        <div className="lists-manage-actions" role="group" aria-label={`Actions for ${current.name}`}>
          <ListsEditSortToggle display={display} setDisplay={setDisplay} />
          <button type="button" className="btn" onClick={() => onShare(current.id)}><Icon name={current.shared ? 'users' : 'share-2'} /> {current.shared ? 'Shared' : 'Share'}</button>
          {current.id !== MAIN_LIST && (
            <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>Delete</button>
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="list-confirm">
          <p>Delete “{current.name}” and its {waiting.length + (lists.doneCounts.get(current.id) ?? 0)} item{(waiting.length + (lists.doneCounts.get(current.id) ?? 0)) === 1 ? '' : 's'}?</p>
          <div className="sheet-actions">
            <button className="btn" onClick={() => setConfirmDelete(false)}>Keep</button>
            <span style={{ flex: 1 }} />
            <button className="btn danger" onClick={() => {
              const name = current.name;
              const snap = lists.remove(current.id);
              setConfirmDelete(false);
              if (snap) note(`Deleted “${name}”.`, snap);
            }}>Delete</button>
          </div>
        </div>
      )}

      {!creating && (
        <>
          <AddItemsSheet
            inline
            allowCart={false}
            listName={current.name}
            catalog={catalog}
            onList={onListIds(current.id)}
            listedAnywhere={onAnyListIds}
            inCart={inCartIds}
            purchases={purchases}
            whereText={(p) => whereText(p, layout, catalog)}
            iconOf={(id) => (id ? looks.get(id)?.icon : undefined)}
            onAdd={(names) => {
              const r = quickAddTo(current.id, names, 'list');
              setToast({ ...r, mode: 'list' });
              return r;
            }}
            onUndo={undo}
          />

          <main className="lists-manage-items">
            {sorted.length === 0 ? (
              <div className="empty">
                <p>This list is empty.</p>
                <p className="muted">Type or speak above to add items. They appear here right away.</p>
              </div>
            ) : (
              <section className="card flat-list">
                <div className="stop-head">
                  <h3>{current.name}</h3>
                  <span className="muted small count-pill">{sorted.length} item{sorted.length === 1 ? '' : 's'}</span>
                </div>
                <ItemRows
                  items={sorted}
                  simple
                  noCheck
                  onToggle={() => {}}
                  onRemove={removeItem}
                  removable
                  onPatch={patchItem}
                  showQty
                  showPrice={!!display.listPrice}
                  showLocation={false}
                  iconOf={iconOf}
                  headingOf={catsOf}
                />
              </section>
            )}
          </main>
        </>
      )}

      {toast && (
        <ToastBar
          toast={toast}
          layout={layout}
          catalog={catalog}
          onUndo={() => { undo(toast.snapshot); setToast(null); }}
          onChange={() => setToast(null)}
          onMoveHere={() => setToast(null)}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
