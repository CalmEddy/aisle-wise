import { useEffect, useMemo, useState } from 'react';
import type { BuildOutcome, QuickAddResult, Snapshot } from '../App';
import { planBuild, type Direction } from '../core/build';
import type { Catalog } from '../core/catalog';
import { Floor } from '../core/floor';
import { exactKey, exactSpotAt, placeAt, spotPoint } from '../core/geometry';
import { groupIntoStops, locateItem, locateProduct, productFor, resolveSpot } from '../core/locate';
import { groupVisits, planRoute } from '../core/route';
import type { ListItem, Place, Point, Product, Stop, StoreLayout } from '../core/types';
import type { Display, SectionLook } from '../display';
import { DisplayToggles } from './DisplayToggles';
import { PlacePanel } from './LayoutEditor';
import { SpotPicker } from './SpotPicker';
import { StoreMap, placeUnder, toGrid, type MapVisit } from './StoreMap';

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
  build: BuildApi;
  setItemCategory: (item: ListItem, categoryId: string | undefined) => void;
  position: Point;
  setPosition: (p: Point) => void;
  onEditLayout: () => void;
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
  mapLook: SectionLook;
  looks: Map<string, { color: string; icon: string }>;
}

/** Build-mode actions provided by the app. */
export interface BuildApi {
  pickUpHere: (name: string, itemId?: string) => BuildOutcome;
  moveHereAndBuild: (productId: string) => BuildOutcome;
  turnShelfHere: (shelfId: string) => boolean;
  renamePlace: (placeId: string, label: string) => void;
  addAreaHere: () => { placeId: string; snapshot: Snapshot } | undefined;
  stepTo: (dir: Direction) => void;
  markHere: (which: 'entrance' | 'checkout') => void;
  startBlankStore: () => void;
  updatePlace: (placeId: string, patch: Partial<Place>) => void;
  deletePlace: (placeId: string) => void;
}

/** The build-mode banner: what just changed, with follow-up buttons. */
type BuildNote =
  | (BuildOutcome & { turned?: boolean })
  | { kind: 'area'; placeId: string; snapshot: Snapshot }
  | { kind: 'message'; text: string };

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
  const [note, setNote] = useState<BuildNote | null>(null);
  const building = props.display.buildMode;
  // Build mode: the shelf or area being edited.
  const [editingId, setEditingId] = useState<string>();
  const editing = building ? layout.places.find((p) => p.id === editingId) : undefined;

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
  /** Category icon for a list row, when list icons are on. */
  const iconOf = (item: ListItem) =>
    (props.display.listIcons ?? true) ? props.looks.get(productFor(item, catalog)?.categoryId ?? '')?.icon : undefined;

  /**
   * A section's category colour, when list colours are on: the category in
   * its spot key ("shelf:pasta"), otherwise the category most of its items share.
   */
  const sectionColor = (stop: Stop) => {
    if (!props.display.listColors) return undefined;
    let cat = stop.key.includes(':') ? stop.key.split(':')[1] : undefined;
    if (!cat) {
      const tally = new Map<string, number>();
      for (const i of stop.items) {
        const c = productFor(i, catalog)?.categoryId;
        if (c) tally.set(c, (tally.get(c) ?? 0) + 1);
      }
      cat = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    return cat ? props.looks.get(cat)?.color : undefined;
  };

  // Re-plans every time the list, the layout, the master list or the shopper's position changes.
  const { route, visits, unplaced, notSold } = useMemo(() => {
    const { stops, unplaced, notSold } = groupIntoStops(items, locate);
    const route = planRoute(position, stops, layout.checkout, floor.distance);
    return { route, visits: groupVisits(route), unplaced, notSold };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, layout, floor, catalog, position]);

  // One number per visit on the map, with a dot for each item spot.
  // Numbers go on the floor beside a shelf (where you'd stand), so they don't cover its label.
  const standMark = (pt: Point) => {
    if (floor.walkable(pt)) return { x: pt.x + 0.5, y: pt.y + 0.5 };
    const beside = [{ x: pt.x - 1, y: pt.y }, { x: pt.x + 1, y: pt.y }, { x: pt.x, y: pt.y + 1 }, { x: pt.x, y: pt.y - 1 }]
      .find((q) => floor.walkable(q));
    return beside ? { x: beside.x + 0.5, y: beside.y + 0.5 } : { x: pt.x + 0.5, y: pt.y + 0.5 };
  };
  const mapVisits: MapVisit[] = [];
  for (const [i, v] of visits.entries()) {
    const at = standMark(v.stops[0].point);
    // Two stops facing the same walkway would stack: nudge this number until it's clear.
    for (let tries = 0; tries < 6 && mapVisits.some((m) => Math.hypot(m.at.x - at.x, m.at.y - at.y) < 2.6); tries++) {
      at.y += at.y > layout.height - 4 ? -2.7 : 2.7;
    }
    mapVisits.push({ number: v.number, next: i === 0, at, dots: v.stops.map((st) => st.mark) });
  }

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
  // Where the shopper is standing, as an exact spot (side = the lane they're in).
  const hereKey = here ? exactKey(here.id, exactSpotAt(here, position.x + 0.5, position.y + 0.5)) : undefined;
  const hereLabel = hereKey ? resolveSpot(hereKey, layout, catalog)?.label : undefined;

  /** Adds from the box: everything before the last comma plus `last`. */
  function quick(last: string, mode: 'list' | 'cart') {
    if (building && mode === 'cart' && last.trim()) {
      // Build mode: into the cart where you're standing. Anything before a comma stays in the box.
      setNote(props.build.pickUpHere(last.trim()));
      setDraft(draft.split(',').slice(0, -1).join(',').trim());
      return;
    }
    const names = [...draft.split(',').slice(0, -1), last].map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    const result = props.quickAdd(names, mode, hereKey);
    setDraft('');
    setToast({ ...result, mode });
  }

  function toggle(item: ListItem) {
    if (building && !item.done) {
      // Build mode: picked up where you're standing; the map grows around it.
      setNote(props.build.pickUpHere(item.name, item.id));
      return;
    }
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
  /** What's under the finger: an exact spot on the map, or a stop in the list. */
  const dropKeyAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const svg = el?.closest('svg.map') as SVGSVGElement | null;
    if (svg) {
      const g = toGrid(svg, x, y);
      const place = placeUnder(layout, g.x, g.y);
      return place ? exactKey(place.id, exactSpotAt(place, g.x, g.y)) : undefined;
    }
    return (el?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop;
  };

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

  const overSpot = drag?.over ? resolveSpot(drag.over, layout, catalog) : undefined;
  const [nextVisit, ...laterVisits] = visits;

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

      {!(items.length > 0 || building) && (
        <DisplayToggles display={props.display} setDisplay={props.setDisplay} show={['buildMode']} />
      )}
      {(items.length > 0 || building) && (
        <>
          <StoreMap
            layout={layout}
            you={position}
            visits={mapVisits}
            look={props.mapLook}
            showGrid={building}
            highlightId={here?.id}
            selectedId={editing?.id}
            onMapTap={(x, y, place) => {
              // Build mode: tapping a shelf or area opens it for editing (and puts you there).
              if (building) setEditingId(place?.id);
              setPosition(floor.snap({ x: Math.floor(x), y: Math.floor(y) }));
            }}
          />
          <DisplayToggles display={props.display} setDisplay={props.setDisplay} show={['buildMode', 'mapColors', 'mapIcons', 'listColors', 'listIcons']} />
          {editing && (
            <div className="build-edit">
              <div className="build-edit-head">
                <h3>Editing “{editing.label || (editing.kind === 'shelf' ? 'shelf' : 'area')}”</h3>
                <button className="btn primary" onClick={() => setEditingId(undefined)}>Done</button>
              </div>
              <PlacePanel
                place={editing}
                onChange={(patch) => props.build.updatePlace(editing.id, patch as Partial<Place>)}
                onDelete={() => {
                  if (!confirm(`Delete “${editing.label || 'this ' + editing.kind}”?`)) return;
                  props.build.deletePlace(editing.id);
                  setEditingId(undefined);
                }}
                usedElsewhere={(catId) => layout.places.find((p) => p.id !== editing.id && p.categories.includes(catId))?.label}
                categories={catalog.categories}
                looks={props.looks}
              />
            </div>
          )}
          {building && (
            <BuildPanel
              layout={layout}
              position={position}
              build={props.build}
              lastShelfId={note && 'placeId' in note && layout.places.some((p) => p.id === note.placeId && p.kind === 'shelf') ? note.placeId : undefined}
              onNote={setNote}
            />
          )}
          <section className="here">
            <span className="muted">{hereLabel ? <>You’re at <b>{hereLabel}</b> — tap the map to move</> : 'Tap the map where you are, or pick a place'}</span>
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
          <p className="hint muted small">Tap a place or section name to say you’re there. Drag ⠿ onto the map or another item to move an item.</p>
        )}

        {nextVisit && (
          <VisitCard visit={nextVisit} next drag={drag} onGoTo={(st) => setPosition(st.point)} colorOf={sectionColor} sectionName={(st) => catalog.categoryById.get(st.key.split(':')[1] ?? '')?.name} rows={(st) => (
            <ItemRows items={st.items} onToggle={toggle} onRemove={remove} onMenu={setMenuFor} drag={dragHandlers} dragging={drag?.item.id} iconOf={iconOf} big />
          )} />
        )}

        {laterVisits.map((v) => (
          <VisitCard key={`${v.number}-${v.placeId}`} visit={v} drag={drag} onGoTo={(st) => setPosition(st.point)} colorOf={sectionColor} sectionName={(st) => catalog.categoryById.get(st.key.split(':')[1] ?? '')?.name} rows={(st) => (
            <ItemRows items={st.items} onToggle={toggle} onRemove={remove} onMenu={setMenuFor} drag={dragHandlers} dragging={drag?.item.id} iconOf={iconOf} />
          )} />
        ))}

        {(unplaced.length > 0 || notSold.length > 0) && (
          <section className="card off-route">
            <h3>Not on the route</h3>
            {unplaced.length > 0 && (
              <>
                <h4>No location yet</h4>
                <p className="muted small">
                  {building
                    ? 'Check it off where you find it and the map builds around you – or drag it onto the map, or pick a place.'
                    : 'Drag it onto the map, or pick a place. The app remembers for this store.'}
                </p>
                {unplaced.map((item) => (
                  <div className="row" key={item.id}>
                    <span className="handle" aria-label={`Drag ${item.name}`} {...dragHandlers(item)}>⠿</span>
                    <label>
                      <input type="checkbox" checked={false} onChange={() => toggle(item)} aria-label={building ? `Got ${item.name} here` : `Got ${item.name}`} />
                      {iconOf(item) && <span className="item-icon" aria-hidden="true">{iconOf(item)}</span>}
                      <span className="name">{item.name}</span>
                    </label>
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
            <ItemRows items={done} onToggle={toggle} onRemove={remove} iconOf={iconOf} />
            <button className="link" onClick={newTrip}>Clear cart and start a new trip</button>
          </details>
        )}
      </main>

      {note && !drag && (
        <BuildBanner
          note={note}
          layout={layout}
          catalog={catalog}
          build={props.build}
          onUndo={(snap) => { props.undo(snap); setNote(null); }}
          onNote={setNote}
          onClose={() => setNote(null)}
        />
      )}

      {toast && !drag && !note && (
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
          categoryId={productFor(menuFor, catalog)?.categoryId}
          categories={catalog.categories}
          looks={props.looks}
          onCategory={(id) => props.setItemCategory(menuFor, id)}
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
        <SpotPicker
          look={props.mapLook}
          title={`Where is ${picking.name}?`}
          layout={layout}
          catalog={catalog}
          hereKey={hereKey}
          current={(() => {
            const product = picking.productId ? catalog.productById.get(picking.productId) : undefined;
            const loc = product ? locateProduct(product, layout, catalog) : undefined;
            return loc?.kind === 'spot' ? loc.spot.key : undefined;
          })()}
          onPick={(key) => {
            if (picking.productId) props.setProductLocation(picking.productId, key);
            else if (picking.item) setLocation(picking.item, key);
            setPicking(null);
            setToast(null);
          }}
          extraActions={<>
            <button className="btn" onClick={() => {
              if (picking.productId) props.setProductLocation(picking.productId, null);
              setPicking(null);
              setToast(null);
            }}>Not sure</button>
            <button className="btn" onClick={() => {
            const item = picking.item ?? items.find((i) => !i.done && productFor(i, catalog)?.id === picking.productId);
            if (item) markAvailable(item, false);
            else if (picking.productId) {
              const product = catalog.productById.get(picking.productId)!;
              markAvailable({ id: '', name: product.name, done: false, productId: product.id }, false);
            }
            setPicking(null);
            }}>Not available here</button>
          </>}
          onCancel={() => setPicking(null)}
        />
      )}

      {drag && (
        <>
          <div className="drop-overlay">
            <p>
              {overSpot ? <>Move <b>{drag.item.name}</b> to <b>{overSpot.label}</b></> : <>Drop <b>{drag.item.name}</b> on the exact spot</>}
            </p>
            <StoreMap layout={layout} look={props.mapLook} highlightId={overSpot?.placeId} preview={overSpot?.mark} />
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

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function overKey(drag: Drag | null, key: string) {
  return drag?.over === key ? ' drop-over' : '';
}

/**
 * One numbered stop: a place, with its items grouped by spot in walking
 * order. Each spot is a drop target, so dropping on an item puts the
 * dragged item right next to it.
 */
function VisitCard({ visit, next, drag, rows, onGoTo, colorOf, sectionName }: {
  visit: { number: number; stops: Stop[] };
  next?: boolean;
  drag: Drag | null;
  rows: (stop: Stop) => React.ReactNode;
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
  return (
    <section
      className={`card${next ? ' next-card' : ''}${over ? ' drop-over' : ''}${oneColor ? ' tinted' : ''}`}
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

type DragHandlers = (item: ListItem) => React.HTMLAttributes<HTMLSpanElement>;

function ItemRows({ items, onToggle, onRemove, onMenu, drag, dragging, iconOf, big }: {
  items: ListItem[];
  onToggle: (i: ListItem) => void;
  onRemove: (i: ListItem) => void;
  onMenu?: (i: ListItem) => void;
  drag?: DragHandlers;
  dragging?: string;
  iconOf?: (i: ListItem) => string | undefined;
  big?: boolean;
}) {
  return (
    <ul className={big ? 'items big' : 'items'}>
      {items.map((item) => (
        <li
          key={item.id}
          className={['row', item.done && 'checked', dragging === item.id && 'dragging'].filter(Boolean).join(' ')}
        >
          {drag && (
            <span className="handle" aria-label={`Drag ${item.name} to a new location`} {...drag(item)}>⠿</span>
          )}
          <label>
            <input type="checkbox" checked={item.done} onChange={() => onToggle(item)} />
            {iconOf?.(item) && <span className="item-icon" aria-hidden="true">{iconOf(item)}</span>}
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

function ItemMenu({ item, where, storeName, categoryId, categories, looks, onCategory, onChangePlace, onNotAvailable, onRemove, onCancel }: {
  item: ListItem;
  where: string;
  storeName: string;
  categoryId?: string;
  categories: { id: string; name: string }[];
  looks: Map<string, { color: string; icon: string }>;
  onCategory: (id: string | undefined) => void;
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
        <label className="field menu-category">
          <span>Category</span>
          <select value={categoryId ?? ''} onChange={(e) => onCategory(e.target.value || undefined)} aria-label={`Category of ${item.name}`}>
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{looks.get(c.id)?.icon} {c.name}</option>)}
          </select>
        </label>
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

const ACTION_TEXT: Record<string, (label: string) => string> = {
  onShelf: (l) => `on “${l || 'this shelf'}”`,
  inArea: (l) => `in “${l || 'this area'}”`,
  extend: (l) => `extends “${l || 'this shelf'}” to here`,
  create: () => 'creates a new shelf here',
  blocked: () => 'can’t fit a shelf here',
};

/** Build mode controls: what checking off here will do, walk arrows and tools. */
function BuildPanel({ layout, position, build, lastShelfId, onNote }: {
  layout: StoreLayout;
  position: Point;
  build: BuildApi;
  lastShelfId?: string;
  onNote: (n: BuildNote) => void;
}) {
  const preview = planBuild(layout, position);
  const besideShelf = preview.action === 'onShelf' ? preview.placeId : undefined;
  const turnId = besideShelf ?? lastShelfId;
  const arrow = (dir: Direction, label: string, glyph: string) => (
    <button className={`btn arrow ${dir}`} onClick={() => build.stepTo(dir)} aria-label={label}>{glyph}</button>
  );
  return (
    <section className="card build-panel">
      <p className="build-preview">
        <b>Picking up here</b> {ACTION_TEXT[preview.action](preview.label)}.
      </p>
      <p className="muted small">Tap the map or use the arrows to say where you are, then check items off or tap 🛒 Cart.</p>
      <div className="build-row">
        <div className="arrows" role="group" aria-label="Move one square">
          {arrow('up', 'Move up', '↑')}
          {arrow('left', 'Move left', '←')}
          {arrow('right', 'Move right', '→')}
          {arrow('down', 'Move down', '↓')}
        </div>
        <div className="build-tools">
          <button className="btn" onClick={() => {
            const r = build.addAreaHere();
            onNote(r ? { kind: 'area', ...r } : { kind: 'message', text: 'There’s no free floor here for an area.' });
          }}>+ Area here</button>
          <button className="btn" disabled={!turnId} onClick={() => {
            if (!turnId || !build.turnShelfHere(turnId)) onNote({ kind: 'message', text: 'That shelf can’t turn here – something’s in the way.' });
          }}>⟳ Turn shelf</button>
          <button className="btn" onClick={() => { build.markHere('entrance'); onNote({ kind: 'message', text: 'Entrance set here.' }); }}>I’m at the entrance</button>
          <button className="btn" onClick={() => { build.markHere('checkout'); onNote({ kind: 'message', text: 'Checkout set here.' }); }}>I’m at checkout</button>
          <button className="btn" onClick={() => {
            build.startBlankStore();
            onNote({ kind: 'message', text: 'New blank store started. Tap “I’m at the entrance” where you came in.' });
          }}>New store</button>
        </div>
      </div>
    </section>
  );
}

/** Banner after a build-mode change: rename, turn, undo, or (for a conflict) keep / move here. */
function BuildBanner({ note, layout, catalog, build, onUndo, onNote, onClose }: {
  note: BuildNote;
  layout: StoreLayout;
  catalog: Catalog;
  build: BuildApi;
  onUndo: (s: Snapshot) => void;
  onNote: (n: BuildNote) => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const placeId = 'placeId' in note ? note.placeId : undefined;
  const place = placeId ? layout.places.find((p) => p.id === placeId) : undefined;
  const [name, setName] = useState(place?.label ?? '');
  useEffect(() => setName(place?.label ?? ''), [place?.label]);

  if (note.kind === 'message') {
    return (
      <div className="toast top" role="status">
        <span className="toast-text">{note.text}</span>
        <button className="icon" onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    );
  }

  if (note.kind === 'conflict') {
    const saved = resolveSpot(note.savedKey, layout, catalog)?.label ?? 'another place';
    return (
      <div className="toast question" role="alertdialog" aria-label={`Move ${note.itemName}?`}>
        <span className="toast-text"><b>{note.itemName}</b> is in your cart. It’s saved at <b>{saved}</b> — is it here instead?</span>
        <div className="toast-actions">
          <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Keep {saved}</button>
          <button className="btn primary" onClick={() => onNote(build.moveHereAndBuild(note.productId))}>Move here</button>
        </div>
      </div>
    );
  }

  if (note.kind === 'blocked') {
    return (
      <div className="toast question" role="status">
        <span className="toast-text"><b>{note.itemName}</b> is in your cart, but there’s no room for a shelf here. Move a square and try again, or set its place from ⋯.</span>
        <div className="toast-actions">
          <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>OK</button>
        </div>
      </div>
    );
  }

  const label = place?.label || (place?.kind === 'area' ? 'this area' : 'this shelf');
  const text =
    note.kind === 'area' ? <>New open area added around you.</>
      : note.action === 'create' ? <><b>{note.itemName}</b> is in your cart. New shelf <b>“{label}”</b>.</>
        : note.action === 'extend' ? <><b>{note.itemName}</b> is in your cart. Extended <b>“{label}”</b> to here.</>
          : <><b>{note.itemName}</b> is in your cart · saved on <b>“{label}”</b>.</>;
  const isNewShelf = note.kind === 'built' && note.action === 'create' && place?.kind === 'shelf';

  return (
    <div className="toast question" role="status">
      {renaming ? (
        <form className="rename" onSubmit={(e) => {
          e.preventDefault();
          if (place) build.renamePlace(place.id, name.trim());
          setRenaming(false);
        }}>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus placeholder="e.g. Pasta or 5A" />
          <button className="btn primary">Save</button>
        </form>
      ) : (
        <span className="toast-text">{text}</span>
      )}
      <div className="toast-actions">
        <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
        <span style={{ flex: 1 }} />
        {isNewShelf && place?.kind === 'shelf' && (
          <div className="segmented mini" role="group" aria-label="Shelf direction">
            {(['vertical', 'horizontal'] as const).map((o) => (
              <button key={o} className={place.orientation === o ? 'active' : ''} onClick={() => {
                if (place.orientation !== o && !build.turnShelfHere(place.id)) {
                  onNote({ kind: 'message', text: 'It won’t fit that way here.' });
                }
              }}>{o === 'vertical' ? '↕' : '↔'}</button>
            ))}
          </div>
        )}
        {place && !renaming && <button className="btn" onClick={() => setRenaming(true)}>Rename</button>}
        <button className="icon" onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}
