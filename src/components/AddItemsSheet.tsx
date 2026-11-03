import { useMemo, useState } from 'react';
import { inWalkingOrder, topOf } from '../core/taxonomy';
import { guessCategory } from '../core/guess';
import type { QuickAddResult } from '../App';
import type { Catalog } from '../core/catalog';
import { amountText, parseAmount, withAmount } from '../core/items';
import type { Product } from '../core/types';

/**
 * Compact add composer: search (commas for several), or browse by category.
 * Docks at the bottom so the shopping list stays visible and updates as you add.
 * Stays open for more; Undo last undoes the most recent add.
 */
export function AddItemsSheet({ listName, catalog, onList, hereLabel, whereText, iconOf, onAdd, buyAgain = [], onUndo, onClose }: {
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
  /** Things bought before, best first (shown before anything is typed). */
  buyAgain?: Product[];
  onUndo: (snapshot: QuickAddResult['snapshot']) => void;
  onClose: () => void;
}) {
  const again = buyAgain.filter((p) => !onList.has(p.id)).slice(0, 16);
  const [text, setText] = useState('');
  const [browse, setBrowse] = useState<string>();
  const [lastAdd, setLastAdd] = useState<{ names: string[]; mode: 'list' | 'cart'; snapshot: QuickAddResult['snapshot'] }>();
  const last = text.split(',').pop() ?? '';
  const typed = last.trim();
  // "2 milk", "milk x2", "flour (the big bag)": search for the name, keep the amount and note.
  const amount = parseAmount(typed);
  const query = amount.name;
  const suggestions = useMemo(() => catalog.suggest(query, 12), [catalog, query]);
  const isNew = query.length > 0 && !catalog.exact(query);
  const guess = isNew ? guessCategory(query, catalog)?.categoryId : undefined;
  // Browsing: the categories (not subcategories) that have items, in walking order; the most common items first.
  const categories = useMemo(
    () => inWalkingOrder(catalog.categories.filter((c) => !c.parent && catalog.products.some((p) => p.categoryId && topOf(p.categoryId) === c.id))),
    [catalog],
  );
  const browsing = browse !== undefined
    ? [...catalog.products].filter((p) => p.categoryId && topOf(p.categoryId) === browse)
      .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.name.localeCompare(b.name))
    : [];

  function add(names: string[], mode: 'list' | 'cart') {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (!clean.length) return;
    const r = onAdd(clean, mode);
    if (r) setLastAdd({ names: clean, mode, snapshot: r.snapshot });
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
          <span>{p.name}{browse === undefined && (amount.qty || amount.note) ? <span className="muted small"> · {amountText(amount)}</span> : null}</span>
          <span className="muted small">{waiting ? 'On your list' : whereText(p)}</span>
        </div>
        {(!waiting || amount.qty || amount.note) && (
          <button type="button" className="s-btn" onClick={() => (browse !== undefined ? add([p.name], 'list') : addFromBox(withAmount(p.name, amount), 'list'))}>
            {waiting ? 'Update' : '+ List'}
          </button>
        )}
        <button type="button" className="s-btn cart" onClick={() => (browse !== undefined ? add([p.name], 'cart') : addFromBox(withAmount(p.name, amount), 'cart'))}>🛒</button>
      </li>
    );
  };

  return (
    <div className="sheet-backdrop add-backdrop" onClick={onClose}>
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
          {typed
            ? <>Enter adds to the list · 🛒 puts it in your cart{hereLabel ? <> (at {hereLabel})</> : null}.</>
            : again.length > 0 && browse === undefined
              ? null
              : <>Browse by category, or type above. The list updates behind this panel.</>}
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
            {again.length > 0 && browse === undefined && (
              <section className="buy-again" aria-label="Buy again">
                <h3 className="muted small">Buy again · tap to add</h3>
                <div className="chips again-scroll">
                  {again.map((p) => (
                    <button key={p.id} className="chip again" onClick={() => add([p.name], 'list')}>
                      <span aria-hidden="true">{iconOf(p.categoryId) ?? '＋'}</span> {p.name}
                    </button>
                  ))}
                </div>
                <h3 className="muted small">Browse by category</h3>
              </section>
            )}
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

        {lastAdd && (
          <div className="added-strip" aria-label="Added just now">
            <span className="muted small">
              Added {lastAdd.mode === 'cart' ? '🛒 ' : ''}{lastAdd.names.join(', ')}
            </span>
            <button className="link" onClick={() => {
              onUndo(lastAdd.snapshot);
              setLastAdd(undefined);
            }} aria-label={`Undo adding ${lastAdd.names.join(', ')}`}>Undo</button>
          </div>
        )}
      </div>
    </div>
  );
}
