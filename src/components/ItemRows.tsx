import { Fragment, useEffect, useRef, useState } from 'react';
import type { ItemUnit, ListItem, Stop } from '../core/types';
import { formatPrice, parsePrice, qtyUnitPriceText } from '../core/items';
import { SwipeRow } from './SwipeRow';
import { capitalize } from './whereText';

export interface Drag {
  item: ListItem;
  x: number;
  y: number;
  /** Spot key under the finger, if any. */
  over?: string;
}


export function overKey(drag: Drag | null, key: string) {
  return drag?.over === key ? ' drop-over' : '';
}

/**
 * One numbered stop: a place, with its items grouped by spot in walking
 * order. Each spot is a drop target, so dropping on an item puts the
 * dragged item right next to it.
 */
export function VisitCard({ visit, next, drag, rows, onGoTo, colorOf, sectionName, likely }: {
  visit: { number: number; stops: Stop[] };
  next?: boolean;
  /** Placed here only by the store's default map (a guess until said). */
  likely?: boolean;
  drag: Drag | null;
  /** The item rows for a stop; `sub` gives each a second line (used when a stop is shown as one line). */
  rows: (stop: Stop, sub?: (item: ListItem) => string | undefined) => React.ReactNode;
  /** Tapping the place or a section moves the "you are here" marker there. */
  onGoTo: (stop: Stop) => void;
  /** Section tint (category colour), or undefined for none. */
  colorOf?: (stop: Stop) => string | undefined;
  /** Name for a section with no detail of its own (its category). */
  sectionName?: (stop: Stop) => string | undefined;
}) {
  const first = visit.stops[0];
  const count = visit.stops.reduce((n, st) => n + st.items.length, 0);
  const showDetails = visit.stops.length > 1 || !!first.detail;
  const over = visit.stops.some((st) => drag?.over === st.key);
  // The current stop stays green. Elsewhere, tint by category: the whole card
  // when it's all one colour, otherwise each section on its own.
  const colors = next ? [] : visit.stops.map((st) => colorOf?.(st));
  const oneColor = colors.length > 0 && colors.every((c) => c && c === colors[0]) ? colors[0] : undefined;
  const tint = (c: string | undefined) => (c ? ({ '--cat': c } as React.CSSProperties) : undefined);
  const where = `${first.placeLabel || 'Unnamed'}${likely ? ' · likely' : ''}${first.detail ? ` · ${first.detail}` : sectionName?.(first) && visit.stops.length > 1 ? ` · ${sectionName(first)}` : ''}`;
  // One item at one spot: a single line, with where it is under the name.
  if (count === 1) {
    return (
      <section
        className={`visit single${next ? ' next-card' : ''}${over ? ' drop-over' : ''}${oneColor ? ' tinted' : ''}`}
        style={tint(oneColor)}
        data-drop={first.key}
      >
        <button className="goto single-num" onClick={() => onGoTo(first)} aria-label={`I'm at ${first.label}`}>
          {next ? <span className="badge">Next</span> : <span className="num">{visit.number}</span>}
        </button>
        <div className="single-body">{rows(first, () => where)}</div>
      </section>
    );
  }
  return (
    <section
      className={`visit${next ? ' next-card' : ''}${over ? ' drop-over' : ''}${oneColor ? ' tinted' : ''}`}
      style={tint(oneColor)}
      data-drop={first.key}
    >
      <div className="stop-head">
        {next ? <span className="badge">Next</span> : <span className="num">{visit.number}</span>}
        <button className="goto" onClick={() => onGoTo(first)} aria-label={`I'm at ${first.placeLabel || 'this place'}`}>
          {next ? <h2>{first.placeLabel || 'Unnamed'}</h2> : <h3>{first.placeLabel || 'Unnamed'}</h3>}
          {likely && <span className="muted small likely"> likely</span>}
        </button>
        {count > 1 && <span className="muted small count-pill">{count} items</span>}
      </div>
      {visit.stops.map((st, i) => (
        <div
          key={st.key}
          className={`spot${overKey(drag, st.key)}${!oneColor && colors[i] ? ' tinted' : ''}`}
          style={oneColor ? undefined : tint(colors[i])}
          data-drop={st.key}
        >
          {showDetails && (
            <button className="spot-detail goto" onClick={() => onGoTo(st)} aria-label={`I'm at ${st.label}`}>
              {capitalize(st.detail ?? sectionName?.(st) ?? 'anywhere here')}
            </button>
          )}
          {rows(st)}
        </div>
      ))}
    </section>
  );
}

export type DragHandlers = (item: ListItem) => React.HTMLAttributes<HTMLSpanElement>;

export type ItemPatch = Partial<Pick<ListItem, 'qty' | 'note' | 'name' | 'unit' | 'price'>>;

function InlineName({ item, onRename }: { item: ListItem; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(item.name); }, [item.name]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  const commit = () => {
    const clean = text.trim().replace(/\s+/g, ' ');
    setEditing(false);
    if (clean && clean !== item.name) onRename(clean);
    else setText(item.name);
  };
  if (editing) {
    return (
      <input
        ref={ref}
        className="inline-name"
        value={text}
        aria-label={`Rename ${item.name}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setText(item.name); setEditing(false); }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <button
      type="button"
      className="name-edit"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
      aria-label={`Rename ${item.name}`}
    >
      {item.name}
    </button>
  );
}

/** −/＋ quantity control shared by Shop rows and the Items catalog. */
export function QtyStepper({ item, onPatch }: { item: ListItem; onPatch: (patch: ItemPatch) => void }) {
  const qty = item.qty ?? 1;
  return (
    <div className="qty-stepper inline" role="group" aria-label={`How many ${item.name}`}>
      <button
        type="button"
        className="icon"
        disabled={qty <= 1 && !item.unit && item.price === undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPatch({ qty: qty - 1 > 1 ? qty - 1 : undefined });
        }}
        aria-label={`One fewer ${item.name}`}
      >−</button>
      <span className="qty-stepper-value" aria-live="polite">{qty}</span>
      <button
        type="button"
        className="icon"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPatch({ qty: qty + 1 }); }}
        aria-label={`One more ${item.name}`}
      >＋</button>
    </div>
  );
}

/**
 * Compact price control: shows the line total (unit × qty), edits the unit price.
 * Used on Shop and Items when the prices display toggle is on.
 */
export function InlinePrice({ item, onPatch }: { item: ListItem; onPatch: (patch: ItemPatch) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.price !== undefined ? String(item.price) : '');
  const ref = useRef<HTMLInputElement>(null);
  const qty = item.qty && item.qty > 1 ? item.qty : 1;
  const line = item.price !== undefined ? item.price * qty : undefined;
  useEffect(() => {
    if (!editing) setText(item.price !== undefined ? String(item.price) : '');
  }, [item.price, editing]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  const commit = () => {
    const next = parsePrice(text);
    setEditing(false);
    if (next !== item.price) onPatch({ price: next });
    setText(next !== undefined ? String(next) : '');
  };
  if (editing) {
    return (
      <input
        ref={ref}
        className="inline-price-input"
        inputMode="decimal"
        value={text}
        aria-label={`Unit price for ${item.name}`}
        placeholder="$0.00"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setText(item.price !== undefined ? String(item.price) : ''); setEditing(false); }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <button
      type="button"
      className={`inline-price${line === undefined ? ' empty' : ''}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}
      aria-label={line !== undefined ? `Line total for ${item.name}: ${formatPrice(line)}. Tap to edit unit price.` : `Add unit price for ${item.name}`}
      title={item.price !== undefined && qty > 1 ? `${qty} × ${formatPrice(item.price)}` : 'Set price'}
    >
      {line !== undefined ? formatPrice(line) : '$'}
    </button>
  );
}

export function ItemRows({ items, onToggle, onRemove, onMenu, drag, dragging, iconOf, pinned, onPin, subOf, badgesOf, tintOf, dropOf, firstIsNearest, big, simple, onNotHere, onClearWhere, clearable, headingOf, onPatch, showQty = true, showPrice = false, showLocation = true, priceOf }: {
  items: ListItem[];
  onToggle: (i: ListItem) => void;
  onRemove: (i: ListItem) => void;
  onMenu?: (i: ListItem) => void;
  drag?: DragHandlers;
  dragging?: string;
  iconOf?: (i: ListItem) => string | undefined;
  /** Items pinpointed on the map, and the button that toggles it. */
  pinned?: Set<string>;
  onPin?: (i: ListItem) => void;
  /** A second line under the name (where it is). */
  subOf?: (i: ListItem) => string | undefined;
  /** Small source-list badges (multi-list shop trip). */
  badgesOf?: (i: ListItem) => string[] | undefined;
  /** Row tint (category colour). */
  tintOf?: (i: ListItem) => string | undefined;
  /** Drop target key per row. */
  dropOf?: (i: ListItem) => string | undefined;
  firstIsNearest?: boolean;
  big?: boolean;
  /**
   * Shopping rows: checkbox, icon, editable name, qty stepper, ⋯.
   * Swipe right to check off, left for Not here / Remove.
   */
  simple?: boolean;
  onNotHere?: (i: ListItem) => void;
  /** (For testing the map) clears where this item is in this store; shown when it has a place here. */
  onClearWhere?: (i: ListItem) => void;
  clearable?: (i: ListItem) => boolean;
  /** Headings over the rows: a category, and a subcategory under it (shown where they change). */
  headingOf?: (i: ListItem) => { top?: string; sub?: string };
  /** Inline qty / name / unit / price edits (avoids opening the ⋯ menu). */
  onPatch?: (item: ListItem, patch: ItemPatch) => void;
  /** Show the −/＋ quantity stepper (and hide ×N from the meta line while it is). */
  showQty?: boolean;
  /** Show prices (line totals) and the inline price control. */
  showPrice?: boolean;
  /** Show the where-it-is line under the name. */
  showLocation?: boolean;
  /** Remembered / best-elsewhere price cue (shown after the list-line price). */
  priceOf?: (item: ListItem) => string | undefined;
}) {
  const clearBtn = (item: ListItem) => onClearWhere && clearable?.(item) && (
    <button className="icon clear-where" onClick={() => onClearWhere(item)} aria-label={`Clear where ${item.name} is`} title="Clear its location here (testing)">⊘</button>
  );
  const whereOf = (item: ListItem) => (showLocation ? subOf?.(item) : undefined);
  const badges = (item: ListItem) => {
    const names = badgesOf?.(item);
    if (!names?.length) return null;
    return (
      <span className="source-badges">
        {names.map((n) => <span key={n} className="source-badge">{n}</span>)}
      </span>
    );
  };
  const meta = (item: ListItem) => {
    // Stepper owns the count; inline price owns the amount — meta keeps unit (and price when no inline control).
    const line = qtyUnitPriceText(item, { qty: !showQty, price: showPrice && !onPatch });
    const price = priceOf?.(item);
    const note = item.note;
    const where = whereOf(item);
    const badgeRow = badges(item);
    if (!line && !price && !note && !where && !badgeRow) return null;
    return (
      <span className="name-meta">
        {badgeRow}
        {line && <span className="qty">{line}</span>}
        {price && <span className="price-cue muted">{line ? ` · ${price}` : price}</span>}
        {note && <span className="item-note">{note}</span>}
        {where && <span className="sub">{where}</span>}
      </span>
    );
  };
  return (
    <ul className={big ? 'items big' : 'items'}>
      {items.map((item, index) => {
        const h = headingOf?.(item);
        const prev = index > 0 ? headingOf?.(items[index - 1]) : undefined;
        const showTop = h?.top && h.top !== prev?.top;
        const showSub = h?.sub && (showTop || h.sub !== prev?.sub);
        return (
        <Fragment key={item.id}>
        {showTop && <li className="list-cat-head" aria-hidden="true">{h!.top}</li>}
        {showSub && <li className="list-sub-head muted small" aria-hidden="true">{h!.sub}</li>}
        <li
          key={item.id}
          className={['row', item.done && 'checked', dragging === item.id && 'dragging', tintOf?.(item) && 'tinted',
            firstIsNearest && item === items[0] && 'nearest'].filter(Boolean).join(' ')}
          style={tintOf?.(item) ? ({ '--cat': tintOf(item) } as React.CSSProperties) : undefined}
          data-drop={dropOf?.(item)}
        >
          {simple ? (
            <SwipeRow
              onSwipeRight={() => onToggle(item)}
              rightLabel={item.done ? <>↩ Back on the list</> : <>✓ Got it</>}
              leftActions={(close) => (
                <>
                  {onNotHere && !item.done && <button className="swipe-btn sold" onClick={() => { close(); onNotHere(item); }}>🚫 Not here</button>}
                  <button className="swipe-btn delete" onClick={() => { close(); onRemove(item); }}>Remove</button>
                </>
              )}
            >
              <div className="row-inner">
                <label>
                  <input type="checkbox" checked={item.done} onChange={() => onToggle(item)} aria-label={`${item.done ? 'Uncheck' : 'Check off'} ${item.name}`} />
                  {iconOf?.(item) && <span className="item-icon" aria-hidden="true">{iconOf(item)}</span>}
                  <span className="name">
                    {onPatch
                      ? <InlineName item={item} onRename={(name) => onPatch(item, { name })} />
                      : <span className="name-text">{item.name}</span>}
                    {meta(item)}
                  </span>
                </label>
                {onPatch && !item.done && showQty && <QtyStepper item={item} onPatch={(patch) => onPatch(item, patch)} />}
                {onPatch && !item.done && showPrice && <InlinePrice item={item} onPatch={(patch) => onPatch(item, patch)} />}
                {pinned?.has(item.id) && <span className="pinned-dot" title="Shown on the map" aria-label="Shown on the map">📍</span>}
                {clearBtn(item)}
                {onMenu
                  ? <button className="icon" onClick={() => onMenu(item)} aria-label={`More options for ${item.name}`}>⋯</button>
                  : <button className="icon" onClick={() => onRemove(item)} aria-label={`Remove ${item.name}`}>×</button>}
              </div>
            </SwipeRow>
          ) : (<>
          {drag && (
            <span className="handle" aria-label={`Drag ${item.name} to a new location`} {...drag(item)}>⠿</span>
          )}
          <label>
            <input type="checkbox" checked={item.done} onChange={() => onToggle(item)} />
            {iconOf?.(item) && <span className="item-icon" aria-hidden="true">{iconOf(item)}</span>}
            <span className="name">
              <span className="name-text">{item.name}</span>
              {showQty && item.qty && item.qty > 1 && <span className="qty"> ×{item.qty}</span>}
              {!showQty && qtyUnitPriceText(item, { price: showPrice }) && <span className="qty"> {qtyUnitPriceText(item, { price: showPrice })}</span>}
              {showQty && showPrice && !onPatch && qtyUnitPriceText(item, { qty: false, price: true }) && (
                <span className="qty"> {qtyUnitPriceText(item, { qty: false, price: true })}</span>
              )}
              {item.note && <span className="item-note">{item.note}</span>}
              {whereOf(item) && <span className="sub">{whereOf(item)}</span>}
            </span>
          </label>
          <span className="row-actions">
          {onPin && !item.done && (
            <button
              className="icon pin"
              onClick={() => onPin(item)}
              aria-pressed={!!pinned?.has(item.id)}
              aria-label={pinned?.has(item.id) ? `Stop showing ${item.name} on the map` : `Show ${item.name} on the map`}
              title="Show on map"
            >📍</button>
          )}
          {clearBtn(item)}
          {onMenu && (
            <button className="icon" onClick={() => onMenu(item)} aria-label={`More options for ${item.name}`}>⋯</button>
          )}
          <button className="icon" onClick={() => onRemove(item)} aria-label={`Remove ${item.name}`}>×</button>
          </span>
          </>)}
        </li>
        </Fragment>
        );
      })}
    </ul>
  );
}

/** Re-export for callers that edit unit from the menu. */
export type { ItemUnit };
