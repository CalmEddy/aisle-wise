import { useState } from 'react';
import { MAIN_LIST, type ShoppingList } from '../core/types';
import type { ClearMode } from '../core/lists';

/** What the Shop tab can do with the household's lists. */
export interface ListsApi {
  all: ShoppingList[];
  /** The list being shopped. */
  current: string;
  /** Things still to buy on each list. */
  counts: Map<string, number>;
  /** Checked-off count per list (for clear affordances). */
  doneCounts: Map<string, number>;
  switchTo: (id: string) => void;
  /** Creates a list without switching to it. Returns its id. */
  create: (name: string) => string;
  rename: (id: string, name: string) => void;
  /** Deletes a list and its items (not the main list). Returns what Undo restores. */
  remove: (id: string) => import('../App').Snapshot | undefined;
  /** Copies what's still to buy on `sources` onto the current list. */
  combine: (sources: string[]) => { added: number; skipped: number; snapshot: import('../App').Snapshot };
  /** What combining would do, without doing it. */
  preview: (sources: string[]) => { added: number; skipped: number };
  /** Duplicate a list (unchecked items). Returns new id + snapshot for Undo. */
  duplicate: (id: string) => { id: string; name: string; snapshot: import('../App').Snapshot } | undefined;
  /** Clear items on a list without deleting it. */
  clear: (id: string, mode: ClearMode) => import('../App').Snapshot;
  /** Move a list up (-1) or down (+1) in the saved order. */
  reorder: (id: string, dir: -1 | 1) => void;
}

/** The list switcher (in the header): the list being shopped; opens the lists sheet. */
export function ListBar({ name, toBuy, otherPending, onOpen }: {
  name: string;
  /** Still to buy on the active list. */
  toBuy: number;
  /** How many other lists still have something to buy. */
  otherPending: number;
  onOpen: () => void;
}) {
  const extra = otherPending > 0 ? ` · +${otherPending} list${otherPending === 1 ? '' : 's'}` : '';
  return (
    <button
      className="list-bar"
      onClick={onOpen}
      aria-label={`List: ${name}${toBuy ? `, ${toBuy} to buy` : ''}${otherPending ? `, ${otherPending} other list${otherPending === 1 ? '' : 's'} with items` : ''}. Change list`}
    >
      <span aria-hidden="true">📝</span>
      <span className="list-bar-name">{name}</span>
      {toBuy > 0 && <span className="list-bar-count" aria-hidden="true">{toBuy}</span>}
      {otherPending > 0 && <span className="list-bar-others" aria-hidden="true">+{otherPending}</span>}
      <span aria-hidden="true" className="list-bar-more">▾</span>
      <span className="sr-only">{extra}</span>
    </button>
  );
}

/**
 * All lists: switch, rename, delete, start a new one, add onto a list without
 * shopping it, and fill the current trip from others.
 */
export function ListsSheet({ lists, onCombined, onRemoved, onCleared, onDuplicated, onAddItems, onClose }: {
  lists: ListsApi;
  onCombined: (text: string, snapshot: import('../App').Snapshot) => void;
  onRemoved: (text: string, snapshot: import('../App').Snapshot) => void;
  onCleared: (text: string, snapshot: import('../App').Snapshot) => void;
  onDuplicated: (text: string, snapshot: import('../App').Snapshot) => void;
  /** Open the add sheet for a list (may not be the one being shopped). */
  onAddItems: (listId: string) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [menuFor, setMenuFor] = useState<string>();
  const [createdId, setCreatedId] = useState<string>();
  const current = lists.all.find((l) => l.id === lists.current)!;
  const others = lists.all.filter((l) => l.id !== lists.current);
  const preview = lists.preview([...picked]);
  const toBuy = (id: string) => lists.counts.get(id) ?? 0;
  const done = (id: string) => lists.doneCounts.get(id) ?? 0;
  const nameTaken = (n: string, except?: string) =>
    lists.all.some((l) => l.id !== except && l.name.trim().toLowerCase() === n.trim().toLowerCase());

  function status(id: string) {
    const n = toBuy(id);
    if (n > 0) return `${n} to buy`;
    if (done(id) > 0) return 'All in the cart';
    return 'Empty';
  }

  const row = (l: ShoppingList, opts?: { shoppingNow?: boolean }) => {
    const isCurrent = l.id === lists.current;
    const openMenu = menuFor === l.id;
    const deleting = confirmDelete === l.id;
    if (renaming === l.id) {
      return (
        <li key={l.id} className={isCurrent ? 'current' : ''}>
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
              if (snap) onRemoved(`Deleted “${l.name}”.`, snap);
            }}>Delete</button>
          </div>
        </li>
      );
    }
    return (
      <li key={l.id} className={isCurrent ? 'current' : ''}>
        <button
          className="list-pick"
          onClick={() => { lists.switchTo(l.id); onClose(); }}
          aria-current={isCurrent}
        >
          <span className="radio" aria-hidden="true">{isCurrent ? '●' : '○'}</span>
          <span className="name">{l.name}</span>
          <span className="muted small">{opts?.shoppingNow ? 'Shopping now' : status(l.id)}</span>
        </button>
        <button className="icon" onClick={() => { setMenuFor(openMenu ? undefined : l.id); setConfirmDelete(undefined); }} aria-label={`More for ${l.name}`} aria-expanded={openMenu}>⋯</button>
        {openMenu && (
          <div className="list-row-menu" role="group" aria-label={`Actions for ${l.name}`}>
            <button className="pick" onClick={() => { onAddItems(l.id); }}>＋ Add items</button>
            {!isCurrent && <button className="pick" onClick={() => { lists.switchTo(l.id); onClose(); }}>Shop this list</button>}
            <button className="pick" onClick={() => { setRenaming(l.id); setName(l.name); setMenuFor(undefined); }}>Rename</button>
            <button className="pick" onClick={() => {
              const r = lists.duplicate(l.id);
              setMenuFor(undefined);
              if (r) onDuplicated(`Duplicated as “${r.name}”.`, r.snapshot);
            }}>Duplicate</button>
            <button className="pick" onClick={() => { lists.reorder(l.id, -1); }} disabled={lists.all[0]?.id === l.id}>Move up</button>
            <button className="pick" onClick={() => { lists.reorder(l.id, 1); }} disabled={lists.all[lists.all.length - 1]?.id === l.id}>Move down</button>
            {(toBuy(l.id) > 0 || done(l.id) > 0) && (
              <>
                {done(l.id) > 0 && (
                  <button className="pick" onClick={() => {
                    const snap = lists.clear(l.id, 'checked');
                    setMenuFor(undefined);
                    onCleared(`Cleared checked items from “${l.name}”.`, snap);
                  }}>Clear checked</button>
                )}
                {toBuy(l.id) > 0 && (
                  <button className="pick" onClick={() => {
                    const snap = lists.clear(l.id, 'toBuy');
                    setMenuFor(undefined);
                    onCleared(`Cleared to-buy items from “${l.name}”.`, snap);
                  }}>Clear to-buy</button>
                )}
              </>
            )}
            {l.id !== MAIN_LIST && (
              <button className="pick danger" onClick={() => { setConfirmDelete(l.id); setMenuFor(undefined); }}>Delete list</button>
            )}
          </div>
        )}
        {createdId === l.id && (
          <div className="list-created" role="status">
            <span className="muted small">List created.</span>
            <button className="btn" onClick={() => onAddItems(l.id)}>＋ Add items</button>
            <button className="btn primary" onClick={() => { lists.switchTo(l.id); onClose(); }}>Shop this list</button>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet lists-sheet" role="dialog" aria-label="Your lists" onClick={(e) => e.stopPropagation()}>
        <h2>Your lists</h2>

        <section className="lists-section">
          <h3>Shopping now</h3>
          <ul className="lists">{row(current, { shoppingNow: true })}</ul>
        </section>

        {others.length > 0 && (
          <section className="lists-section">
            <h3>Other lists</h3>
            <ul className="lists">{others.map((l) => row(l))}</ul>
          </section>
        )}

        <form className="add-row" onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          const id = lists.create(newName.trim());
          setCreatedId(id);
          setNewName('');
          setMenuFor(undefined);
        }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New list, e.g. Taco night" aria-label="New list name" />
          <button type="submit" disabled={!newName.trim()}>+ New</button>
        </form>
        {newName.trim() && nameTaken(newName) && (
          <p className="muted small list-warn">You already have a list with that name.</p>
        )}

        {others.length > 0 && (
          <section className="combine">
            <h3>Add from other lists</h3>
            <p className="muted small">
              Copy what’s still to buy onto “{current.name}”. The other lists stay as they are — handy for staples or a recipe.
            </p>
            {others.map((l) => (
              <label key={l.id} className="check">
                <input type="checkbox" checked={picked.has(l.id)} onChange={(e) => setPicked((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(l.id);
                  else next.delete(l.id);
                  return next;
                })} />
                <span>{l.name} <span className="muted small">· {toBuy(l.id)} to buy</span></span>
              </label>
            ))}
            <div className="sheet-actions">
              <span className="muted small">
                {picked.size ? `${preview.added} to add${preview.skipped ? `, ${preview.skipped} already on it` : ''}` : ''}
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn primary" disabled={!preview.added} onClick={() => {
                const names = others.filter((l) => picked.has(l.id)).map((l) => `“${l.name}”`).join(' and ');
                const r = lists.combine([...picked]);
                onCombined(`Added ${r.added} item${r.added === 1 ? '' : 's'} from ${names}${r.skipped ? ` (${r.skipped} already on it)` : ''}.`, r.snapshot);
                onClose();
              }}>
                Add {preview.added || ''} item{preview.added === 1 ? '' : 's'}
              </button>
            </div>
          </section>
        )}
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
