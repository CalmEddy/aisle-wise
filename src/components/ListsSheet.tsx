import { useState } from 'react';
import { MAIN_LIST, type ShoppingList } from '../core/types';

/** What the Shop tab can do with the household's lists. */
export interface ListsApi {
  all: ShoppingList[];
  /** The list being shopped. */
  current: string;
  /** Things still to buy on each list. */
  counts: Map<string, number>;
  switchTo: (id: string) => void;
  create: (name: string) => void;
  rename: (id: string, name: string) => void;
  /** Deletes a list and its items (not the main list). */
  remove: (id: string) => void;
  /** Copies what's still to buy on `sources` onto the current list. */
  combine: (sources: string[]) => { added: number; skipped: number; snapshot: import('../App').Snapshot };
  /** What combining would do, without doing it. */
  preview: (sources: string[]) => { added: number; skipped: number };
}

/** The list switcher (in the header): the list being shopped; opens the lists sheet. */
export function ListBar({ name, count, onOpen }: { name: string; count: number; onOpen: () => void }) {
  return (
    <button className="list-bar" onClick={onOpen} aria-label={`List: ${name}${count > 1 ? ` (${count} lists)` : ''}. Change list`}>
      <span aria-hidden="true">📝</span>
      <span className="list-bar-name">{name}</span>
      <span aria-hidden="true" className="list-bar-more">▾</span>
    </button>
  );
}

/**
 * All lists: switch, rename, delete, start a new one, and fill the current
 * list from others (their lists stay as they are, ready for next time).
 */
export function ListsSheet({ lists, onCombined, onClose }: {
  lists: ListsApi;
  onCombined: (text: string, snapshot: import('../App').Snapshot) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const current = lists.all.find((l) => l.id === lists.current)!;
  const others = lists.all.filter((l) => l.id !== lists.current);
  const preview = lists.preview([...picked]);
  const toBuy = (id: string) => lists.counts.get(id) ?? 0;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet lists-sheet" role="dialog" aria-label="Your lists" onClick={(e) => e.stopPropagation()}>
        <h2>Your lists</h2>
        <ul className="lists">
          {lists.all.map((l) => (
            <li key={l.id} className={l.id === lists.current ? 'current' : ''}>
              {renaming === l.id ? (
                <form className="rename-list" onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) lists.rename(l.id, name.trim());
                  setRenaming(undefined);
                }}>
                  <input value={name} onChange={(e) => setName(e.target.value)} aria-label="List name" autoFocus />
                  <button className="btn primary">Save</button>
                </form>
              ) : (
                <>
                  <button className="list-pick" onClick={() => { lists.switchTo(l.id); onClose(); }} aria-current={l.id === lists.current}>
                    <span className="radio" aria-hidden="true">{l.id === lists.current ? '●' : '○'}</span>
                    <span className="name">{l.name}</span>
                    <span className="muted small">{toBuy(l.id)} to buy</span>
                  </button>
                  <button className="icon" onClick={() => { setRenaming(l.id); setName(l.name); }} aria-label={`Rename ${l.name}`}>✎</button>
                  {l.id !== MAIN_LIST && (
                    <button className="icon" aria-label={`Delete ${l.name}`} onClick={() => {
                      if (confirm(`Delete the list “${l.name}” and its ${toBuy(l.id)} item${toBuy(l.id) === 1 ? '' : 's'}?`)) lists.remove(l.id);
                    }}>×</button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
        <form className="add-row" onSubmit={(e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          lists.create(newName.trim());
          setNewName('');
          onClose();
        }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New list, e.g. Taco night" aria-label="New list name" />
          <button type="submit" disabled={!newName.trim()}>+ New</button>
        </form>

        {others.length > 0 && (
          <section className="combine">
            <h3>Add to “{current.name}” from other lists</h3>
            <p className="muted small">Copies what’s still to buy. The other lists stay as they are, ready for next time.</p>
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
