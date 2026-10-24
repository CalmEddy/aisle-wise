import { useEffect, useMemo, useState } from 'react';
import type { QuickAddResult } from '../App';
import type { Catalog } from '../core/catalog';
import { Floor } from '../core/floor';
import { placeAt, spotPoint } from '../core/geometry';
import { groupIntoStops, locateItem, locateProduct, productFor, resolveSpot } from '../core/locate';
import { planRoute } from '../core/route';
import type { ListItem, Place, Point, Product, StoreLayout } from '../core/types';
import { StoreMap } from './StoreMap';

interface Props {
  layout: StoreLayout;
  floor: Floor;
  catalog: Catalog;
  items: ListItem[];
  setItems: (fn: (prev: ListItem[]) => ListItem[]) => void;
  /** Saves where an item is in this store (creating a master-list item if needed). */
  setLocation: (item: ListItem, spotKey: string) => void;
  setAvailable: (item: ListItem, available: boolean) => QuickAddResult['snapshot'];
  quickAdd: (names: string[], mode: 'list' | 'cart', hereKey?: string) => QuickAddResult;
  undo: (snapshot: QuickAddResult['snapshot']) => void;
  setProductLocation: (productId: string, spotKey: string | null) => void;
  position: Point;
  setPosition: (p: Point) => void;
  onEditLayout: () => void;
}

interface Drag {
  item: ListItem;
  x: number;
  y: number;
  /** Spot key under the finger, if any. */
  over?: string;
}


export function ShoppingView(props: Props) {
  const { layout, floor, catalog, items, setItems, setLocation, setAvailable, position, setPosition, onEditLayout } = props;
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [picking, setPicking] = useState<{ productId?: string; item?: ListItem; name: string } | null>(null);
  const [menuFor, setMenuFor] = useState<ListItem | null>(null);

  function markAvailable(item: ListItem, available: boolean) {
    const snapshot = setAvailable(item, available);
    setToast({
      snapshot, added: [], mode: 'list',
      note: available ? `${item.name} is back on your route` : `${item.name} marked not available at ${layout.name}`,
    });
  }

  // The banner fades after a while, unless the place picker is open or it's asking a question.
  const asking = toast?.added.some((a) => a.conflict);
  useEffect(() => {
    if (!toast || picking || asking) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast, picking, asking]);

  const locate = (item: ListItem) => locateItem(item, layout, catalog);

  // Re-plans every time the list, the layout, the master list or the shopper's position changes.
  const { route, unplaced, notSold } = useMemo(() => {
    const { stops, unplaced, notSold } = groupIntoStops(items, locate);
    return { route: planRoute(position, stops, layout.checkout, floor.distance), unplaced, notSold };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, layout, floor, catalog, position]);

  // Suggestions for whatever is after the last comma.
  const segment = draft.split(',').pop() ?? '';
  const onList = useMemo(
    () => new Set(items.filter((i) => !i.done).map((i) => productFor(i, catalog)?.id).filter(Boolean) as string[]),
    [items, catalog],
  );
  const suggestions = useMemo(() => catalog.suggest(segment, 5), [catalog, segment]);
  const typed = segment.trim();
  const typedIsNew = typed.length > 0 && !catalog.exact(typed);

  const done = items.filter((i) => i.done);
  const here = placeAt(layout, position);
  const atEntrance = position.x === layout.entrance.x && position.y === layout.entrance.y;
  const hereKey = here ? spotKeyAt(here, position) : undefined;
  const hereLabel = hereKey ? resolveSpot(hereKey, layout, catalog)?.label : undefined;

  /** Adds from the box: everything before the last comma plus `last`. */
  function quick(last: string, mode: 'list' | 'cart') {
    const names = [...draft.split(',').slice(0, -1), last].map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    const result = props.quickAdd(names, mode, hereKey);
    setDraft('');
    setToast({ ...result, mode });
  }

  function toggle(item: ListItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    // Picking something up tells us where the shopper is standing.
    const loc = locate(item);
    if (!item.done && loc.kind === 'spot') setPosition(loc.spot.point);
  }

  function remove(item: ListItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  function newTrip() {
    setItems((prev) => prev.filter((i) => !i.done));
    setPosition(layout.entrance);
  }

  // --- Drag an item onto a new location (map or stop card) ---
  const dropKeyAt = (x: number, y: number) =>
    (document.elementFromPoint(x, y)?.closest('[data-drop]') as HTMLElement | SVGElement | null)?.dataset.drop;

  const dragHandlers = (item: ListItem) => ({
    onPointerDown(e: React.PointerEvent) {
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      setDrag({ item, x: e.clientX, y: e.clientY });
    },
    onPointerMove(e: React.PointerEvent) {
      if (!drag) return;
      setDrag({ ...drag, x: e.clientX, y: e.clientY, over: dropKeyAt(e.clientX, e.clientY) });
    },
    onPointerUp(e: React.PointerEvent) {
      if (!drag) return;
      const key = dropKeyAt(e.clientX, e.clientY);
      const loc = locate(drag.item);
      if (key && !(loc.kind === 'spot' && loc.spot.key === key)) setLocation(drag.item, key);
      setDrag(null);
    },
    onPointerCancel() {
      setDrag(null);
    },
  });

  const overPlaceId = drag?.over?.split(':')[0];
  const overLabel = drag?.over ? resolveSpot(drag.over, layout, catalog)?.label : undefined;
  const [next, ...later] = route;

  return (
    <>
      <form
        className="add"
        onSubmit={(e) => {
          e.preventDefault();
          quick(segment, 'list');
        }}
      >
        <div className="add-row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={hereLabel ? `Add an item · you're at ${hereLabel}` : 'Add items, e.g. milk, apples, pasta'}
            aria-label="Add items"
            aria-autocomplete="list"
            autoComplete="off"
            enterKeyHint="done"
          />
          <button type="submit" disabled={!draft.trim()}>Add</button>
        </div>
        {typed && (
          <ul className="suggestions" role="listbox" aria-label="Suggestions">
            {suggestions.map((p) => (
              <SuggestionRow
                key={p.id}
                name={p.name}
                detail={onList.has(p.id) ? 'On your list' : whereText(p, layout, catalog)}
                onList={onList.has(p.id)}
                onAdd={(mode) => quick(p.name, mode)}
              />
            ))}
            {typedIsNew && (
              <SuggestionRow
                name={<>Add “{typed}”</>}
                detail={hereLabel ? `New item · at ${hereLabel}` : 'New item'}
                onList={false}
                onAdd={(mode) => quick(typed, mode)}
              />
            )}
          </ul>
        )}
      </form>

      {items.length > 0 && (
        <>
          <StoreMap
            layout={layout}
            you={position}
            stops={route}
            highlightId={here?.id}
            onPlaceTap={(p) => setPosition(spotPoint(p))}
          />
          <section className="here">
            <span className="muted">You're near — tap the map or a place</span>
            <div className="chips" role="list">
              <Chip label="Entrance" active={atEntrance} onClick={() => setPosition(layout.entrance)} />
              {layout.places.map((p) => (
                <Chip
                  key={p.id}
                  label={p.label || 'Unnamed'}
                  active={!atEntrance && here?.id === p.id}
                  onClick={() => setPosition(spotPoint(p))}
                />
              ))}
            </div>
          </section>
        </>
      )}

      <main>
        {items.length === 0 && (
          <div className="empty">
            <p>Your list is empty.</p>
            <p className="muted">
              Add what you need. The list sorts itself into the shortest walk through the store and re-sorts as you move.
            </p>
            <button className="link" onClick={onEditLayout}>Set up your store’s layout</button>
          </div>
        )}

        {route.length > 0 && (
          <p className="hint muted small">Drag ⠿ onto the map or another stop to move an item. The app remembers it for this store.</p>
        )}

        {next && (
          <section className={`card next-card${overKey(drag, next.key)}`} data-drop={next.key}>
            <div className="stop-head">
              <span className="badge">Next</span>
              <h2>{next.label}</h2>
            </div>
            <ItemRows items={next.items} onToggle={toggle} onRemove={remove} onMenu={setMenuFor} drag={dragHandlers} dragging={drag?.item.id} big />
          </section>
        )}

        {later.map((stop, i) => (
          <section className={`card${overKey(drag, stop.key)}`} key={stop.key} data-drop={stop.key}>
            <div className="stop-head">
              <span className="num">{i + 2}</span>
              <h3>{stop.label}</h3>
            </div>
            <ItemRows items={stop.items} onToggle={toggle} onRemove={remove} onMenu={setMenuFor} drag={dragHandlers} dragging={drag?.item.id} />
          </section>
        ))}

        {(unplaced.length > 0 || notSold.length > 0) && (
          <section className="card off-route">
            <h3>Not on the route</h3>
            {unplaced.length > 0 && (
              <>
                <h4>No location yet</h4>
                <p className="muted small">Drag it onto the map, or pick a place. The app remembers for this store.</p>
                {unplaced.map((item) => (
                  <div className="row" key={item.id}>
                    <span className="handle" aria-label={`Drag ${item.name}`} {...dragHandlers(item)}>⠿</span>
                    <span className="name">{item.name}</span>
                    <select value="" onChange={(e) => setLocation(item, e.target.value)} aria-label={`Location of ${item.name}`}>
                      <option value="" disabled>Choose…</option>
                      {layout.places.map((p) => (
                        <option key={p.id} value={p.id}>{p.label || 'Unnamed'}</option>
                      ))}
                    </select>
                    <button className="icon" onClick={() => setMenuFor(item)} aria-label={`More options for ${item.name}`}>⋯</button>
                  </div>
                ))}
              </>
            )}
            {notSold.length > 0 && (
              <>
                <h4>Not available at {layout.name}</h4>
                <p className="muted small">Get these somewhere else.</p>
                {notSold.map((item) => (
                  <div className="row unavailable" key={item.id}>
                    <span className="name">{item.name}</span>
                    <button className="btn" onClick={() => markAvailable(item, true)}>Available here</button>
                    <button className="icon" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>×</button>
                  </div>
                ))}
              </>
            )}
          </section>
        )}

        {items.length > 0 && items.length === done.length && (
          <div className="empty">
            <p>All done! Head to checkout.</p>
          </div>
        )}

        {done.length > 0 && (
          <details className="card done">
            <summary>In the cart ({done.length})</summary>
            <ItemRows items={done} onToggle={toggle} onRemove={remove} />
            <button className="link" onClick={newTrip}>Clear cart and start a new trip</button>
          </details>
        )}
      </main>

      {toast && !drag && (
        <ToastBar
          toast={toast}
          layout={layout}
          catalog={catalog}
          onUndo={() => { props.undo(toast.snapshot); setToast(null); }}
          onChange={(a) => setPicking({ productId: a.productId, name: a.name })}
          onMoveHere={(a) => {
            props.setProductLocation(a.productId, a.conflict!.hereKey);
            setToast(null);
          }}
          onClose={() => setToast(null)}
        />
      )}

      {menuFor && (
        <ItemMenu
          item={menuFor}
          where={(() => {
            const loc = locate(menuFor);
            return loc.kind === 'spot' ? loc.spot.label : loc.kind === 'not-sold' ? `Not available at ${layout.name}` : 'No location yet';
          })()}
          storeName={layout.name}
          onChangePlace={() => {
            setPicking({ productId: productFor(menuFor, catalog)?.id, item: menuFor, name: menuFor.name });
            setMenuFor(null);
          }}
          onNotAvailable={() => {
            markAvailable(menuFor, false);
            setMenuFor(null);
          }}
          onRemove={() => {
            remove(menuFor);
            setMenuFor(null);
          }}
          onCancel={() => setMenuFor(null)}
        />
      )}

      {picking && (
        <PlacePicker
          name={picking.name}
          layout={layout}
          catalog={catalog}
          hereKey={hereKey}
          current={picking.productId ? catalog.productById.get(picking.productId)?.locations?.[layout.id] : undefined}
          onPick={(key) => {
            if (picking.productId) props.setProductLocation(picking.productId, key);
            else if (key && picking.item) setLocation(picking.item, key);
            setPicking(null);
            setToast(null);
          }}
          onNotAvailable={() => {
            const item = picking.item ?? items.find((i) => !i.done && productFor(i, catalog)?.id === picking.productId);
            if (item) markAvailable(item, false);
            else if (picking.productId) {
              const product = catalog.productById.get(picking.productId)!;
              markAvailable({ id: '', name: product.name, done: false, productId: product.id }, false);
            }
            setPicking(null);
          }}
          onCancel={() => setPicking(null)}
        />
      )}

      {drag && (
        <>
          <div className="drop-overlay">
            <p>
              {overLabel ? <>Move <b>{drag.item.name}</b> to <b>{overLabel}</b></> : <>Drop <b>{drag.item.name}</b> on a place</>}
            </p>
            <StoreMap layout={layout} highlightId={overPlaceId} />
          </div>
          <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>{drag.item.name}</div>
        </>
      )}
    </>
  );
}

/** Short "where is it" text for a master-list item in this store. */
export function whereText(product: Product, layout: StoreLayout, catalog: Catalog): string {
  const loc = locateProduct(product, layout, catalog);
  if (loc.kind === 'spot') return loc.spot.label;
  if (loc.kind === 'not-sold') return 'Not available here';
  return catalog.categoryById.get(product.categoryId ?? '')?.name ?? 'No location yet';
}

function overKey(drag: Drag | null, key: string) {
  return drag?.over === key ? ' drop-over' : '';
}

type DragHandlers = (item: ListItem) => React.HTMLAttributes<HTMLSpanElement>;

function ItemRows({ items, onToggle, onRemove, onMenu, drag, dragging, big }: {
  items: ListItem[];
  onToggle: (i: ListItem) => void;
  onRemove: (i: ListItem) => void;
  onMenu?: (i: ListItem) => void;
  drag?: DragHandlers;
  dragging?: string;
  big?: boolean;
}) {
  return (
    <ul className={big ? 'items big' : 'items'}>
      {items.map((item) => (
        <li key={item.id} className={['row', item.done && 'checked', dragging === item.id && 'dragging'].filter(Boolean).join(' ')}>
          {drag && (
            <span className="handle" aria-label={`Drag ${item.name} to a new location`} {...drag(item)}>⠿</span>
          )}
          <label>
            <input type="checkbox" checked={item.done} onChange={() => onToggle(item)} />
            <span className="name">{item.name}</span>
          </label>
          {onMenu && (
            <button className="icon" onClick={() => onMenu(item)} aria-label={`More options for ${item.name}`}>⋯</button>
          )}
          <button className="icon" onClick={() => onRemove(item)} aria-label={`Remove ${item.name}`}>×</button>
        </li>
      ))}
    </ul>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button role="listitem" className={active ? 'chip active' : 'chip'} onClick={onClick}>
      {label}
    </button>
  );
}

type Toast = QuickAddResult & { mode: 'list' | 'cart'; /** Plain message instead of an add summary. */ note?: string };

/** The most specific spot key for where the shopper is standing. */
function spotKeyAt(place: Place, at: Point): string {
  const n = place.categories.length;
  const i = place.categories.findIndex((_, k) => {
    const p = spotPoint(place, k, n);
    return p.x === at.x && p.y === at.y;
  });
  return i >= 0 ? `${place.id}:${place.categories[i]}` : place.id;
}

function SuggestionRow({ name, detail, onList, onAdd }: {
  name: React.ReactNode;
  detail: string;
  onList: boolean;
  onAdd: (mode: 'list' | 'cart') => void;
}) {
  return (
    <li className="suggestion" role="option" aria-selected={false}>
      <div className="s-text">
        <span>{name}</span>
        <span className="muted small">{detail}</span>
      </div>
      {!onList && (
        <button type="button" className="s-btn" onClick={() => onAdd('list')}>+ List</button>
      )}
      <button type="button" className="s-btn cart" onClick={() => onAdd('cart')}>🛒 Cart</button>
    </li>
  );
}

function ToastBar({ toast, layout, catalog, onUndo, onChange, onMoveHere, onClose }: {
  toast: Toast;
  layout: StoreLayout;
  catalog: Catalog;
  onUndo: () => void;
  onChange: (a: QuickAddResult['added'][number]) => void;
  onMoveHere: (a: QuickAddResult['added'][number]) => void;
  onClose: () => void;
}) {
  const { added, mode } = toast;
  if (toast.note) {
    return (
      <div className="toast" role="status">
        <span className="toast-text">{toast.note}</span>
        <button className="toast-btn" onClick={onUndo}>Undo</button>
        <button className="icon" onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    );
  }
  if (!added.length) return null;

  // Put in the cart away from where it's saved: ask before moving it.
  const clash = added.find((a) => a.conflict);
  if (clash?.conflict) {
    const label = (key: string) => resolveSpot(key, layout, catalog)?.label ?? 'another place';
    const saved = label(clash.conflict.savedKey);
    const here = label(clash.conflict.hereKey);
    return (
      <div className="toast question" role="alertdialog" aria-label={`Move ${clash.name}?`}>
        <span className="toast-text">
          <b>{clash.name}</b> is in your cart. It’s saved at <b>{saved}</b> — is it here at <b>{here}</b>?
        </span>
        <div className="toast-actions">
          <button className="toast-btn subtle" onClick={onUndo}>Undo</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Keep {saved}</button>
          <button className="btn primary" onClick={() => onMoveHere(clash)}>Move here</button>
        </div>
      </div>
    );
  }

  const one = added.length === 1 ? added[0] : undefined;
  const where = (a: QuickAddResult['added'][number]) => {
    const p = catalog.productById.get(a.productId);
    return p ? whereText(p, layout, catalog) : '';
  };

  let text: React.ReactNode;
  if (!one) text = <>{added.length} items added to your {mode === 'cart' ? 'cart' : 'list'}</>;
  else if (mode === 'cart') text = <><b>{one.name}</b> is in your cart{one.savedAt && <> · saved at {where(one)}</>}</>;
  else if (one.alreadyOnList) text = <><b>{one.name}</b> is already on your list</>;
  else text = <><b>{one.name}</b> added{one.isNew ? ' as a new item' : ''} · {where(one)}</>;

  return (
    <div className="toast" role="status">
      <span className="toast-text">{text}</span>
      {one && <button className="toast-btn" onClick={() => onChange(one)}>Change place</button>}
      <button className="toast-btn" onClick={onUndo}>Undo</button>
      <button className="icon" onClick={onClose} aria-label="Dismiss">×</button>
    </div>
  );
}

function PlacePicker({ name, layout, catalog, hereKey, current, onPick, onNotAvailable, onCancel }: {
  name: string;
  layout: StoreLayout;
  catalog: Catalog;
  hereKey?: string;
  current?: string;
  onPick: (key: string | null) => void;
  onNotAvailable: () => void;
  onCancel: () => void;
}) {
  const label = (key: string) => resolveSpot(key, layout, catalog)?.label ?? key;
  const option = (key: string, text: React.ReactNode) => (
    <button key={key} className={key === current ? 'pick active' : 'pick'} onClick={() => onPick(key)}>{text}</button>
  );
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-label={`Where is ${name}?`} onClick={(e) => e.stopPropagation()}>
        <h2>Where is {name}?</h2>
        <p className="muted small">At {layout.name}. Tap a place.</p>
        {hereKey && option(hereKey, <>📍 Here · {label(hereKey)}</>)}
        <div className="pick-list">
          {layout.places.map((p) => (
            <div key={p.id} className="pick-group">
              {option(p.id, p.label || 'Unnamed')}
              {p.categories.length > 1 && p.categories.map((cid) => option(`${p.id}:${cid}`, (
                <span className="sub">{catalog.categoryById.get(cid)?.name ?? cid}</span>
              )))}
            </div>
          ))}
        </div>
        <div className="sheet-actions">
          <button className="btn" onClick={() => onPick(null)}>Not sure</button>
          <button className="btn" onClick={onNotAvailable}>Not available here</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ItemMenu({ item, where, storeName, onChangePlace, onNotAvailable, onRemove, onCancel }: {
  item: ListItem;
  where: string;
  storeName: string;
  onChangePlace: () => void;
  onNotAvailable: () => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-label={`Options for ${item.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>{item.name}</h2>
        <p className="muted small">{where}</p>
        <button className="pick" onClick={onChangePlace}>📍 Change place</button>
        <button className="pick" onClick={onNotAvailable}>🚫 Not available at {storeName}</button>
        <button className="pick danger" onClick={onRemove}>Remove from list</button>
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
