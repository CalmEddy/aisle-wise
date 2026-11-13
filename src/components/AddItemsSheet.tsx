import { useMemo, useRef, useState } from 'react';
import { guessCategory } from '../core/guess';
import type { QuickAddResult } from '../App';
import type { Catalog } from '../core/catalog';
import { amountText, parseAmount, withAmount } from '../core/items';
import { splitSpokenItems } from '../core/speech';
import type { Product } from '../core/types';
import { useVoiceMic } from './useVoiceMic';

/** A past purchase chip: product plus an optional frequency cue. */
export type BuyAgainChip = { product: Product; cue?: 'due' | 'often' };

/**
 * Compact add composer: type or speak (commas for several).
 * Docks at the bottom so the shopping list stays visible and updates as you add.
 * Stays open for more; Undo last undoes the most recent add.
 * Mic fills the box for review; matching catalog rows (and “On your list”)
 * appear underneath so you can pick or tap + List.
 */
export function AddItemsSheet({ listName, catalog, onList, hereLabel, whereText, iconOf, onAdd, buyAgain = [], lastTripNames = [], onUndo, onClose }: {
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
  buyAgain?: BuyAgainChip[];
  /** Names from the last completed trip at this store (one-tap restock). */
  lastTripNames?: string[];
  onUndo: (snapshot: QuickAddResult['snapshot']) => void;
  onClose: () => void;
}) {
  const again = buyAgain.filter((c) => !onList.has(c.product.id)).slice(0, 16);
  const tripRestock = lastTripNames.filter((n) => {
    const p = catalog.exact(n) ?? catalog.match(n);
    return !p || !onList.has(p.id);
  });
  const [text, setText] = useState('');
  const [lastAdd, setLastAdd] = useState<{ names: string[]; mode: 'list' | 'cart'; snapshot: QuickAddResult['snapshot'] }>();
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;

  const last = text.split(',').pop() ?? '';
  const typed = last.trim();
  // "2 milk", "milk x2", "flour (the big bag)": search for the name, keep the amount and note.
  const amount = parseAmount(typed);
  const query = amount.name;
  const suggestions = useMemo(() => catalog.suggest(query, 12), [catalog, query]);
  const isNew = query.length > 0 && !catalog.exact(query);
  const guess = isNew ? guessCategory(query, catalog)?.categoryId : undefined;

  function add(names: string[], mode: 'list' | 'cart') {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (!clean.length) return;
    const r = onAddRef.current(clean, mode);
    if (r) setLastAdd({ names: clean, mode, snapshot: r.snapshot });
  }

  /** Adds `name` plus anything typed before the last comma, then clears the box. */
  function addFromBox(name: string, mode: 'list' | 'cart') {
    add([...text.split(',').slice(0, -1), name], mode);
    setText('');
  }

  const voice = useVoiceMic({
    stopOnFinal: true,
    onFinal: (transcript) => {
      const names = splitSpokenItems(transcript);
      if (!names.length) return;
      setText(names.join(', '));
    },
    onInterim: (transcript) => {
      setText(transcript.trim());
    },
  });

  function close() {
    voice.stop();
    onClose();
  }

  const row = (p: Product) => {
    const waiting = onList.has(p.id);
    return (
      <li key={p.id} className="suggestion">
        <span className="add-icon-cat" aria-hidden="true">{iconOf(p.categoryId) ?? '·'}</span>
        <div className="s-text">
          <span>{p.name}{(amount.qty || amount.note) ? <span className="muted small"> · {amountText(amount)}</span> : null}</span>
          <span className="muted small">{waiting ? 'On your list' : whereText(p)}</span>
        </div>
        {(!waiting || amount.qty || amount.note) && (
          <button type="button" className="s-btn" onClick={() => addFromBox(withAmount(p.name, amount), 'list')}>
            {waiting ? 'Update' : '+ List'}
          </button>
        )}
        <button type="button" className="s-btn cart" onClick={() => addFromBox(withAmount(p.name, amount), 'cart')}>🛒</button>
      </li>
    );
  };

  return (
    <div className="sheet-backdrop add-backdrop" onClick={close}>
      <div className="sheet add-sheet" role="dialog" aria-label={`Add to ${listName}`} onClick={(e) => e.stopPropagation()}>
        <div className="add-sheet-head">
          <h2>Add to “{listName}”</h2>
          <button className="btn primary" onClick={close}>Done</button>
        </div>
        <form className="add-row" onSubmit={(e) => { e.preventDefault(); addFromBox(typed, 'list'); }}>
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); voice.setError(undefined); }}
            placeholder="Type or speak an item"
            aria-label="Item to add"
            autoComplete="off"
            enterKeyHint="done"
            autoFocus
          />
          <button
            type="button"
            className={voice.listening ? 'mic listening' : 'mic'}
            aria-label={voice.listening ? 'Stop listening' : 'Add by voice'}
            aria-pressed={voice.listening}
            onClick={() => voice.toggle()}
          >
            {voice.listening ? '⏹' : '🎤'}
          </button>
          <button type="submit" disabled={!typed}>+ List</button>
        </form>
        <p className="muted small add-sheet-hint">
          {voice.error
            ? voice.error
            : voice.listening
              ? <>Listening… say an item, then pause.</>
              : typed
                ? <>Pick below, or Enter · 🛒 puts it in your cart{hereLabel ? <> (at {hereLabel})</> : null}.</>
                : <>＋ List queues it · 🛒 means you’re holding it.</>}
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
        ) : (tripRestock.length > 0 || again.length > 0) ? (
          <section className="buy-again" aria-label="Buy again">
            {tripRestock.length > 0 && (
              <button type="button" className="btn wide last-trip" onClick={() => add(tripRestock, 'list')}>
                Last trip · add all ({tripRestock.length})
              </button>
            )}
            {again.length > 0 && (
              <>
                <h3 className="muted small">Buy again · tap to add</h3>
                <div className="chips again-scroll">
                  {again.map(({ product: p, cue }) => (
                    <button key={p.id} className={`chip again${cue ? ` cue-${cue}` : ''}`} onClick={() => add([p.name], 'list')}>
                      <span aria-hidden="true">{iconOf(p.categoryId) ?? '＋'}</span> {p.name}
                      {cue === 'due' && <span className="again-cue">due</span>}
                      {cue === 'often' && <span className="again-cue">often</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
        ) : null}

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
