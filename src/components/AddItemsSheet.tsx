import { useMemo, useState } from 'react';
import type { QuickAddResult } from '../App';
import type { Catalog } from '../core/catalog';
import { byName } from './CategoryPicker';
import type { Product } from '../core/types';

/**
 * The add window: search (commas for several), or browse by category, and
 * put things on the list or straight in the cart. Stays open for more; what
 * was added shows at the bottom with Undo.
 */
export function AddItemsSheet({ listName, catalog, onList, hereLabel, whereText, iconOf, onAdd, onUndo, onClose }: {
  listName: string;
  catalog: Catalog;
  /** Master-list items already waiting on the list. */
  onList: Set<string>;
  /** Where you're standing, if anywhere (new things put in the cart go there). */
  hereLabel?: string;
  whereText: (p: Product) => string;
  iconOf: (categoryId?: string) => string | undefined;
  /** Adds names to the list or cart. Returns what happened (for Undo). */
  onAdd: (names: string[], mode: 'list' | 'cart') => QuickAddResult | undefined;
  onUndo: (snapshot: QuickAddResult['snapshot']) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [browse, setBrowse] = useState<string>();
  const [added, setAdded] = useState<{ id: number; names: string[]; mode: 'list' | 'cart'; snapshot: QuickAddResult['snapshot'] }[]>([]);
  const last = text.split(',').pop() ?? '';
  const typed = last.trim();
  const suggestions = useMemo(() => catalog.suggest(typed, 12), [catalog, typed]);
  const isNew = typed.length > 0 && !catalog.exact(typed);
  const guess = isNew ? catalog.match(typed)?.categoryId : undefined;
  const categories = useMemo(
    () => byName(catalog.categories).filter((c) => catalog.products.some((p) => p.categoryId === c.id)),
    [catalog],
  );
  const browsing = browse !== undefined
    ? [...catalog.products].filter((p) => (p.categoryId ?? '') === browse).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  function add(names: string[], mode: 'list' | 'cart') {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (!clean.length) return;
    const r = onAdd(clean, mode);
    if (r) setAdded((prev) => [{ id: Date.now(), names: clean, mode, snapshot: r.snapshot }, ...prev]);
  }

  /** Adds `name` plus anything typed before the last comma, then clears the box. */
  function addFromBox(name: string, mode: 'list' | 'cart') {
    add([...text.split(',').slice(0, -1), name], mode);
    setText('');
  }

  const row = (p: Product) => {
    const waiting = onList.has(p.id);
    return (
      <li key={p.id} className="suggestion">
        <span className="add-icon-cat" aria-hidden="true">{iconOf(p.categoryId) ?? '·'}</span>
        <div className="s-text">
          <span>{p.name}</span>
          <span className="muted small">{waiting ? 'On your list' : whereText(p)}</span>
        </div>
        {!waiting && <button type="button" className="s-btn" onClick={() => (browse !== undefined ? add([p.name], 'list') : addFromBox(p.name, 'list'))}>+ List</button>}
        <button type="button" className="s-btn cart" onClick={() => (browse !== undefined ? add([p.name], 'cart') : addFromBox(p.name, 'cart'))}>🛒</button>
      </li>
    );
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet add-sheet" role="dialog" aria-label={`Add to ${listName}`} onClick={(e) => e.stopPropagation()}>
        <div className="add-sheet-head">
          <h2>Add to “{listName}”</h2>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
        <form className="add-row" onSubmit={(e) => { e.preventDefault(); addFromBox(typed, 'list'); }}>
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); if (e.target.value) setBrowse(undefined); }}
            placeholder="Type an item, or several with commas"
            aria-label="Item to add"
            autoComplete="off"
            enterKeyHint="done"
            autoFocus
          />
          <button type="submit" disabled={!typed}>+ List</button>
        </form>
        <p className="muted small add-sheet-hint">
          {typed ? <>Enter adds to the list · 🛒 puts it straight in your cart{hereLabel ? <> (at {hereLabel})</> : null}.</> : <>Or browse by category:</>}
        </p>

        {typed ? (
          <ul className="suggestions in-sheet" aria-label="Suggestions">
            {isNew && (
              <li className="suggestion new">
                <span className="add-icon-cat" aria-hidden="true">{iconOf(guess) ?? '＋'}</span>
                <div className="s-text">
                  <span>Add “{typed}”</span>
                  <span className="muted small">New item{guess ? ` · ${catalog.categoryById.get(guess)?.name}` : ''}</span>
                </div>
                <button type="button" className="s-btn" onClick={() => addFromBox(typed, 'list')}>+ List</button>
                <button type="button" className="s-btn cart" onClick={() => addFromBox(typed, 'cart')}>🛒</button>
              </li>
            )}
            {suggestions.map(row)}
          </ul>
        ) : (
          <>
            <div className={`chips add-cats${browse !== undefined ? ' one-line' : ''}`} role="group" aria-label="Categories">
              {categories.map((c) => (
                <button key={c.id} className={browse === c.id ? 'chip active' : 'chip'} aria-pressed={browse === c.id}
                  onClick={() => setBrowse(browse === c.id ? undefined : c.id)}>
                  <span aria-hidden="true">{iconOf(c.id)}</span> {c.name}
                </button>
              ))}
            </div>
            {browse !== undefined && <ul className="suggestions in-sheet" aria-label="Items in this category">{browsing.map(row)}</ul>}
          </>
        )}

        {added.length > 0 && (
          <div className="added-strip" aria-label="Added just now">
            <span className="muted small">Added:</span>
            {added.map((a) => (
              <span key={a.id} className="added-chip">
                {a.mode === 'cart' ? '🛒 ' : ''}{a.names.join(', ')}
                <button className="link" onClick={() => {
                  onUndo(a.snapshot);
                  // Later adds were made on top of this one; undoing restores what was there before it.
                  setAdded((prev) => prev.filter((x) => x.id < a.id));
                }} aria-label={`Undo adding ${a.names.join(', ')}`}>Undo</button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
