import { useMemo, useRef, useState, type ReactNode } from 'react';
import { guessCategory } from '../core/guess';
import type { QuickAddResult } from '../App';
import type { Catalog } from '../core/catalog';
import { amountText, parseAmount, withAmount } from '../core/items';
import { splitSpokenItems } from '../core/speech';
import type { Product } from '../core/types';
import { usePersistentState } from '../usePersistentState';
import { Icon } from './Icon';
import { useVoiceMic } from './useVoiceMic';

/** A past purchase chip: product plus an optional frequency cue. */
export type BuyAgainChip = { product: Product; cue?: 'due' | 'often' };

/**
 * Compact add composer: type or speak (commas for several).
 * Default docks as a sheet. `inline` embeds it on the Setup → Lists screen.
 * "Got it" (in the cart) is Shop-only — pass `allowCart={false}` when editing lists.
 */
export function AddItemsSheet({ listName, catalog, onList, listedAnywhere, inCart, hereLabel, whereText, iconOf, onAdd, buyAgain = [], onUndo, onClose, allowCart = true, inline = false, tools }: {
  listName: string;
  catalog: Catalog;
  /** Master-list items already waiting on this target list. */
  onList: Set<string>;
  /** Product ids waiting on any list (for badges). Defaults to `onList`. */
  listedAnywhere?: Set<string>;
  /** Product ids currently checked off (in the cart) on any list. */
  inCart?: Set<string>;
  /** Where you're standing, if anywhere (new things put in the cart go there). */
  hereLabel?: string;
  whereText: (p: Product) => string;
  iconOf: (categoryId?: string) => string | undefined;
  /** Adds names to the list or cart. Returns what happened (for Undo). */
  onAdd: (names: string[], mode: 'list' | 'cart') => QuickAddResult | undefined;
  /** Things bought before, best first — Setup list-making only (not Shop). */
  buyAgain?: BuyAgainChip[];
  onUndo: (snapshot: QuickAddResult['snapshot']) => void;
  onClose?: () => void;
  /** Shop can put items straight in the cart; Setup → Lists cannot. */
  allowCart?: boolean;
  /** Render on the page instead of a bottom sheet. */
  inline?: boolean;
  /** Shop: sort control beside the search row. */
  tools?: ReactNode;
}) {
  const cart = inCart ?? new Set<string>();
  const anywhere = listedAnywhere ?? onList;
  const again = buyAgain.filter((c) => !onList.has(c.product.id)).slice(0, 16);
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

  const [gotItHintSeen, setGotItHintSeen] = usePersistentState('aw.gotItHintSeen', false);

  function add(names: string[], mode: 'list' | 'cart') {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (!clean.length) return;
    const useMode = allowCart ? mode : 'list';
    const r = onAddRef.current(clean, useMode);
    if (r) setLastAdd({ names: clean, mode: useMode, snapshot: r.snapshot });
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
    onClose?.();
  }

  function statusLine(p: Product): string {
    const waiting = onList.has(p.id);
    const elsewhere = anywhere.has(p.id) && !waiting;
    const held = cart.has(p.id);
    if (waiting && held) return 'On your list · also in cart';
    if (waiting) return 'On your list';
    if (elsewhere && held) return 'On another list · in cart';
    if (elsewhere) return 'On another list';
    if (held) return 'In cart';
    return whereText(p);
  }

  const row = (p: Product) => {
    const waiting = onList.has(p.id);
    const onSomeList = anywhere.has(p.id);
    const held = cart.has(p.id);
    return (
      <li key={p.id} className={`suggestion${onSomeList ? ' on-list' : ''}${held ? ' in-cart' : ''}`}>
        <span className="add-icon-cat" aria-hidden="true">{iconOf(p.categoryId) ?? '·'}</span>
        <div className="s-text">
          <span>
            <span className="item-name">{p.name}</span>
            {(amount.qty || amount.note) ? <span className="muted small"> · {amountText(amount)}</span> : null}
            {onSomeList && <span className="status-pill on-list" aria-hidden="true"><Icon name="list-checks" />List</span>}
            {held && <span className="status-pill in-cart" aria-hidden="true"><Icon name="shopping-cart" />Cart</span>}
          </span>
          <span className="muted small">{statusLine(p)}</span>
        </div>
        {(!waiting || amount.qty || amount.note) && (
          <button type="button" className="s-btn" aria-label={waiting ? 'Update on list' : 'Add to list'} onClick={() => addFromBox(withAmount(p.name, amount), 'list')}>
            {waiting ? 'Update' : <><Icon name="plus" />Add</>}
          </button>
        )}
        {allowCart && (
          <button type="button" className="s-btn cart" aria-label="Got it: put in cart" onClick={() => addFromBox(withAmount(p.name, amount), 'cart')}>
            <Icon name="shopping-cart" />Got it
          </button>
        )}
      </li>
    );
  };

  const body = (
    <>
      {!inline && (
        <div className="add-sheet-head">
          <h2>Add to “{listName}”</h2>
          {onClose && <button className="btn primary" onClick={close}>Done</button>}
        </div>
      )}
      <div className="add-compose">
        <form className="add-row" onSubmit={(e) => { e.preventDefault(); addFromBox(typed, 'list'); }}>
          <input
            value={text}
            onChange={(e) => { setText(e.target.value); voice.setError(undefined); }}
            placeholder="Type or speak an item"
            aria-label="Item to add"
            autoComplete="off"
            enterKeyHint="done"
            autoFocus={!inline}
          />
          <button
            type="button"
            className={voice.listening ? 'mic listening' : 'mic'}
            aria-label={voice.listening ? 'Stop listening' : 'Add by voice'}
            aria-pressed={voice.listening}
            onClick={() => voice.toggle()}
          >
            <Icon name={voice.listening ? 'square' : 'mic'} size="1.3rem" filled={voice.listening} />
          </button>
          <button type="submit" className="add-submit" disabled={!typed} aria-label="Add to list">Add</button>
        </form>
      </div>
      {tools && <div className="add-tools add-tools-row" role="group" aria-label="List tools">{tools}</div>}
      {(voice.error || voice.listening || typed || !inline) && (
        <p className="muted small add-sheet-hint">
          {voice.error
            ? voice.error
            : voice.listening
              ? <>Listening… say an item, then pause.</>
              : typed
                ? (allowCart
                  ? <>Pick below, or Enter to add · <b>Got it</b> puts it in your cart{hereLabel ? <> (at {hereLabel})</> : null}.</>
                  : <>Pick below, or Enter to add to “{listName}”.</>)
                : (allowCart
                  ? <><b>Add</b> queues it · <b>Got it</b> means you’re holding it.</>
                  : <>Type or speak to add to “{listName}”. Cart is only on Shop.</>)}
        </p>
      )}

      {typed ? (
        <>
        {allowCart && !gotItHintSeen && (
          <div className="got-it-hint" role="note">
            <Icon name="shopping-cart" />
            <span><b>Got it</b> means it’s in your cart now. We save where you’re standing as its place.</span>
            <button type="button" className="link" onClick={() => setGotItHintSeen(true)}>OK</button>
          </div>
        )}
        <ul className={`suggestions${inline ? ' in-page' : ' in-sheet'}`} aria-label="Suggestions">
          {isNew && (
            <li className="suggestion new">
              <span className="add-icon-cat" aria-hidden="true">{iconOf(guess) ?? '＋'}</span>
              <div className="s-text">
                <span>Add “{typed}”</span>
                <span className="muted small">New item{guess ? ` · ${catalog.categoryById.get(guess)?.name}` : ''}</span>
              </div>
              <button type="button" className="s-btn" aria-label="Add to list" onClick={() => addFromBox(typed, 'list')}><Icon name="plus" />Add</button>
              {allowCart && (
                <button type="button" className="s-btn cart" aria-label="Got it: put in cart" onClick={() => addFromBox(typed, 'cart')}>
                  <Icon name="shopping-cart" />Got it
                </button>
              )}
            </li>
          )}
          {suggestions.map(row)}
        </ul>
        </>
      ) : again.length > 0 ? (
        <section className="buy-again" aria-label="Buy again">
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
    </>
  );

  if (inline) {
    return (
      <div className="add-inline" aria-label={`Add to ${listName}`}>
        {body}
      </div>
    );
  }

  return (
    <div className="sheet-backdrop add-backdrop" onClick={close}>
      <div className="sheet add-sheet" role="dialog" aria-label={`Add to ${listName}`} onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}
