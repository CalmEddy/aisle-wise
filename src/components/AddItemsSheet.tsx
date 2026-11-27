import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { guessCategory } from '../core/guess';
import type { QuickAddResult } from '../App';
import type { Catalog } from '../core/catalog';
import { amountText, parseAmount, withAmount } from '../core/items';
import { ago, buyAgain, type Purchase, type Usual } from '../core/purchases';
import { splitSpokenItems } from '../core/speech';
import type { Product } from '../core/types';
import { usePersistentState } from '../usePersistentState';
import { Icon } from './Icon';
import { useVoiceMic } from './useVoiceMic';

/**
 * Compact add composer: type or speak (commas for several).
 * Default docks as a sheet. `inline` embeds it on the Setup → Lists screen.
 * "Got it" (in the cart) is Shop-only — pass `allowCart={false}` when editing lists.
 */
export function AddItemsSheet({ listName, catalog, onList, listedAnywhere, inCart, purchases, hereLabel, whereText, iconOf, onAdd, onUndo, onClose, allowCart = true, inline = false, tools }: {
  listName: string;
  catalog: Catalog;
  /** Master-list items already waiting on this target list. */
  onList: Set<string>;
  /** Product ids waiting on any list (for badges). Defaults to `onList`. */
  listedAnywhere?: Set<string>;
  /** Product ids currently checked off (in the cart) on any list. */
  inCart?: Set<string>;
  /** Past purchases: shown as the collapsible Buy again section while nothing is typed. */
  purchases?: Purchase[];
  /** Where you're standing, if anywhere (new things put in the cart go there). */
  hereLabel?: string;
  whereText: (p: Product) => string;
  iconOf: (categoryId?: string) => string | undefined;
  /** Adds names to the list or cart. Returns what happened (for Undo). */
  onAdd: (names: string[], mode: 'list' | 'cart') => QuickAddResult | undefined;
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

  const [buyAgainOpen, setBuyAgainOpen] = usePersistentState('aw.buyAgainOpen', false);
  const history = useMemo(() => buyAgain(purchases ?? []), [purchases]);
  const historyCount = history.due.length + history.often.length + history.lastTrip.length;
  /** Different things offered (one thing can be both often bought and on the last trip). */
  const historyDistinct = new Set([...history.due, ...history.often, ...history.lastTrip].map((u) => u.productId ?? u.name.toLowerCase())).size;

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

  const row = (p: Product, extra?: { sub?: string; amt?: { qty?: number; note?: string } }) => {
    const amt = extra?.amt ?? amount;
    const waiting = onList.has(p.id);
    const onSomeList = anywhere.has(p.id);
    const held = cart.has(p.id);
    return (
      <li key={p.id} className={`suggestion${onSomeList ? ' on-list' : ''}${held ? ' in-cart' : ''}`}>
        <span className="add-icon-cat" aria-hidden="true">{iconOf(p.categoryId) ?? '·'}</span>
        <div className="s-text">
          <span>
            <span className="item-name">{p.name}</span>
            {(amt.qty || amt.note) ? <span className="muted small"> · {amountText(amt)}</span> : null}
            {onSomeList && <span className="status-pill on-list" aria-hidden="true"><Icon name="list-checks" />List</span>}
            {held && <span className="status-pill in-cart" aria-hidden="true"><Icon name="shopping-cart" />Cart</span>}
          </span>
          <span className="muted small">{waiting || anywhere.has(p.id) || cart.has(p.id) || !extra?.sub ? statusLine(p) : extra.sub}</span>
        </div>
        {(!waiting || amt.qty || amt.note) && (
          <button type="button" className="s-btn" aria-label={waiting ? 'Update on list' : 'Add to list'} onClick={() => addFromBox(withAmount(p.name, amt), 'list')}>
            {waiting ? 'Update' : <><Icon name="plus" />Add</>}
          </button>
        )}
        {allowCart && (
          <button type="button" className="s-btn cart" aria-label="Got it: put in cart" onClick={() => addFromBox(withAmount(p.name, amt), 'cart')}>
            <Icon name="shopping-cart" />Got it
          </button>
        )}
      </li>
    );
  };

  /** A past purchase as a normal suggestion row (its master-list item if it still has one). */
  const usualRow = (u: Usual, sub: string, section: string) => {
    const p = (u.productId ? catalog.productById.get(u.productId) : undefined) ?? catalog.exact(u.name)
      ?? { id: `name:${u.name.toLowerCase()}`, name: u.name };
    return <Fragment key={`${section}-${p.id}`}>{row(p, { sub, amt: u.qty ? { qty: u.qty } : {} })}</Fragment>;
  };
  const times = (n: number) => (n === 1 ? 'once' : `${n} times`);
  const lastTripWaiting = history.lastTrip.filter((u) => {
    const id = (u.productId ? catalog.productById.get(u.productId) : undefined)?.id ?? catalog.exact(u.name)?.id;
    return !id || (!anywhere.has(id) && !cart.has(id));
  });

  const buyAgainSection = !typed && (
    <details className="buy-again" open={buyAgainOpen} onToggle={(e) => setBuyAgainOpen(e.currentTarget.open)}>
      <summary>
        <Icon name="history" /> Buy again
        {historyCount > 0 && <span className="muted small count-pill">{historyDistinct}</span>}
      </summary>
      <div className="buy-again-scroll">
        {historyCount === 0 ? (
          <p className="muted small">Nothing yet. When you clear your cart after a trip, what you bought shows up here.</p>
        ) : (
          <>
            {history.due.length > 0 && (
              <section aria-label="Due now">
                <h4>Due now</h4>
                <ul className="suggestions buy-list">
                  {history.due.map((u) => usualRow(u, `Bought ${ago(u.last)} · about every ${u.intervalDays} day${u.intervalDays === 1 ? '' : 's'}`, 'due'))}
                </ul>
              </section>
            )}
            {history.often.length > 0 && (
              <section aria-label="Often bought">
                <h4>Often bought</h4>
                <ul className="suggestions buy-list">
                  {history.often.map((u) => usualRow(u, `Bought ${times(u.count)} · last ${ago(u.last)}`, 'often'))}
                </ul>
              </section>
            )}
            {history.lastTrip.length > 0 && (
              <section aria-label="Last trip">
                <h4>
                  Last trip · {history.lastTripAt ? ago(history.lastTripAt) : ''}{history.lastTripStore ? ` · ${history.lastTripStore}` : ''}
                  {lastTripWaiting.length > 0 && (
                    <button type="button" className="link" onClick={() => add(lastTripWaiting.map((u) => withAmount(u.name, { qty: u.qty })), 'list')}>
                      Add all ({lastTripWaiting.length})
                    </button>
                  )}
                </h4>
                <ul className="suggestions buy-list">
                  {history.lastTrip.map((u) => usualRow(u, 'Bought on your last trip', 'last'))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </details>
  );

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

      {buyAgainSection}

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
          {suggestions.map((p) => row(p))}
        </ul>
        </>
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
