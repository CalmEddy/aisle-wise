import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuildOutcome, QuickAddResult, Snapshot } from '../App';
import { extendCandidates, planBuild, type BuildChoice, type BuildTarget, type Direction } from '../core/build';
import { addedRect, nextShelves, skippedShelves } from '../core/rows';
import type { Catalog } from '../core/catalog';
import { Floor } from '../core/floor';
import { exactKey, exactSpotAt, footprint, placeAt } from '../core/geometry';
import { groupIntoStops, locateItem, locateProduct, productFor, resolveSpot } from '../core/locate';
import { groupVisits, planGroupedRoute } from '../core/route';
import type { ListItem, Place, Point, Product, Shelf, Stop, StoreLayout } from '../core/types';
import type { Display, SectionLook } from '../display';
import { DisplayToggles } from './DisplayToggles';
import { BuildToolbar, StoreSettings, type BuildTool, type StoreApi } from './BuildTools';
import { PlacePanel, clamp, handlePoint } from './PlacePanel';
import { checkLayout } from '../core/validate';
import { SpotPicker } from './SpotPicker';
import { StoreMap, placeUnder, toGrid, type MapDot, type MapGhost } from './StoreMap';
import { CategoryPicker } from './CategoryPicker';
import { ListBar, ListsSheet, type ListsApi } from './ListsSheet';
import { ShelfBlockPanel, useShelfBlock } from './ShelfBlock';

interface Props {
  /** The household's lists; this view shows the current one. */
  lists: ListsApi;
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
  placeChosen: (productId: string, at: Point, choice: BuildChoice, snapshot: Snapshot) => BuildOutcome;
  /** Adds shelves (numbered in order); returns their ids and what Undo restores. */
  addShelves: (shelves: Shelf[]) => { placeIds: string[]; snapshot: Snapshot };
  /** Returns what Undo restores, or nothing if the shelf can't turn. */
  turnShelfHere: (shelfId: string, pairId?: string) => Snapshot | undefined;
  renamePlace: (placeId: string, label: string) => void;
  addAreaHere: () => { placeId: string; snapshot: Snapshot } | undefined;
  stepTo: (dir: Direction) => void;
  markHere: (which: 'entrance' | 'checkout') => Snapshot;
  startBlankStore: () => void;
  updatePlace: (placeId: string, patch: Partial<Place>) => void;
  deletePlace: (placeId: string) => void;
  /** What Undo would put back right now. */
  snapshot: () => Snapshot;
  /** Adds a shelf or open area where the map was tapped. */
  addPlaceAt: (kind: 'shelf-v' | 'shelf-h' | 'area', at: Point) => { placeId: string; label: string; snapshot: Snapshot };
  /** Moves the entrance or checkout to a square. */
  markAt: (which: 'entrance' | 'checkout', at: Point) => void;
  store: StoreApi;
}

/** Dragging something on the map in build mode's Walk tool. */
type MapDrag =
  | { mode: 'move' | 'resize'; id: string; start: Point; orig: Place; snapshot: Snapshot; moved: boolean }
  | { mode: 'entrance' | 'checkout'; start: Point; snapshot: Snapshot; moved: boolean };

/** The build-mode banner: what just changed, with follow-up buttons. */
type BuildNote =
  | (BuildOutcome & { turned?: boolean })
  | { kind: 'area'; placeId: string; snapshot: Snapshot }
  /** Shelves added with "next shelf" or the skipped-shelves suggestion; `placeId` is the last one. */
  | { kind: 'shelves'; placeId: string; count: number; filled: boolean; snapshot: Snapshot }
  | { kind: 'message'; text: string; snapshot?: Snapshot };

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

  // Build mode: the shelf "next shelf" copies – the one being edited, the one
  // you're beside, or the last one built.
  const [lastShelfId, setLastShelfId] = useState<string>();
  useEffect(() => {
    if (note && 'placeId' in note && layout.places.some((p) => p.id === note.placeId && p.kind === 'shelf')) setLastShelfId(note.placeId);
  }, [note, layout]);
  const double = !!props.display.buildDouble;
  const lane = props.display.blockLane ?? 2;
  const setDouble = (d: boolean) => props.setDisplay((x) => ({ ...x, buildDouble: d }));
  // Shelf block tool: drag out a rectangle to fill with shelves.
  const [tool, setToolState] = useState<BuildTool>('walk');
  const block = useShelfBlock(layout, double, lane);
  const blocking = building && tool === 'block';
  function setTool(t: BuildTool) {
    setToolState(t);
    block.reset();
    if (t === 'block') {
      setEditingId(undefined);
      setNote(null);
    }
  }
  const problems = useMemo(() => (building ? checkLayout(layout, floor, catalog.categories) : []), [building, layout, floor, catalog.categories]);

  // Walk tool: drag the selected shelf/area (or its resize handle), or the entrance/checkout markers.
  const svgRef = useRef<SVGSVGElement>(null);
  const mapDrag = useRef<MapDrag | null>(null);
  const ignoreTap = useRef(false);
  const cellOf = (e: React.PointerEvent): Point => {
    const g = toGrid(svgRef.current!, e.clientX, e.clientY);
    return { x: clamp(Math.floor(g.x), 0, layout.width - 1), y: clamp(Math.floor(g.y), 0, layout.height - 1) };
  };
  function beginMapDrag(d: MapDrag, e: React.PointerEvent) {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    mapDrag.current = d;
  }
  function onMapDragMove(e: React.PointerEvent) {
    const d = mapDrag.current;
    if (!d) return;
    const c = cellOf(e);
    const dx = c.x - d.start.x;
    const dy = c.y - d.start.y;
    if (!d.moved && !dx && !dy) return;
    d.moved = true;
    if (!('orig' in d)) {
      props.build.markAt(d.mode, c);
    } else if (d.mode === 'move') {
      props.build.updatePlace(d.id, { x: d.orig.x + dx, y: d.orig.y + dy });
    } else if (d.orig.kind === 'shelf') {
      const o = d.orig;
      const max = o.orientation === 'vertical' ? layout.height - o.y : layout.width - o.x;
      props.build.updatePlace(d.id, { length: clamp(o.length + (o.orientation === 'vertical' ? dy : dx), 2, max) } as Partial<Place>);
    } else {
      const o = d.orig;
      props.build.updatePlace(d.id, { w: clamp(o.w + dx, 1, layout.width - o.x), h: clamp(o.h + dy, 1, layout.height - o.y) } as Partial<Place>);
    }
  }
  function endMapDrag() {
    const d = mapDrag.current;
    mapDrag.current = null;
    if (!d?.moved) return;
    // The click that the drag's release fires straight away shouldn't also move you.
    ignoreTap.current = true;
    setTimeout(() => { ignoreTap.current = false; }, 0);
    const what = !('orig' in d) ? (d.mode === 'entrance' ? 'Entrance moved.' : 'Checkout moved.')
      : d.mode === 'move' ? `Moved “${d.orig.label || d.orig.kind}”.` : `Resized “${d.orig.label || d.orig.kind}”.`;
    setNote({ kind: 'message', text: what, snapshot: d.snapshot });
  }

  /** A tap on the map in build mode, by tool. */
  function buildTap(x: number, y: number, place: Place | undefined) {
    if (ignoreTap.current) return;
    const cell = { x: clamp(Math.floor(x), 0, layout.width - 1), y: clamp(Math.floor(y), 0, layout.height - 1) };
    if (tool === 'shelf-v' || tool === 'shelf-h' || tool === 'area') {
      const r = props.build.addPlaceAt(tool, cell);
      setEditingId(r.placeId);
      setToolState('walk');
      setNote({ kind: 'message', text: `Added “${r.label}”. Drag it to move it, or change it below.`, snapshot: r.snapshot });
      return;
    }
    if (tool === 'entrance' || tool === 'checkout') {
      const snapshot = props.build.snapshot();
      props.build.markAt(tool, cell);
      setToolState('walk');
      setNote({ kind: 'message', text: tool === 'entrance' ? 'Entrance set here.' : 'Checkout set here.', snapshot });
      return;
    }
    // Walk: tapping a shelf or area opens it for editing (and puts you there).
    setEditingId(place?.id);
    setPosition(floor.snap(cell));
  }
  const buildPreview = building ? planBuild(layout, position, undefined, 'vertical', props.display.buildArea ? 'area' : 'shelf', double) : undefined;
  const findShelf = (id?: string) => layout.places.find((p): p is Shelf => p.id === id && p.kind === 'shelf');
  const baseShelf = findShelf(editing?.id) ?? findShelf(buildPreview?.action === 'onShelf' ? buildPreview.placeId : undefined) ?? findShelf(lastShelfId);
  // Shelves probably walked past on the way to a shelf that was just made.
  const justMade = note?.kind === 'built' && note.action === 'create' ? findShelf(note.placeId) : undefined;
  const justPair = note?.kind === 'built' ? findShelf(note.pairId) : undefined;
  const skipped = useMemo(
    () => (building && justMade ? skippedShelves(layout, justPair ? [justMade, justPair] : [justMade], double) : []),
    [building, justMade, justPair, layout, double],
  );
  const nextOptions = building && !blocking && baseShelf && !skipped.length
    ? ([-1, 1] as const).map((side) => ({ side, shelves: nextShelves(layout, baseShelf, side, double) })).filter((o) => o.shelves.length > 0)
    : [];

  function stampShelves(shelves: Shelf[], filled: boolean) {
    const r = props.build.addShelves(shelves);
    const last = r.placeIds[r.placeIds.length - 1];
    if (last) setNote({ kind: 'shelves', placeId: last, count: r.placeIds.length, filled, snapshot: r.snapshot });
  }

  const ghosts: MapGhost[] = [];
  if (blocking) {
    for (const sh of block.shelves) ghosts.push({ rect: footprint(sh), kind: 'block' });
  } else if (building) {
    const added = buildPreview && buildPreview.action !== 'onShelf' && buildPreview.action !== 'inArea'
      ? addedRect(layout, buildPreview.layout, buildPreview.placeId) : undefined;
    if (added) ghosts.push({ rect: added, kind: 'preview' });
    const pairGhost = buildPreview?.pairId ? buildPreview.layout.places.find((p) => p.id === buildPreview.pairId) : undefined;
    if (pairGhost) ghosts.push({ rect: footprint(pairGhost), kind: 'preview' });
    for (const o of nextOptions) {
      for (const sh of o.shelves) ghosts.push({ rect: footprint(sh), kind: 'next', label: '+', onTap: () => stampShelves(o.shelves, false) });
    }
    for (const s of skipped) ghosts.push({ rect: footprint(s), kind: 'fill', onTap: () => stampShelves(skipped, true) });
  }

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
    // Each shelf or area is picked up in one pass, walked end to end.
    const route = planGroupedRoute(position, stops, layout.checkout, floor.distance, (st) => {
      const place = layout.places.find((p) => p.id === st.placeId);
      if (!place) return 0;
      const alongX = place.kind === 'shelf' ? place.orientation === 'horizontal' : place.w >= place.h;
      return alongX ? st.point.x * 1000 + st.point.y : st.point.y * 1000 + st.point.x;
    });
    return { route, visits: groupVisits(route), unplaced, notSold };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, layout, floor, catalog, position]);

  // A dot on the map for each spot on the list (the next stop's stand out).
  const mapDots: MapDot[] = visits.flatMap((v, i) => v.stops.map((st) => ({ ...st.mark, next: i === 0 })));

  // Items pinpointed on the map with a red pulsing circle.
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const pinOf = (item: ListItem) => {
    const loc = locate(item);
    return loc.kind === 'spot' ? loc.spot.mark : undefined;
  };
  const pins = items.filter((i) => pinned.has(i.id)).map(pinOf).filter((p): p is { x: number; y: number } => !!p);
  function togglePin(item: ListItem) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else {
        next.add(item.id);
        // Bring the map into view so the pin can be seen.
        const map = document.querySelector('.app > svg.map');
        const r = map?.getBoundingClientRect();
        if (map && r && (r.bottom < 60 || r.top > window.innerHeight - 60)) map.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return next;
    });
  }

  // Without grouping: every item on the route, nearest first (by walking distance from you).
  const grouped = props.display.groupList ?? true;
  const nearestFirst = useMemo(() => {
    if (grouped) return [];
    return route
      .flatMap((st, order) => st.items.map((item) => ({ item, stop: st, order, d: floor.distance(position, st.point) })))
      .sort((a, b) => a.d - b.d || a.order - b.order);
  }, [grouped, route, floor, position]);

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

  /** Takes items off the list, with Undo. */
  function removeWithUndo(gone: ListItem[]) {
    if (!gone.length) return;
    const snapshot = { items, products: catalog.products };
    const ids = new Set(gone.map((i) => i.id));
    setItems((prev) => prev.filter((i) => !ids.has(i.id)));
    setToast({ snapshot, added: [], mode: 'list', note: gone.length === 1 ? `Removed ${gone[0].name} from the list.` : `Removed ${gone.length} items from the list.` });
  }
  const [listsOpen, setListsOpen] = useState(false);

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
      <ListBar lists={props.lists} onOpen={() => setListsOpen(true)} />
      {listsOpen && (
        <ListsSheet
          lists={props.lists}
          onClose={() => setListsOpen(false)}
          onCombined={(note, snapshot) => setToast({ snapshot, added: [], mode: 'list', note })}
        />
      )}
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
            dots={mapDots}
            pins={pins}
            ghosts={ghosts}
            look={props.mapLook}
            showGrid={building}
            highlightId={here?.id}
            selectedId={editing?.id}
            ref={svgRef}
            onMapTap={blocking ? undefined : building ? buildTap : (x, y) => setPosition(floor.snap({ x: Math.floor(x), y: Math.floor(y) }))}
            onPlacePointerDown={building && tool === 'walk' ? (place, e) => {
              if (place.id === editing?.id) beginMapDrag({ mode: 'move', id: place.id, start: cellOf(e), orig: place, snapshot: props.build.snapshot(), moved: false }, e);
            } : undefined}
            svgProps={blocking ? { className: 'map drawing', ...block.svgHandlers } : building ? {
              className: `map tappable${tool !== 'walk' || editing ? ' build-editing' : ''}`,
              onPointerMove: onMapDragMove,
              onPointerUp: endMapDrag,
              onPointerCancel: endMapDrag,
            } : undefined}
          >
            {blocking && block.drag.rect && (
              <rect className="map-block-outline" x={block.drag.rect.x} y={block.drag.rect.y} width={block.drag.rect.w} height={block.drag.rect.h} />
            )}
            {building && tool === 'walk' && (['entrance', 'checkout'] as const).map((which) => (
              <rect key={which} className="marker-hit" x={layout[which].x - 0.5} y={layout[which].y - 0.5} width={2} height={2}
                onPointerDown={(e) => beginMapDrag({ mode: which, start: cellOf(e), snapshot: props.build.snapshot(), moved: false }, e)} />
            ))}
            {building && tool === 'walk' && editing && (() => {
              const h = handlePoint(editing);
              return (
                <circle className="resize-handle" cx={h.x} cy={h.y} r={1.2} aria-label="Resize"
                  onPointerDown={(e) => beginMapDrag({ mode: 'resize', id: editing.id, start: cellOf(e), orig: editing, snapshot: props.build.snapshot(), moved: false }, e)} />
              );
            })()}
          </StoreMap>
          {building && <BuildToolbar tool={tool} setTool={setTool} />}
          <DisplayToggles display={props.display} setDisplay={props.setDisplay} show={['buildMode', 'groupList', 'mapColors', 'mapIcons', 'listColors', 'listIcons']} />
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
          {blocking && (
            <ShelfBlockPanel
              rect={block.drag.rect}
              shelves={block.shelves}
              orientation={block.orientation}
              setOrientation={block.setOrientation}
              double={double}
              setDouble={setDouble}
              lane={lane}
              setLane={(n) => props.setDisplay((x) => ({ ...x, blockLane: n }))}
              onAdd={() => { stampShelves(block.shelves, false); setTool('walk'); }}
              onCancel={() => setTool('walk')}
            />
          )}
          {building && !blocking && (
            <BuildPanel
              layout={layout}
              position={position}
              target={props.display.buildArea ? 'area' : 'shelf'}
              setTarget={(t) => props.setDisplay((d) => ({ ...d, buildArea: t === 'area' }))}
              build={props.build}
              preview={buildPreview!}
              turnId={baseShelf?.id}
              nextOptions={nextOptions}
              onNext={(shelves) => stampShelves(shelves, false)}
              double={double}
              setDouble={setDouble}
              onNote={setNote}
            />
          )}
          {building && (
            <StoreSettings
              layout={layout}
              store={props.build.store}
              problems={problems}
              onNewStore={() => {
                props.build.startBlankStore();
                setEditingId(undefined);
                setNote({ kind: 'message', text: 'New blank store started. Tap “I’m at the entrance” where you came in.' });
              }}
              onPickPlace={(id) => { setToolState('walk'); setEditingId(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onUndoable={(text, snapshot) => setNote({ kind: 'message', text, snapshot })}
            />
          )}
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

        {!grouped && nearestFirst.length > 0 && (
          <section className="card flat-list">
            <div className="stop-head">
              <h3>Nearest first</h3>
              <span className="muted small count-pill">{nearestFirst.length} item{nearestFirst.length === 1 ? '' : 's'}</span>
            </div>
            <ItemRows
              items={nearestFirst.map((e) => e.item)}
              onToggle={toggle}
              onRemove={remove}
              onMenu={setMenuFor}
              drag={dragHandlers}
              dragging={drag?.item.id}
              iconOf={iconOf}
              pinned={pinned}
              onPin={togglePin}
              subOf={(item) => nearestFirst.find((e) => e.item.id === item.id)?.stop.label}
              tintOf={(item) => { const e = nearestFirst.find((x) => x.item.id === item.id); return e && sectionColor(e.stop); }}
              dropOf={(item) => nearestFirst.find((e) => e.item.id === item.id)?.stop.key}
              firstIsNearest
            />
          </section>
        )}

        {grouped && nextVisit && (
          <VisitCard visit={nextVisit} next drag={drag} onGoTo={(st) => setPosition(st.point)} colorOf={sectionColor} sectionName={(st) => catalog.categoryById.get(st.key.split(':')[1] ?? '')?.name} rows={(st) => (
            <ItemRows items={st.items} onToggle={toggle} onRemove={remove} onMenu={setMenuFor} drag={dragHandlers} dragging={drag?.item.id} iconOf={iconOf} pinned={pinned} onPin={togglePin} big />
          )} />
        )}

        {grouped && laterVisits.map((v) => (
          <VisitCard key={`${v.number}-${v.placeId}`} visit={v} drag={drag} onGoTo={(st) => setPosition(st.point)} colorOf={sectionColor} sectionName={(st) => catalog.categoryById.get(st.key.split(':')[1] ?? '')?.name} rows={(st) => (
            <ItemRows items={st.items} onToggle={toggle} onRemove={remove} onMenu={setMenuFor} drag={dragHandlers} dragging={drag?.item.id} iconOf={iconOf} pinned={pinned} onPin={togglePin} />
          )} />
        ))}

        {(unplaced.length > 0 || notSold.length > 0) && (
          <section className="card off-route">
            <h3>Not on the route</h3>
            {unplaced.length > 0 && (
              <>
                <h4 className="off-head">
                  No location yet
                  {unplaced.length > 1 && <button className="link" onClick={() => removeWithUndo(unplaced)}>Remove all</button>}
                </h4>
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
                    <button className="icon" onClick={() => removeWithUndo([item])} aria-label={`Remove ${item.name}`}>×</button>
                  </div>
                ))}
              </>
            )}
            {notSold.length > 0 && (
              <>
                <h4 className="off-head">
                  Not available at {layout.name}
                  {notSold.length > 1 && <button className="link" onClick={() => removeWithUndo(notSold)}>Remove all</button>}
                </h4>
                <p className="muted small">Get these somewhere else.</p>
                {notSold.map((item) => (
                  <div className="row unavailable" key={item.id}>
                    <span className="name">{item.name}</span>
                    <button className="btn" onClick={() => markAvailable(item, true)}>Available here</button>
                    <button className="icon" onClick={() => removeWithUndo([item])} aria-label={`Remove ${item.name}`}>×</button>
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
          skipped={skipped}
          onFill={() => stampShelves(skipped, true)}
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

function ItemRows({ items, onToggle, onRemove, onMenu, drag, dragging, iconOf, pinned, onPin, subOf, tintOf, dropOf, firstIsNearest, big }: {
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
          {drag && (
            <span className="handle" aria-label={`Drag ${item.name} to a new location`} {...drag(item)}>⠿</span>
          )}
          <label>
            <input type="checkbox" checked={item.done} onChange={() => onToggle(item)} />
            {iconOf?.(item) && <span className="item-icon" aria-hidden="true">{iconOf(item)}</span>}
            <span className="name">
              {item.name}
              {subOf?.(item) && <span className="sub">{subOf(item)}</span>}
            </span>
          </label>
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
        </li>
      ))}
    </ul>
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
        <div className="field menu-category">
          <span>Category</span>
          <CategoryPicker
            value={categoryId}
            categories={categories}
            onPick={onCategory}
            iconOf={(id) => looks.get(id)?.icon}
            noneLabel="No category"
            label={`Category of ${item.name}`}
          />
        </div>
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
  createArea: () => 'creates a new area here',
  extendArea: (l) => `stretches “${l || 'this area'}” to here`,
  blocked: () => 'can’t fit a shelf here',
};

/** Build mode controls: what checking off here will do, walk arrows and tools. */
function BuildPanel({ layout, position, target, setTarget, build, preview, turnId, nextOptions, onNext, double, setDouble, onNote }: {
  layout: StoreLayout;
  position: Point;
  target: BuildTarget;
  setTarget: (t: BuildTarget) => void;
  build: BuildApi;
  /** What picking up here would do. */
  preview: ReturnType<typeof planBuild>;
  /** The shelf "Turn shelf" turns. */
  turnId?: string;
  /** Where "next shelf" (or pair) can go, either side of the current shelf. */
  nextOptions: { side: -1 | 1; shelves: Shelf[] }[];
  onNext: (shelves: Shelf[]) => void;
  double: boolean;
  setDouble: (d: boolean) => void;
  onNote: (n: BuildNote) => void;
}) {
  const options = preview.action === 'create' || preview.action === 'createArea' ? extendCandidates(layout, position) : [];
  const arrow = (dir: Direction, label: string, glyph: string) => (
    <button className={`btn arrow ${dir}`} onClick={() => build.stepTo(dir)} aria-label={label}>{glyph}</button>
  );
  return (
    <section className="card build-panel">
      <div className="segmented build-target" role="group" aria-label="What to build on open floor">
        <span className="muted small">Build:</span>
        {(['shelf', 'area'] as const).map((t) => (
          <button key={t} className={target === t ? 'active' : ''} aria-pressed={target === t} onClick={() => setTarget(t)}>
            {t === 'shelf' ? '▮ Shelves' : '▦ Areas'}
          </button>
        ))}
      </div>
      <label className="double-toggle">
        <input type="checkbox" checked={double} onChange={(e) => setDouble(e.target.checked)} />
        <span>Double shelves <span className="muted small">(back to back)</span></span>
      </label>
      <p className="build-preview">
        <b>Picking up here</b>{' '}
        {options.length
          ? <>lets you extend {options.map((o) => `“${o.label || 'a shelf'}”`).join(' or ')}, or make a new shelf or area.</>
          : preview.action === 'create' && preview.matched
            ? <>creates a new {preview.pairId ? 'pair of shelves' : 'shelf'} lined up with “{preview.matched}” (shown in blue).</>
            : <>{preview.pairId ? 'creates a new double shelf here' : ACTION_TEXT[preview.action](preview.label)}{preview.action === 'create' || preview.action === 'extend' ? ' (shown in blue)' : ''}.</>}
      </p>
      <p className="muted small">
        Use the arrows to step a square at a time; check items off or tap 🛒 Cart to build around you.
        {nextOptions.length > 0 && <> Tap a grey <b>+</b> shelf on the map to add the next one in the row.</>}
      </p>
      <div className="build-row">
        <div className="arrows" role="group" aria-label="Move one square">
          {arrow('up', 'Move up', '↑')}
          {arrow('left', 'Move left', '←')}
          {arrow('right', 'Move right', '→')}
          {arrow('down', 'Move down', '↓')}
        </div>
        <div className="build-tools">
          {nextOptions.map(({ side, shelves }) => {
            const what = shelves.length > 1 ? 'Next pair' : 'Next shelf';
            return (
              <button key={side} className="btn primary" onClick={() => onNext(shelves)}>
                {shelves[0].orientation === 'vertical' ? (side < 0 ? `← ${what}` : `${what} →`) : (side < 0 ? `↑ ${what}` : `↓ ${what}`)}
              </button>
            );
          })}
          <button className="btn" onClick={() => {
            const r = build.addAreaHere();
            onNote(r ? { kind: 'area', ...r } : { kind: 'message', text: 'There’s no free floor here for an area.' });
          }}>+ Area here</button>
          <button className="btn" disabled={!turnId} onClick={() => {
            const snapshot = turnId ? build.turnShelfHere(turnId) : undefined;
            onNote(snapshot ? { kind: 'message', text: 'Shelf turned.', snapshot } : { kind: 'message', text: 'That shelf can’t turn here – something’s in the way.' });
          }}>⟳ Turn shelf</button>
          <button className="btn" onClick={() => onNote({ kind: 'message', text: 'Entrance set here.', snapshot: build.markHere('entrance') })}>I’m at the entrance</button>
          <button className="btn" onClick={() => onNote({ kind: 'message', text: 'Checkout set here.', snapshot: build.markHere('checkout') })}>I’m at checkout</button>
        </div>
      </div>
    </section>
  );
}

/** Banner after a build-mode change: rename, turn, undo, or (for a conflict) keep / move here. */
function BuildBanner({ note, skipped, onFill, layout, catalog, build, onUndo, onNote, onClose }: {
  note: BuildNote;
  /** Shelves probably walked past to reach a just-made shelf (shown as green ghosts). */
  skipped: Shelf[];
  onFill: () => void;
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
      <div className="toast" role="status">
        <span className="toast-text">{note.text}</span>
        {note.snapshot && <button className="toast-btn" onClick={() => onUndo(note.snapshot!)}>Undo</button>}
        <button className="icon" onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    );
  }

  if (note.kind === 'choose') {
    const arrow = { up: '↑', down: '↓', left: '←', right: '→' } as const;
    const choose = (c: BuildChoice) => onNote(build.placeChosen(note.productId, note.at, c, note.snapshot));
    return (
      <div className="toast question" role="alertdialog" aria-label={`Where is ${note.itemName}?`}>
        <span className="toast-text"><b>{note.itemName}</b> is in your cart. Where is it?</span>
        <div className="toast-choices">
          {note.options.map((o) => (
            <button key={o.shelfId} className="btn primary" onClick={() => choose({ extend: o.shelfId })}>
              {arrow[o.direction]} Extend {o.label || 'shelf'} <span className="muted-on-dark">({o.gap} away)</span>
            </button>
          ))}
          <button className="btn" onClick={() => choose('shelf')}>+ New shelf</button>
          <button className="btn" onClick={() => choose('area')}>+ New area</button>
        </div>
        <div className="toast-actions">
          <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Decide later</button>
        </div>
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
      : note.kind === 'shelves' ? (note.filled
        ? <>Added the <b>{note.count}</b> shelves you walked past.</>
        : note.count > 1
          ? <>Added <b>{note.count}</b> shelves.</>
          : <>Added <b>“{label}”</b>. Tap the next <b>+</b> on the map for another.</>)
      : note.action === 'create' ? <><b>{note.itemName}</b> is in your cart. New {note.pairId ? 'double shelf' : 'shelf'} <b>“{label}”</b>{note.matched ? <>, lined up with “{note.matched}”</> : null}.</>
        : note.action === 'extend' ? <><b>{note.itemName}</b> is in your cart. Extended <b>“{label}”</b> to here.</>
          : note.action === 'createArea' ? <><b>{note.itemName}</b> is in your cart. New area <b>“{label}”</b> — tap it on the map to resize.</>
            : note.action === 'extendArea' ? <><b>{note.itemName}</b> is in your cart. Stretched <b>“{label}”</b> to here.</>
          : <><b>{note.itemName}</b> is in your cart · saved on <b>“{label}”</b>.</>;
  // A new shelf that didn't copy a neighbour may be the wrong way round: offer to turn it.
  const isNewShelf = note.kind === 'built' && note.action === 'create' && place?.kind === 'shelf' && !note.matched;

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
      {skipped.length > 0 && (
        <div className="toast-fill">
          <span>Walked past {skipped.length === 1 ? 'a shelf' : `${skipped.length} shelves`} to get here? They’re shown in green.</span>
          <button className="btn primary" onClick={onFill}>Add {skipped.length === 1 ? 'it' : `all ${skipped.length}`}</button>
        </div>
      )}
      <div className="toast-actions">
        <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
        <span style={{ flex: 1 }} />
        {isNewShelf && place?.kind === 'shelf' && (
          <div className="segmented mini" role="group" aria-label="Shelf direction">
            {(['vertical', 'horizontal'] as const).map((o) => (
              <button key={o} className={place.orientation === o ? 'active' : ''} onClick={() => {
                if (place.orientation !== o && !build.turnShelfHere(place.id, note.kind === 'built' ? note.pairId : undefined)) {
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
