import type { ListItem, Stop } from '../core/types';
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
export function VisitCard({ visit, next, drag, rows, onGoTo, colorOf, sectionName }: {
  visit: { number: number; stops: Stop[] };
  next?: boolean;
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
  const where = `${first.placeLabel || 'Unnamed'}${first.detail ? ` · ${first.detail}` : sectionName?.(first) && visit.stops.length > 1 ? ` · ${sectionName(first)}` : ''}`;
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

export function ItemRows({ items, onToggle, onRemove, onMenu, drag, dragging, iconOf, pinned, onPin, subOf, tintOf, dropOf, firstIsNearest, big, simple, onNotHere }: {
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
  /** Row tint (category colour). */
  tintOf?: (i: ListItem) => string | undefined;
  /** Drop target key per row. */
  dropOf?: (i: ListItem) => string | undefined;
  firstIsNearest?: boolean;
  big?: boolean;
  /**
   * Shopping rows: just the checkbox, icon, name and ⋯. Swipe right to check
   * off, left for Not here / Remove. (📍 and × move into the ⋯ menu.)
   */
  simple?: boolean;
  onNotHere?: (i: ListItem) => void;
}) {
  return (
    <ul className={big ? 'items big' : 'items'}>
      {items.map((item) => (
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
                  <input type="checkbox" checked={item.done} onChange={() => onToggle(item)} />
                  {iconOf?.(item) && <span className="item-icon" aria-hidden="true">{iconOf(item)}</span>}
                  <span className="name">
                    {item.name}
                    {item.qty && item.qty > 1 && <span className="qty"> ×{item.qty}</span>}
                    {item.note && <span className="item-note">{item.note}</span>}
                    {subOf?.(item) && <span className="sub">{subOf(item)}</span>}
                  </span>
                </label>
                {pinned?.has(item.id) && <span className="pinned-dot" title="Shown on the map" aria-label="Shown on the map">📍</span>}
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
              {item.name}
              {item.qty && item.qty > 1 && <span className="qty"> ×{item.qty}</span>}
              {item.note && <span className="item-note">{item.note}</span>}
              {subOf?.(item) && <span className="sub">{subOf(item)}</span>}
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
          {onMenu && (
            <button className="icon" onClick={() => onMenu(item)} aria-label={`More options for ${item.name}`}>⋯</button>
          )}
          <button className="icon" onClick={() => onRemove(item)} aria-label={`Remove ${item.name}`}>×</button>
          </span>
          </>)}
        </li>
      ))}
    </ul>
  );
}
