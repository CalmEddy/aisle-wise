import { useMemo, useState } from 'react';
import type { Catalog } from '../core/catalog';
import { Floor } from '../core/floor';
import { placeAt, spotPoint } from '../core/geometry';
import { groupIntoStops, locateItem, locateProduct, productFor, resolveSpot } from '../core/locate';
import { planRoute } from '../core/route';
import type { ListItem, Point, Product, StoreLayout } from '../core/types';
import { StoreMap } from './StoreMap';

interface Props {
  layout: StoreLayout;
  floor: Floor;
  catalog: Catalog;
  items: ListItem[];
  setItems: (fn: (prev: ListItem[]) => ListItem[]) => void;
  /** Saves where an item is in this store (creating a master-list item if needed). */
  setLocation: (item: ListItem, spotKey: string) => void;
  setSoldHere: (product: Product, sold: boolean) => void;
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

const newId = () => Math.random().toString(36).slice(2, 10);

export function ShoppingView(props: Props) {
  const { layout, floor, catalog, items, setItems, setLocation, setSoldHere, position, setPosition, onEditLayout } = props;
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);

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
  const suggestions = useMemo(() => catalog.suggest(segment, 6, onList), [catalog, segment, onList]);

  const done = items.filter((i) => i.done);
  const here = placeAt(layout, position);
  const atEntrance = position.x === layout.entrance.x && position.y === layout.entrance.y;

  function addItems(text: string) {
    const names = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    setItems((prev) => [
      ...prev,
      ...names.map((name) => ({ id: newId(), name, done: false, productId: catalog.exact(name)?.id })),
    ]);
    setDraft('');
  }

  function addProduct(product: Product) {
    const rest = draft.split(',').slice(0, -1).map((s) => s.trim()).filter(Boolean);
    setItems((prev) => [
      ...prev,
      ...rest.map((name) => ({ id: newId(), name, done: false, productId: catalog.exact(name)?.id })),
      { id: newId(), name: product.name, done: false, productId: product.id },
    ]);
    setDraft('');
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
          addItems(draft);
        }}
      >
        <div className="add-row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add items, e.g. milk, apples, pasta"
            aria-label="Add items"
            aria-autocomplete="list"
            autoComplete="off"
            enterKeyHint="done"
          />
          <button type="submit" disabled={!draft.trim()}>Add</button>
        </div>
        {suggestions.length > 0 && (
          <ul className="suggestions" role="listbox" aria-label="Suggestions">
            {suggestions.map((p) => (
              <li key={p.id} role="option" aria-selected={false}>
                <button type="button" onClick={() => addProduct(p)}>
                  <span>{p.name}</span>
                  <span className="muted small">{whereText(p, layout, catalog)}</span>
                </button>
              </li>
            ))}
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
            <ItemRows items={next.items} onToggle={toggle} onRemove={remove} drag={dragHandlers} dragging={drag?.item.id} big />
          </section>
        )}

        {later.map((stop, i) => (
          <section className={`card${overKey(drag, stop.key)}`} key={stop.key} data-drop={stop.key}>
            <div className="stop-head">
              <span className="num">{i + 2}</span>
              <h3>{stop.label}</h3>
            </div>
            <ItemRows items={stop.items} onToggle={toggle} onRemove={remove} drag={dragHandlers} dragging={drag?.item.id} />
          </section>
        ))}

        {unplaced.length > 0 && (
          <section className="card unplaced">
            <h3>Where is this?</h3>
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
                <button className="icon" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>×</button>
              </div>
            ))}
          </section>
        )}

        {notSold.length > 0 && (
          <section className="card not-sold">
            <h3>Not sold at {layout.name}</h3>
            <p className="muted small">Get these somewhere else, or mark them as sold here.</p>
            {notSold.map((item) => {
              const product = productFor(item, catalog)!;
              return (
                <div className="row" key={item.id}>
                  <span className="name">{item.name}</span>
                  <button className="btn" onClick={() => setSoldHere(product, true)}>Sold here</button>
                  <button className="icon" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>×</button>
                </div>
              );
            })}
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
  if (loc.kind === 'not-sold') return 'Not sold here';
  return catalog.categoryById.get(product.categoryId ?? '')?.name ?? 'No location yet';
}

function overKey(drag: Drag | null, key: string) {
  return drag?.over === key ? ' drop-over' : '';
}

type DragHandlers = (item: ListItem) => React.HTMLAttributes<HTMLSpanElement>;

function ItemRows({ items, onToggle, onRemove, drag, dragging, big }: {
  items: ListItem[];
  onToggle: (i: ListItem) => void;
  onRemove: (i: ListItem) => void;
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
