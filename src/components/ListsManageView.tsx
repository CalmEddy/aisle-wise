import { useEffect, useState } from 'react';
import { MAIN_LIST, type ShoppingList } from '../core/types';
import type { Catalog } from '../core/catalog';
import type { QuickAddResult, Snapshot } from '../App';
import { AddItemsSheet, type BuyAgainChip } from './AddItemsSheet';
import { type ListsApi } from './ListsSheet';
import { ToastBar, type Toast } from './ToastBar';
import { whereText } from './whereText';
import type { StoreLayout } from '../core/types';

/**
 * Setup → Lists: create and stock lists away from the store.
 * Trip selection ("which list am I shopping") lives on Shop, not here.
 */
export function ListsManageView({ lists, catalog, layout, looks, onListIds, quickAddTo, buyAgain, lastTripNames, undo }: {
  lists: ListsApi;
  catalog: Catalog;
  layout: StoreLayout;
  looks: Map<string, { icon?: string }>;
  onListIds: (listId: string) => Set<string>;
  quickAddTo: (listId: string, names: string[], mode: 'list' | 'cart') => QuickAddResult;
  buyAgain?: BuyAgainChip[];
  lastTripNames?: string[];
  undo: (s: Snapshot) => void;
}) {
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [menuFor, setMenuFor] = useState<string>();
  const [addingFor, setAddingFor] = useState<string>();
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const toBuy = (id: string) => lists.counts.get(id) ?? 0;
  const done = (id: string) => lists.doneCounts.get(id) ?? 0;
  const nameTaken = (n: string, except?: string) =>
    lists.all.some((l) => l.id !== except && l.name.trim().toLowerCase() === n.trim().toLowerCase());

  function status(id: string) {
    const n = toBuy(id);
    if (n > 0) return `${n} to buy`;
    if (done(id) > 0) return 'All checked';
    return 'Empty';
  }

  function note(text: string, snapshot: Snapshot) {
    setToast({ snapshot, added: [], mode: 'list', note: text });
  }

  const row = (l: ShoppingList) => {
    const openMenu = menuFor === l.id;
    const deleting = confirmDelete === l.id;
    const focused = l.id === lists.current;

    if (renaming === l.id) {
      return (
        <li key={l.id} className={focused ? 'current' : ''}>
          <form className="rename-list" onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) lists.rename(l.id, name.trim());
            setRenaming(undefined);
          }}>
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="List name" autoFocus />
            <button className="btn primary">Save</button>
            <button type="button" className="btn" onClick={() => setRenaming(undefined)}>Cancel</button>
          </form>
          {name.trim() && nameTaken(name, l.id) && (
            <p className="muted small list-warn">You already have a list called “{lists.all.find((x) => x.id !== l.id && x.name.trim().toLowerCase() === name.trim().toLowerCase())?.name}”.</p>
          )}
        </li>
      );
    }

    if (deleting) {
      return (
        <li key={l.id} className="list-confirm">
          <p>Delete “{l.name}” and its {toBuy(l.id) + done(l.id)} item{(toBuy(l.id) + done(l.id)) === 1 ? '' : 's'}?</p>
          <div className="sheet-actions">
            <button className="btn" onClick={() => setConfirmDelete(undefined)}>Keep</button>
            <span style={{ flex: 1 }} />
            <button className="btn danger" onClick={() => {
              const snap = lists.remove(l.id);
              setConfirmDelete(undefined);
              if (snap) note(`Deleted “${l.name}”.`, snap);
            }}>Delete</button>
          </div>
        </li>
      );
    }

    return (
      <li key={l.id} className={focused ? 'current' : ''}>
        <button
          className="list-pick"
          onClick={() => { lists.switchTo(l.id); setAddingFor(l.id); }}
          aria-current={focused}
        >
          <span className="name">{l.name}</span>
          <span className="muted small">{status(l.id)}</span>
        </button>
        <button
          className="btn"
          onClick={() => { lists.switchTo(l.id); setAddingFor(l.id); }}
          aria-label={`Add items to ${l.name}`}
        >＋</button>
        <button className="icon" onClick={() => { setMenuFor(openMenu ? undefined : l.id); setConfirmDelete(undefined); }} aria-label={`More for ${l.name}`} aria-expanded={openMenu}>⋯</button>
        {openMenu && (
          <div className="list-row-menu" role="group" aria-label={`Actions for ${l.name}`}>
            <button className="pick" onClick={() => { lists.switchTo(l.id); setAddingFor(l.id); setMenuFor(undefined); }}>＋ Add items</button>
            <button className="pick" onClick={() => { setRenaming(l.id); setName(l.name); setMenuFor(undefined); }}>Rename</button>
            <button className="pick" onClick={() => {
              const r = lists.duplicate(l.id);
              setMenuFor(undefined);
              if (r) note(`Duplicated as “${r.name}”.`, r.snapshot);
            }}>Duplicate</button>
            <button className="pick" onClick={() => { lists.reorder(l.id, -1); }} disabled={lists.all[0]?.id === l.id}>Move up</button>
            <button className="pick" onClick={() => { lists.reorder(l.id, 1); }} disabled={lists.all[lists.all.length - 1]?.id === l.id}>Move down</button>
            {(toBuy(l.id) > 0 || done(l.id) > 0) && (
              <>
                {done(l.id) > 0 && (
                  <button className="pick" onClick={() => {
                    const snap = lists.clear(l.id, 'checked');
                    setMenuFor(undefined);
                    note(`Cleared checked items from “${l.name}”.`, snap);
                  }}>Clear checked</button>
                )}
                {toBuy(l.id) > 0 && (
                  <button className="pick" onClick={() => {
                    const snap = lists.clear(l.id, 'toBuy');
                    setMenuFor(undefined);
                    note(`Cleared to-buy items from “${l.name}”.`, snap);
                  }}>Clear to-buy</button>
                )}
              </>
            )}
            {l.id !== MAIN_LIST && (
              <button className="pick danger" onClick={() => { setConfirmDelete(l.id); setMenuFor(undefined); }}>Delete list</button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="lists-manage">
      <p className="muted small lists-manage-lead">
        Make and stock lists here. On Shop, choose which list (and store) you’re shopping.
      </p>

      <ul className="lists lists-manage-list">
        {lists.all.map((l) => row(l))}
      </ul>

      <form className="add-row" onSubmit={(e) => {
        e.preventDefault();
        if (!newName.trim()) return;
        const id = lists.create(newName.trim());
        setNewName('');
        setMenuFor(undefined);
        setAddingFor(id);
      }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New list, e.g. Taco night" aria-label="New list name" />
        <button type="submit" disabled={!newName.trim()}>+ New</button>
      </form>
      {newName.trim() && nameTaken(newName) && (
        <p className="muted small list-warn">You already have a list with that name.</p>
      )}

      {addingFor && (
        <AddItemsSheet
          listName={lists.all.find((l) => l.id === addingFor)?.name ?? 'Shopping list'}
          catalog={catalog}
          onList={onListIds(addingFor)}
          whereText={(p) => whereText(p, layout, catalog)}
          iconOf={(id) => (id ? looks.get(id)?.icon : undefined)}
          onAdd={(names, mode) => {
            const r = quickAddTo(addingFor, names, mode);
            setToast({ ...r, mode });
            return r;
          }}
          buyAgain={buyAgain}
          lastTripNames={lastTripNames}
          onUndo={undo}
          onClose={() => setAddingFor(undefined)}
        />
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
