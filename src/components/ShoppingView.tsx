import { useEffect, useMemo, useRef, useState } from 'react';
import { cutPreview, cutsVertical, type CutNumbers } from '../core/cut';
import { CutPanel } from './CutPanel';
import { AreaPanel, rectBetween, ShelfBlockPanel, useAreaDraft, useBlockDrag, useShelfBlock, type BlockCorner } from './ShelfBlock';
import { expandSelection } from '../core/groups';
import type { LayoutQuestion } from '../core/learn';
import type { BuildOutcome, QuickAddResult, Snapshot } from '../App';
import { planBuild, type BuildChoice, type Direction } from '../core/build';
import { addedRect, nextShelves, skippedShelves } from '../core/rows';
import type { Catalog } from '../core/catalog';
import { Floor } from '../core/floor';
import { contains, exactKey, exactSpotAt, footprint, placeAt, stripFocus } from '../core/geometry';
import { endKey, pastEnd, type Extension } from '../core/extend';
import { hereOptions, type HereOption } from '../core/here';
import { TemplatePicker } from './TemplatePicker';
import { groupIntoStops, locateItem, locateProduct, productFor, resolveSpot } from '../core/locate';
import { groupVisits, planGroupedRoute } from '../core/route';
import type { Clue, Dept, ListItem, Orientation, Place, Placement, Point, Product, Rect, Shelf, ShelfReach, Stop, StoreLayout, Temp, Wall } from '../core/types';
import { resolveListSort, resolveMapView, type Display, type SectionLook } from '../display';
import { DisplayToggles, ListSortToggle } from './DisplayToggles';
import { EmptyArt } from './EmptyArt';
import { Icon } from './Icon';
import { BrushPanel, BuildToolbar, StoreSettings, TOOLS, type BuildTool, type StoreApi } from './BuildTools';
import { DEFAULT_BRUSH, brushArea, brushSegments, segmentRect, type Brush } from '../core/brush';
import { nextAisleLabel, walkwayAt } from '../core/aisles';
import { PlacePanel, clamp, handlePoint } from './PlacePanel';
import { checkLayout } from '../core/validate';
import { SpotPicker } from './SpotPicker';
import { PlaceOnMap, type PlaceMapController } from './PlaceOnMap';
import { StoreMap, placeUnder, toGrid, type MapDot, type MapGhost } from './StoreMap';
import { AddItemsSheet } from './AddItemsSheet';
import { WherePanel } from './WherePanel';
import { nextAisles, type MapSpot } from './WhereBar';
import { orderOf } from '../core/taxonomy';
import { aislesUsed, describeClue, islandKey } from '../core/clues';
import { usePersistentState } from '../usePersistentState';
import { ListsSheet, type ListsApi } from './ListsSheet';
import { type Drag, ItemRows, type ItemPatch } from './ItemRows';
import { type Toast, ToastBar } from './ToastBar';
import { ItemMenu } from './ItemMenu';
import { type BuildNote, BuildPanel, BuildBanner } from './BuildPanel';
import { noShelfText, typicalWhere, whereText } from './whereText';
import { AisleEditor } from './AisleEditor';
import { WhereList } from './WhereList';
import { PlacementCard } from './PlacementCard';
import { LabelStyleSheet } from './LabelStyleSheet';
import { parseLabel, sequenceLabels, type LabelStyle } from '../core/labels';
import { blockSubject, isBlock, pendingPlacements } from '../core/placement';
import { MapTools, type MapAction } from './MapTools';
import { MAX_ZOOM, useMapZoom } from './useMapZoom';
import { aisleShelves, runsUp, selectionRect } from '../core/aisles';
import { clearFor } from '../core/expand';
import { selectionOrder } from '../core/renumber';
import { TripDoneCard } from './TripDoneCard';
import { DeptWallsSheet } from './DeptWallsSheet';
import { offerWalls } from '../core/walls';
import { DOOR_SPOTS } from '../core/door';
import { priceCue } from '../core/prices';
import type { ItemUnit } from '../core/types';

interface Props {
  /** The household's lists; this view shows the current one. */
  lists: ListsApi;
  /** The lists sheet (opened from the list picker / trip title). */
  listsOpen: boolean;
  onListsClose: () => void;
  /** Open the Shop trip list picker (select / combine). */
  onOpenLists?: () => void;
  /** Open the store picker sheet. */
  onOpenStores?: () => void;
  /** Full undo snapshot (every list's items). */
  listSnapshot: () => Snapshot;
  /** Multi-list trip: source list ids for a visible row (for badges). */
  tripSourcesOf?: (item: ListItem) => string[];
  /** Move / copy a single item onto another list. */
  moveItemTo: (itemId: string, toList: string) => { snapshot: Snapshot; moved: boolean; skipped: boolean };
  copyItemTo: (itemId: string, toList: string) => { snapshot: Snapshot; copied: boolean; skipped: boolean };
  /** Add onto any list (active or a recipe/staples list). */
  quickAddTo: (listId: string, names: string[], mode: 'list' | 'cart', hereKey?: string) => QuickAddResult;
  /** Product ids already waiting (unchecked) on a given list. */
  onListIds: (listId: string) => Set<string>;
  /** Parts of the map just added or changed (outlined). */
  mapChanges: string[];
  /** A changed part has been looked at (tapped in Edit map). */
  onSeenChange: (id: string) => void;
  layout: StoreLayout;
  /** All stores (for best-price cues). */
  layouts: StoreLayout[];
  /** "Where was it?" → where I'm standing: what can be chosen or built there. */
  here: {
    options: HereOption[];
    /** Builds the choice and saves the item there (or at `at`); returns what Undo restores and what was done. */
    place: (productId: string, o: HereOption, at?: Point) => { snapshot: Snapshot; note: string } | undefined;
  };
  /** Shelves that seem to run further than the map shows. */
  shelves: {
    due: Extension[];
    /** Grows the shelf; returns what Undo restores. */
    extend: (e: Extension) => Snapshot | undefined;
    /** "Not really": stop asking about that end. */
    keep: (e: Extension) => void;
    /** Something was put just past a shelf's end. */
    notePastEnd: (r: ShelfReach) => void;
  };
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
  /** Remembers a product's price at the current store when the list price is set. */
  setProductPrice: (productId: string, amount: number, unit?: ItemUnit) => void;
  build: BuildApi;
  setItemCategory: (item: ListItem, categoryId: string | undefined) => void;
  /** "Where was it?": whether to ask in this store, saving answers, and logging check-off order. */
  where: {
    ask: boolean;
    setAsk: (on: boolean) => void;
    setClue: (item: ListItem, clue: Clue | undefined) => Snapshot;
    /** (For testing the map; to be removed.) Forgets where these items are in this store. Returns what Undo restores. */
    clearWhere: (items: ListItem[]) => Snapshot;
    notePick: (item: ListItem, picked: boolean) => void;
    /** The cart was cleared: the next check-off starts a new trip. */
    newTrip: () => void;
    /** A question about how the store is laid out, when the trips can't tell. */
    question?: LayoutQuestion;
    answer: (q: LayoutQuestion, option: number | undefined) => void;
    /** The trip in progress here: first and last check-off (ms). */
    trip?: { first: number; last: number };
    /** Places something relative to what's on the map ("Bakery behind Produce"). Returns what Undo restores. */
    place: (ref: string, placement: Placement, dir?: Orientation) => Snapshot;
    /** Not sure where it goes: stop asking. */
    skipPlacement: (ref: string) => void;
    /** "Where's the door?" (once per store), with the likely spot. */
    door?: { guess: number };
    /** The door's spot along the front (0 left – 1 right), or undefined for not sure. Returns what Undo restores. */
    setDoor: (f: number | undefined) => Snapshot | undefined;
    /** Clears first-time setup (door / blank guide) on this store. */
    clearSetup: () => void;
    /** Sets how this store labels its shelves ("B12"), or back to aisle numbers. Returns what Undo restores. */
    setLabels: (style: LabelStyle | undefined) => Snapshot;
  };
  position: Point;
  setPosition: (p: Point) => void;
  onEditLayout: () => void;
  /** Shop trip surface vs Setup → Stores map editor host. */
  role?: 'shop' | 'stores';
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
  /** Adds shelves (keeps labels if set); may move neighbours / grow the map. */
  addShelves: (shelves: Shelf[]) => { placeIds: string[]; snapshot: Snapshot; moved: number; grown: boolean };
  /** Returns what Undo restores, or nothing if the shelf can't turn. */
  turnShelfHere: (shelfId: string, pairId?: string) => Snapshot | undefined;
  renamePlace: (placeId: string, label: string) => void;
  addAreaHere: () => { placeId: string; snapshot: Snapshot } | undefined;
  stepTo: (dir: Direction) => void;
  markHere: (which: 'entrance' | 'checkout') => Snapshot;
  /** A new store in the editor, from a default map (or 'blank'). */
  startBlankStore: (templateId: string, aisles?: number, opts?: { mirror?: boolean }) => void;
  /** Clears first-time setup on the active store. */
  clearSetup: () => void;
  updatePlace: (placeId: string, patch: Partial<Place>) => boolean;
  /** Swaps a piece with the next one along its line; false if they can't swap. */
  swapPlace: (placeId: string, dx: number, dy: number) => boolean;
  /** A piece dragged onto another in its line (from where it started): takes its place. */
  movePlaceOnto: (placeId: string, ontoId: string, from: Point) => boolean;
  deletePlace: (placeId: string) => void;
  /** What Undo would put back right now. */
  snapshot: () => Snapshot;
  /** Adds a shelf or open area where the map was tapped. */
  addPlaceAt: (kind: 'shelf-v' | 'shelf-h' | 'area', at: Point) => { placeId: string; label: string; snapshot: Snapshot; moved: number; grown: boolean };
  addArea: (rect: Rect, label?: string) => { placeId: string; label: string; snapshot: Snapshot; moved: number; grown: boolean };
  /** Moves the entrance or checkout to a square. */
  markAt: (which: 'entrance' | 'checkout', at: Point) => void;
  /** Aisle brush: paint and step; back up one step. */
  brushStep: (dir: Direction, avoid: Rect[]) => { snapshot: Snapshot; from: Point; painted: number; blocked: number; lane: Rect; shift: Point };
  brushBack: (step: { snapshot: Snapshot; from: Point }, original: Point) => void;
  /** Aisle labels: add over a walkway, rename, remove. */
  aisles: {
    add: (rect: Rect, label: string) => { id: string; snapshot: Snapshot };
    rename: (id: string, label: string) => void;
    remove: (id: string) => Snapshot;
    renumber: () => Snapshot;
    renumberFrom: (ids: string[], start: string, flip?: boolean) => Snapshot;
    move: (ids: string | string[], dx: number, dy: number) => boolean;
    turn: (ids: string | string[]) => Snapshot | undefined;
    deleteMany: (ids: string[]) => Snapshot;
    makeBlock: (ids: string[]) => Snapshot | undefined;
    group: (ids: string[]) => Snapshot;
    ungroup: (ids: string[]) => Snapshot;
    cutUnder: (areaId: string) => { snapshot: Snapshot; cut: number };
    within: (box: Rect) => string[];
    cut: (box: Rect, numbers: CutNumbers) => { snapshot: Snapshot; cut: number; renamed: string[] };
  };
  store: StoreApi;
}

/** Dragging something on the map in build mode's Walk tool. */
type MapDrag =
  | { mode: 'move' | 'resize'; id: string; start: Point; orig: Place; snapshot: Snapshot; moved: boolean; last?: Point }
  | { mode: 'area-corner'; id: string; corner: BlockCorner; fixed: Point; orig: Place; snapshot: Snapshot; moved: boolean }
  | { mode: 'entrance' | 'checkout'; start: Point; snapshot: Snapshot; moved: boolean };

const areaCornerCell = (r: Rect, c: BlockCorner): Point => ({
  x: c === 'nw' || c === 'sw' ? r.x : r.x + r.w - 1,
  y: c === 'nw' || c === 'ne' ? r.y : r.y + r.h - 1,
});
const areaOpposite = (c: BlockCorner): BlockCorner =>
  ({ nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }[c] as BlockCorner);

const overlapsRect = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function ShoppingView(props: Props) {
  const { layout, floor, catalog, items, setItems, setLocation, setAvailable, position, setPosition, onEditLayout } = props;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [newStoreOpen, setNewStoreOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [picking, setPicking] = useState<{ productId?: string; item?: ListItem; name: string } | null>(null);
  const [menuFor, setMenuFor] = useState<ListItem | null>(null);
  const [note, setNote] = useState<BuildNote | null>(null);
  const setupKind = layout.gen?.setup;
  const [blankStep, setBlankStep] = useState<'entrance' | 'shelf' | 'area'>('entrance');
  useEffect(() => {
    if (setupKind === 'blank') setBlankStep('entrance');
  }, [layout.id, setupKind]);
  useEffect(() => {
    if (setupKind) props.setDisplay((d) => (resolveMapView(d) === 'full' ? d : { ...d, mapView: 'full' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.id, setupKind]);
  const role = props.role ?? 'shop';
  // Map editing lives under Setup → Stores; Shop never shows the build screen.
  const building = role === 'stores' && props.display.buildMode;
  // Build-mode banners belong to build mode: leaving it clears them.
  useEffect(() => {
    if (!building) setNote(null);
  }, [building]);
  // Build mode: the shelf or area being edited.
  const [editingId, setEditingId] = useState<string>();
  const editing = building ? layout.places.find((p) => p.id === editingId) : undefined;
  // Build mode: the aisle label being edited.
  const [editingAisleId, setEditingAisleId] = useState<string>();
  const editingAisle = building ? layout.aisles?.find((a) => a.id === editingAisleId) : undefined;
  // A tap on an aisle label also lands on the map (moving you there); this says which label it was.
  const aisleTapped = useRef<string>();

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
  // Area tool: same draft gestures as a shelf block.
  const areaDraft = useAreaDraft();
  const draftingArea = building && tool === 'area';
  // Cut tool: drag a box across a block of aisles to make a cross aisle.
  const cutDrag = useBlockDrag(layout);
  const [cutWidth, setCutWidth] = useState<number>();
  const [cutNumbers, setCutNumbers] = useState<CutNumbers>('same');
  const cutting = building && tool === 'cut';
  // Select tool: a group of aisles to turn, move or delete together.
  const selectDrag = useBlockDrag(layout);
  const [selectedAisles, setSelectedAisles] = useState<string[]>([]);
  /** Selection renumber: on-map preview of new labels before confirming. */
  const [renumberMode, setRenumberMode] = useState<{ ids: string[]; start: string; flip: boolean }>();
  const selecting = building && tool === 'select';
  const chosenAisles = selecting ? selectedAisles.filter((id) => layout.aisles?.some((a) => a.id === id) || layout.places.some((p) => p.id === id)) : [];
  /** Dragging the current selection on the map (not a new marquee). Tap (no move) still toggles. */
  const selectMove = useRef<{ last: Point; ids: string[]; snapshot: Snapshot; moved: boolean } | null>(null);

  const isAisleId = (id: string) => !!layout.aisles?.some((a) => a.id === id);
  /** Shelves that come with these aisles anyway. */
  const alongAisles = (ids: string[]) => new Set((layout.aisles ?? []).filter((a) => ids.includes(a.id)).flatMap((a) => aisleShelves(layout, a).map((x) => x.id)));

  function toggleSelectAt(cell: Point) {
    const r = { x: cell.x, y: cell.y, w: 1, h: 1 };
    const here = props.build.aisles.within(r);
    const id = here.find((x) => !isAisleId(x)) ?? here.find(isAisleId) ?? placeUnder(layout, r.x + 0.5, r.y + 0.5)?.id;
    if (!id) {
      // Empty floor: clear the selection (no Clear button on the palette).
      setSelectedAisles([]);
      setRenumberMode(undefined);
      return;
    }
    setSelectedAisles((prev) => {
      const bunch = expandSelection(layout, [id]);
      if (prev.some((x) => bunch.includes(x))) return prev.filter((x) => !bunch.includes(x));
      // A shelf of a selected aisle: take that aisle out.
      const owner = prev.filter((x) => isAisleId(x) && alongAisles([x]).has(id));
      if (owner.length) return prev.filter((x) => !owner.includes(x));
      return expandSelection(layout, [...prev, id]);
    });
  }

  function finishSelect() {
    if (selectMove.current) {
      const m = selectMove.current;
      selectMove.current = null;
      if (m.moved) say(`Moved ${selectionTitle(m.ids)}.`, m.snapshot);
      else toggleSelectAt(m.last);
      return;
    }
    const r = selectDrag.rect;
    selectDrag.up();
    selectDrag.clear();
    if (!r) return;
    if (r.w === 1 && r.h === 1) {
      toggleSelectAt({ x: r.x, y: r.y });
      return;
    }
    // A box picks everything it touches (aisles bring their shelves), then whole groups.
    const ids = props.build.aisles.within(r);
    const along = alongAisles(ids);
    setSelectedAisles(expandSelection(layout, ids.filter((id) => !along.has(id))));
  }

  const selectSvgHandlers = {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      const p = toGrid(e.currentTarget, e.clientX, e.clientY);
      const c = { x: Math.floor(p.x), y: Math.floor(p.y) };
      const box = selectionRect(layout, chosenAisles);
      if (chosenAisles.length && box && contains(box, c)) {
        e.currentTarget.setPointerCapture(e.pointerId);
        selectMove.current = { last: c, ids: chosenAisles, snapshot: props.build.snapshot(), moved: false };
        return;
      }
      selectDrag.down(e);
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const m = selectMove.current;
      if (m) {
        const p = toGrid(e.currentTarget, e.clientX, e.clientY);
        const c = { x: Math.floor(p.x), y: Math.floor(p.y) };
        const dx = c.x - m.last.x;
        const dy = c.y - m.last.y;
        if ((dx || dy) && props.build.aisles.move(m.ids, dx, dy)) {
          selectMove.current = { ...m, last: c, moved: true };
        }
        return;
      }
      selectDrag.move(e);
    },
    onPointerUp: finishSelect,
    onPointerCancel: finishSelect,
  };
  /** What's selected, in words: "Aisle 3", "3 aisles", "2 aisles, 4 shelves". */
  function selectionTitle(ids: string[]): string {
    const aisles = (layout.aisles ?? []).filter((a) => ids.includes(a.id));
    const places = layout.places.filter((p) => ids.includes(p.id));
    if (ids.length === 1) return aisles[0]?.label || places[0]?.label || (aisles.length ? '1 aisle' : places[0]?.kind === 'area' ? 'Area' : 'Shelf');
    const shelves = places.filter((p) => p.kind === 'shelf').length;
    const areas = places.length - shelves;
    const n = (k: number, one: string, many: string) => (k ? [`${k} ${k === 1 ? one : many}`] : []);
    return [...n(aisles.length, 'aisle', 'aisles'), ...n(shelves, 'shelf', 'shelves'), ...n(areas, 'area', 'areas')].join(', ');
  }
  /** The cut box: as dragged, with its thickness changed by the panel's Width. */
  const cutBox = cutDrag.rect && cutWidth !== undefined
    ? (cutsVertical(cutDrag.rect)
      ? { ...cutDrag.rect, y: cutDrag.rect.y + Math.floor((cutDrag.rect.h - cutWidth) / 2), h: cutWidth }
      : { ...cutDrag.rect, x: cutDrag.rect.x + Math.floor((cutDrag.rect.w - cutWidth) / 2), w: cutWidth })
    : cutDrag.rect;
  const cut = cutting && cutBox ? cutPreview(layout, cutBox) : undefined;
  // Aisle brush: the way you're facing, and steps you can back up.
  const brush: Brush = { ...DEFAULT_BRUSH, ...props.display.brush };
  const setBrush = (b: Brush) => props.setDisplay((d) => ({ ...d, brush: b }));
  const [brushDir, setBrushDir] = useState<Direction>('up');
  // Each step: what Back up restores, where you were, its walkway, and how far the store shifted (growing left/up).
  const [brushSteps, setBrushSteps] = useState<{ snapshot: Snapshot; from: Point; lane: Rect; shift: Point }[]>([]);
  const [brushResult, setBrushResult] = useState<string>();
  // Once an item is placed, backing up would undo its saved place too: start the back-up trail afresh.
  useEffect(() => {
    if (note && note.kind !== 'message') setBrushSteps([]);
  }, [note]);
  function brushStepTo(d: Direction) {
    setBrushDir(d);
    const before = position;
    const r = props.build.brushStep(d, brushSteps.slice(-6).map((s) => s.lane));
    const shifted = (rect: Rect): Rect => ({ ...rect, x: rect.x + r.shift.x, y: rect.y + r.shift.y });
    setBrushSteps((prev) => [...prev.slice(-30).map((s) => ({ ...s, lane: shifted(s.lane) })), { snapshot: r.snapshot, from: before, lane: r.lane, shift: r.shift }]);
    setBrushResult(r.blocked ? `Painted ${r.painted} squares; skipped ${r.blocked} where something’s already there.` : undefined);
  }
  function brushBackUp() {
    const last = brushSteps[brushSteps.length - 1];
    if (!last) return;
    props.build.brushBack(last, last.from);
    // Undo that step's shift on the earlier walkways.
    setBrushSteps((prev) => prev.slice(0, -1).map((s) => ({ ...s, lane: { ...s.lane, x: s.lane.x - last.shift.x, y: s.lane.y - last.shift.y } })));
    setBrushResult(undefined);
  }

  function setTool(t: BuildTool) {
    setToolState(t);
    block.reset();
    areaDraft.reset();
    selectDrag.clear();
    selectMove.current = null;
    if (t !== 'select') setSelectedAisles([]);
    cutDrag.clear();
    setCutWidth(undefined);
    setBrushSteps([]);
    if (t !== 'select') setRenumberMode(undefined);
    if (t === 'brush' || t === 'block' || t === 'area' || t === 'cut') { setSheetTab('tool'); setSheetOpen(true); }
    if (t === 'block' || t === 'area' || t === 'cut' || t === 'select') {
      setEditingId(undefined);
      setNote(null);
    }
  }
  // ---- Controls on the map, next to what's selected ----
  const say = (text: string, snapshot?: Snapshot) => setNote({ kind: 'message', text, ...(snapshot && { snapshot }) });
  /** Floating map palette: delete only (move/resize are on-map gestures). */
  function deleteTools(ids: string[], title: string, onGone: () => void) {
    const anchor = selectionRect(layout, ids);
    if (!anchor) return undefined;
    const aisleIds = ids.filter((id) => layout.aisles?.some((a) => a.id === id));
    const onlyAisles = aisleIds.length === ids.length && aisleIds.length > 0;
    const what = !onlyAisles ? title : ids.length === 1 ? 'aisle' : 'aisles';
    return {
      anchor, title,
      rows: [[
        { key: 'delete', icon: '🗑', label: onlyAisles ? `Delete ${what} and shelves` : `Delete ${title}`, danger: true, onClick: () => {
          if (ids.length === 1 && layout.places.some((p) => p.id === ids[0]) && !layout.aisles?.some((a) => a.id === ids[0])) {
            const snapshot = props.build.snapshot();
            props.build.deletePlace(ids[0]);
            onGone();
            say(`Deleted “${title}”.`, snapshot);
            return;
          }
          const snapshot = props.build.aisles.deleteMany(ids);
          onGone();
          say(`Deleted ${title}.`, snapshot);
        } },
      ]] as MapAction[][],
    };
  }

  const mapTools = !building ? undefined
    : selecting && chosenAisles.length ? deleteTools(chosenAisles, selectionTitle(chosenAisles), () => { setSelectedAisles([]); setRenumberMode(undefined); })
      : tool === 'walk' && editingAisle ? deleteTools([editingAisle.id], editingAisle.label || 'aisle', () => setEditingAisleId(undefined))
        : tool === 'walk' && editing ? deleteTools([editing.id], editing.label || (editing.kind === 'shelf' ? 'Shelf' : 'Area'), () => setEditingId(undefined))
          : undefined;

  // When the map changes, the strip shows the changed part for a few seconds, then goes back to following you.
  const [changeFocus, setChangeFocus] = useState<{ a: Point; b: Point }>();
  const seenChanges = useRef<string[]>(props.mapChanges);
  useEffect(() => {
    const fresh = props.mapChanges.filter((id) => !seenChanges.current.includes(id));
    seenChanges.current = props.mapChanges;
    if (!fresh.length) return;
    const rects = [
      ...layout.places.filter((p) => fresh.includes(p.id)).map(footprint),
      ...(layout.aisles ?? []).filter((a) => fresh.includes(a.id)),
    ];
    if (!rects.length) return;
    const a = { x: Math.min(...rects.map((r) => r.x)), y: Math.min(...rects.map((r) => r.y)) };
    const b = { x: Math.max(...rects.map((r) => r.x + r.w)) - 1, y: Math.max(...rects.map((r) => r.y + r.h)) - 1 };
    setChangeFocus({ a, b });
    const t = setTimeout(() => setChangeFocus(undefined), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mapChanges]);

  const problems = useMemo(() => (building ? checkLayout(layout, floor, catalog.categories) : []), [building, layout, floor, catalog.categories]);

  // Walk tool: drag the selected shelf/area (or its resize handle), or the entrance/checkout markers.
  const svgRef = useRef<SVGSVGElement>(null);
  // ---- The editor screen: zoom, the bottom sheet, Undo ----
  const zoom = useMapZoom(svgRef, layout.width, layout.height, {
    canPan: () => tool === 'walk' && !mapDrag.current,
    onGesture: () => { mapDrag.current = null; block.reset(); areaDraft.reset(); selectDrag.clear(); cutDrag.clear(); },
    onPanned: () => { ignoreTap.current = true; setTimeout(() => { ignoreTap.current = false; }, 0); },
  });
  const [sheetTab, setSheetTab] = useState<'tool' | 'list' | 'store'>('tool');
  const [sheetOpen, setSheetOpen] = useState(false);
  /** What Undo in the editor's top bar steps back through (most recent last). */
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const pushed = useRef<unknown>();
  useEffect(() => {
    const snap = (note && 'snapshot' in note ? note.snapshot : undefined) ?? (toast?.snapshot as Snapshot | undefined);
    if (!building || !snap || snap === pushed.current) return;
    pushed.current = snap;
    setUndoStack((st) => [...st.slice(-29), snap]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, toast, building]);
  const dropFromUndo = (snap: unknown) => setUndoStack((st) => st.filter((x) => x !== snap));
  function undoLast() {
    const snap = undoStack[undoStack.length - 1];
    if (!snap) return;
    props.undo(snap);
    setUndoStack((st) => st.slice(0, -1));
    setNote(null);
    setToast(null);
  }
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
    if (d.mode === 'area-corner') {
      const next = rectBetween(d.fixed, c);
      if (next.w === (d.orig.kind === 'area' ? d.orig.w : 0) && next.h === (d.orig.kind === 'area' ? d.orig.h : 0)
        && next.x === d.orig.x && next.y === d.orig.y && !d.moved) return;
      d.moved = true;
      props.build.updatePlace(d.id, { x: next.x, y: next.y, w: next.w, h: next.h } as Partial<Place>);
      return;
    }
    const dx = c.x - d.start.x;
    const dy = c.y - d.start.y;
    if (!d.moved && !dx && !dy) return;
    d.moved = true;
    if (!('orig' in d)) {
      props.build.markAt(d.mode, c);
      return;
    }
    if (d.mode === 'move') {
      d.last = c;
      props.build.updatePlace(d.id, { x: d.orig.x + dx, y: d.orig.y + dy });
      return;
    }
    // resize (shelf end or area SE handle)
    d.last = c;
    if (d.orig.kind === 'shelf') {
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
    // Let go on another piece in its line: it takes that one's place, and the ones between move over.
    if ('orig' in d && d.mode === 'move' && d.last) {
      const at = d.last;
      const onto = layout.places.find((p) => p.id !== d.id && contains(footprint(p), at));
      if (onto && props.build.movePlaceOnto(d.id, onto.id, { x: d.orig.x, y: d.orig.y })) {
        setNote({ kind: 'message', text: `Put “${d.orig.label || d.orig.kind}” where “${onto.label || onto.kind}” was.`, snapshot: d.snapshot });
        return;
      }
    }
    const what = !('orig' in d) ? (d.mode === 'entrance' ? 'Entrance moved.' : 'Checkout moved.')
      : d.mode === 'move' ? `Moved “${d.orig.label || d.orig.kind}”.` : `Resized “${d.orig.label || d.orig.kind}”.`;
    setNote({ kind: 'message', text: what, snapshot: d.snapshot });
  }

  /** A tap on the map in build mode, by tool. */
  function buildTap(x: number, y: number, place: Place | undefined) {
    if (ignoreTap.current) return;
    const cell = { x: clamp(Math.floor(x), 0, layout.width - 1), y: clamp(Math.floor(y), 0, layout.height - 1) };
    if (tool === 'shelf-v' || tool === 'shelf-h') {
      const r = props.build.addPlaceAt(tool, cell);
      setEditingId(r.placeId);
      setToolState('walk');
      const extras = [
        r.moved ? `Moved ${r.moved} to make room` : '',
        r.grown ? 'Map grew' : '',
      ].filter(Boolean).join(' · ');
      setNote({
        kind: 'message',
        text: extras
          ? `Added “${r.label}”. ${extras}.`
          : `Added “${r.label}”. Drag it to move it, or change it below.`,
        snapshot: r.snapshot,
      });
      return;
    }
    if (tool === 'entrance' || tool === 'checkout') {
      const snapshot = props.build.snapshot();
      props.build.markAt(tool, cell);
      setToolState('walk');
      setNote({ kind: 'message', text: tool === 'entrance' ? 'Entrance set here.' : 'Checkout set here.', snapshot });
      return;
    }
    // Walk: tapping a shelf, area or aisle label opens it for editing (and puts you there).
    if (place && props.mapChanges.includes(place.id)) props.onSeenChange(place.id);
    if (!place && aisleTapped.current && props.mapChanges.includes(aisleTapped.current)) props.onSeenChange(aisleTapped.current);
    setEditingId(place?.id);
    setEditingAisleId(place ? undefined : aisleTapped.current);
    aisleTapped.current = undefined;
    setPosition(floor.snap(cell));
  }
  // Standing in a walkway between shelves: label it, or edit the label that's already there.
  const aisleHere = building ? layout.aisles?.find((a) => contains(a, position)) : undefined;
  const walkwayHere = building && !aisleHere ? walkwayAt(layout, position) : undefined;
  const aisleAction = aisleHere
    ? { text: `Aisle “${aisleHere.label}”`, run: () => { setEditingId(undefined); setEditingAisleId(aisleHere.id); } }
    : walkwayHere
      ? { text: 'Label aisle', run: () => {
          const r = props.build.aisles.add(walkwayHere, nextAisleLabel(layout));
          setEditingId(undefined);
          setEditingAisleId(r.id);
          setNote({ kind: 'message', text: 'Aisle labelled – rename it below.', snapshot: r.snapshot });
        } }
      : undefined;
  const buildPreview = building ? planBuild(layout, position, undefined, 'vertical', props.display.buildArea ? 'area' : 'shelf', double) : undefined;
  const findShelf = (id?: string) => layout.places.find((p): p is Shelf => p.id === id && p.kind === 'shelf');
  const baseShelf = findShelf(editing?.id) ?? findShelf(buildPreview?.action === 'onShelf' ? buildPreview.placeId : undefined) ?? findShelf(lastShelfId);
  // Shelves probably walked past on the way to a shelf that was just made.
  const justMade = note?.kind === 'built' && note.action === 'create' ? findShelf(note.placeId) : undefined;
  const justPair = note?.kind === 'built' ? findShelf(note.pairId) : undefined;
  // Suggested shelves never go on an aisle's walkway.
  const clearOfAisles = (shelves: Shelf[]) => shelves.every((sh) => !(layout.aisles ?? []).some((a) => overlapsRect(a, footprint(sh))));
  const skipped = useMemo(
    () => {
      const found = building && justMade ? skippedShelves(layout, justPair ? [justMade, justPair] : [justMade], double) : [];
      return clearOfAisles(found) ? found : [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [building, justMade, justPair, layout, double],
  );
  const nextOptions = building && !blocking && baseShelf && !skipped.length
    ? ([-1, 1] as const).map((side) => ({ side, shelves: nextShelves(layout, baseShelf, side, double) })).filter((o) => o.shelves.length > 0 && clearOfAisles(o.shelves))
    : [];

  function stampShelves(shelves: Shelf[], filled: boolean) {
    const r = props.build.addShelves(shelves);
    const last = r.placeIds[r.placeIds.length - 1];
    if (!last) return;
    const extras = [
      r.moved ? `Moved ${r.moved} to make room` : '',
      r.grown ? 'Map grew' : '',
    ].filter(Boolean).join(' · ');
    if (extras) say(`${r.placeIds.length} shel${r.placeIds.length === 1 ? 'f' : 'ves'} added. ${extras}.`, r.snapshot);
    else setNote({ kind: 'shelves', placeId: last, count: r.placeIds.length, filled, snapshot: r.snapshot });
  }

  const ghosts: MapGhost[] = [];
  if (!building && setupKind === 'entrance') {
    for (const [i, f] of DOOR_SPOTS.entries()) {
      ghosts.push({
        rect: { x: Math.round(f * (layout.width - 1)) - 1, y: layout.height - 2.4, w: 2.2, h: 2.2 },
        kind: 'next',
        label: String(i + 1),
        onTap: () => props.where.setDoor(f),
      });
    }
  } else if (!building && setupKind === 'blank') {
    if (blankStep === 'entrance') {
      for (const [i, f] of DOOR_SPOTS.entries()) {
        const x = Math.round(f * (layout.width - 1));
        ghosts.push({
          rect: { x: x - 1, y: layout.height - 2.4, w: 2.2, h: 2.2 },
          kind: 'next',
          label: String(i + 1),
          onTap: () => {
            props.build.markAt('entrance', { x, y: layout.height - 1 });
            setPosition({ x, y: layout.height - 1 });
            setBlankStep('shelf');
          },
        });
      }
    } else if (blankStep === 'shelf') {
      const at = { x: Math.floor(layout.width / 2), y: Math.floor(layout.height / 2) };
      ghosts.push({
        rect: { x: at.x - 1, y: at.y - 3, w: 2, h: 6 },
        kind: 'preview',
        label: '▮',
        onTap: () => {
          props.build.addPlaceAt('shelf-v', at);
          setBlankStep('area');
        },
      });
    } else {
      const at = { x: 4, y: Math.floor(layout.height / 2) - 1 };
      ghosts.push({
        rect: { x: at.x, y: at.y, w: 3, h: 3 },
        kind: 'next',
        label: '▦',
        onTap: () => {
          props.build.addPlaceAt('area', at);
          props.where.clearSetup();
        },
      });
    }
  } else if (building && tool === 'brush') {
    // The next step's walkway and what it will paint.
    const a = brushArea(position, brushDir, brush.width);
    ghosts.push({ rect: a.orientation === 'vertical'
      ? { x: a.lo, y: a.start, w: a.hi - a.lo + 1, h: a.end - a.start + 1 }
      : { x: a.start, y: a.lo, w: a.end - a.start + 1, h: a.hi - a.lo + 1 }, kind: 'lane' });
    for (const seg of brushSegments(position, brushDir, brush)) ghosts.push({ rect: segmentRect(seg), kind: seg.kind === 'wall' ? 'wall' : 'preview' });
  } else if (blocking) {
    for (const sh of block.shelves) {
      ghosts.push({
        rect: footprint(sh),
        kind: 'block',
        label: sh.label,
        onTap: () => block.setFirstShelf(sh),
      });
    }
    // Preview where neighbours would slide (1-square gap around the block).
    if (block.shelves.length) {
      const box = { x: Math.min(...block.shelves.map((s) => footprint(s).x)), y: Math.min(...block.shelves.map((s) => footprint(s).y)),
        w: 0, h: 0 };
      const maxX = Math.max(...block.shelves.map((s) => { const f = footprint(s); return f.x + f.w; }));
      const maxY = Math.max(...block.shelves.map((s) => { const f = footprint(s); return f.y + f.h; }));
      box.w = maxX - box.x;
      box.h = maxY - box.y;
      const preview = clearFor(layout, [box], {
        preferAcross: block.orientation === 'vertical' ? 'x' : 'y',
        gap: 1,
      });
      for (const [id, d] of Object.entries(preview.shiftById)) {
        if (!d.x && !d.y) continue;
        const p = layout.places.find((x) => x.id === id);
        if (!p) continue;
        ghosts.push({
          rect: { ...footprint(p), x: p.x + d.x, y: p.y + d.y },
          kind: 'next',
          label: '→',
        });
      }
    }
  } else if (draftingArea && areaDraft.rect) {
    ghosts.push({ rect: areaDraft.rect, kind: 'block', label: areaDraft.label || 'Area' });
    const preview = clearFor(layout, [areaDraft.rect], { gap: 1 });
    for (const [id, d] of Object.entries(preview.shiftById)) {
      if (!d.x && !d.y) continue;
      const p = layout.places.find((x) => x.id === id);
      if (!p) continue;
      ghosts.push({
        rect: { ...footprint(p), x: p.x + d.x, y: p.y + d.y },
        kind: 'next',
        label: '→',
      });
    }
  } else if (renumberMode) {
    const order = selectionOrder(layout, renumberMode.ids);
    const seq = sequenceLabels(renumberMode.start || '1', order.length, layout.labels);
    const ordered = renumberMode.flip ? [...order].reverse() : order;
    ordered.forEach((o, i) => {
      if (o.kind === 'aisle') {
        const a = layout.aisles?.find((x) => x.id === o.id);
        if (a) ghosts.push({ rect: a, kind: 'fill', label: seq[i], onTap: () => setRenumberMode({ ...renumberMode, start: seq[0] === seq[i] ? renumberMode.start : seq[i] }) });
      } else {
        const p = layout.places.find((x) => x.id === o.id);
        if (p) ghosts.push({
          rect: footprint(p),
          kind: 'fill',
          label: seq[i],
          onTap: () => {
            const geo = selectionOrder(layout, renumberMode.ids);
            const at = geo.findIndex((x) => x.id === o.id);
            setRenumberMode({
              ...renumberMode,
              flip: false,
              start: renumberMode.start,
              ids: at >= 0 ? [...geo.slice(at), ...geo.slice(0, at)].map((x) => x.id) : renumberMode.ids,
            });
          },
        });
      }
    });
  } else if (cut) {
    for (const r of cut.removed) ghosts.push({ rect: r, kind: 'cut' });
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
      note: available ? `${item.name} is back on your route` : `${item.name} marked not sold at ${layout.name}`,
    });
  }

  // The add window (opened with + on the toggle strip). When set to a list id
  // other than the one being shopped, items go onto that list instead.

  // The banner fades after a while, unless it's asking a question or a window is open over it
  // (place picker, lists, add items): then its Undo is still there when you come back.
  const asking = toast?.added.some((a) => a.conflict);
  const covered = !!picking || props.listsOpen;
  useEffect(() => {
    if (!toast || covered || asking) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast, covered, asking]);

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
  const { route, visits, unplaced, notSold, byClue } = useMemo(() => {
    const { stops, unplaced, notSold, byClue } = groupIntoStops(items, locate);
    // Each shelf or area is picked up in one pass, walked end to end.
    const route = planGroupedRoute(position, stops, layout.checkout, floor.distance, (st) => {
      const place = layout.places.find((p) => p.id === st.placeId);
      if (!place) return 0;
      const alongX = place.kind === 'shelf' ? place.orientation === 'horizontal' : place.w >= place.h;
      return alongX ? st.point.x * 1000 + st.point.y : st.point.y * 1000 + st.point.x;
    });
    return { route, visits: groupVisits(route), unplaced, notSold, byClue };
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

  // List order: nearest, category, or A–Z (route order was removed — same results as nearest).
  const listSort = resolveListSort(props.display);
  // What each shopping row shows (⚙ view settings).
  const showCats = props.display.listCategories ?? true;
  const groupByCategory = props.display.listGroupByCategory ?? false;
  const showQty = props.display.listQty ?? true;
  const showPrice = props.display.listPrice ?? false;
  const showLocation = props.display.listLocation ?? true;
  /** Section headings under categories (sort-by-category, or the group toggle). */
  const showCatHeads = groupByCategory || listSort === 'category';
  /** An item's category and subcategory names. */
  const catsOf = (item: ListItem): { top?: string; sub?: string } => {
    const id = productFor(item, catalog)?.categoryId;
    const c = id ? catalog.categoryById.get(id) : undefined;
    if (!c) return {};
    const top = catalog.categoryById.get(catalog.topOf(c.id));
    return top && top.id !== c.id ? { top: top.name, sub: c.name } : { top: c.name };
  };
  /** The second line; when grouped by category, skip appending the category (it's a heading). */
  const withCat = (line: string | undefined, item: ListItem) => {
    if (!showCats || showCatHeads) return line;
    const c = catsOf(item);
    const cat = c.sub ?? c.top;
    return [line, cat].filter(Boolean).join(' · ') || undefined;
  };
  const nearestFirst = useMemo(() => {
    if (listSort !== 'nearest') return [];
    const rows = route
      .flatMap((st, order) => st.items.map((item) => {
        const id = productFor(item, catalog)?.categoryId;
        return { item, stop: st, order, d: floor.distance(position, st.point), catOrder: id ? orderOf(id) : 10_000 };
      }));
    rows.sort((a, b) => {
      if (groupByCategory && a.catOrder !== b.catOrder) return a.catOrder - b.catOrder;
      return a.d - b.d || a.order - b.order;
    });
    return rows;
  }, [listSort, route, floor, position, catalog, groupByCategory]);

  /** Flat waiting items for category / A–Z sorts (on-route, by-clue, and unplaced). */
  const flatSorted = useMemo(() => {
    if (listSort !== 'category' && listSort !== 'alpha') return [] as { item: ListItem; sub?: string }[];
    const rows: { item: ListItem; sub?: string; catOrder: number; name: string }[] = [];
    for (const st of route) {
      for (const item of st.items) {
        const id = productFor(item, catalog)?.categoryId;
        rows.push({ item, sub: withCat(st.label, item), catOrder: id ? orderOf(id) : 10_000, name: item.name });
      }
    }
    for (const b of byClue) {
      const id = b.categoryId ?? productFor(b.item, catalog)?.categoryId;
      const line = b.clue ? describeClue(b.clue) : id ? (showCats && !showCatHeads ? `${noShelfText(id, catalog)} · usually ${typicalWhere(id, catalog)}` : noShelfText(id, catalog)) : undefined;
      rows.push({ item: b.item, sub: withCat(line, b.item), catOrder: id ? orderOf(id) : 10_000, name: b.item.name });
    }
    for (const item of unplaced) {
      const id = productFor(item, catalog)?.categoryId;
      rows.push({ item, sub: withCat('No place yet', item), catOrder: id ? orderOf(id) : 10_000, name: item.name });
    }
    rows.sort((a, b) => {
      // Group toggle (or sort-by-category): keep categories together in walking order.
      if (showCatHeads && a.catOrder !== b.catOrder) return a.catOrder - b.catOrder;
      if (listSort === 'alpha') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.catOrder - b.catOrder;
      return a.catOrder - b.catOrder || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return rows.map(({ item, sub }) => ({ item, sub }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listSort, route, byClue, unplaced, catalog, showCats, showCatHeads]);

  const learnPrice = (item: ListItem, patch: ItemPatch) => {
    const product = productFor({ ...item, ...patch }, catalog);
    if (!product) return;
    // Clearing the list price keeps the remembered store price.
    if ('price' in patch) {
      if (patch.price === undefined) return;
      props.setProductPrice(product.id, patch.price, patch.unit ?? item.unit);
      return;
    }
    // Unit change with an existing list price: re-stamp under the new unit.
    if ('unit' in patch && item.price !== undefined) {
      props.setProductPrice(product.id, item.price, patch.unit);
    }
  };

  const patchItem = (item: ListItem, patch: ItemPatch) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...patch } : i)));
    setMenuFor((m) => (m && m.id === item.id ? { ...m, ...patch } : m));
    learnPrice(item, patch);
  };

  const rowPriceCue = (item: ListItem) =>
    priceCue(productFor(item, catalog), layout.id, props.layouts, item.price);

  const onList = useMemo(
    () => new Set(items.filter((i) => !i.done).map((i) => productFor(i, catalog)?.id).filter(Boolean) as string[]),
    [items, catalog],
  );
  const done = items.filter((i) => i.done);
  // Everything's in the cart (apart from things this store doesn't sell).
  const tripDone = done.length > 0 && items.every((i) => i.done || notSold.includes(i));
  const tripMinutes = props.where.trip ? Math.round((props.where.trip.last - props.where.trip.first) / 60000) : undefined;
  const here = placeAt(layout, position);
  // Where the shopper is standing, as an exact spot (side = the lane they're in).
  const hereKey = here ? exactKey(here.id, exactSpotAt(here, position.x + 0.5, position.y + 0.5)) : undefined;
  const hereLabel = hereKey ? resolveSpot(hereKey, layout, catalog)?.label : undefined;

  /** Adds from the add window. Things put in the cart may ask where they are, so those show a toast. */
  function addNames(names: string[], mode: 'list' | 'cart'): QuickAddResult | undefined {
    const targetList = props.lists.current;
    if (building && mode === 'cart' && targetList === props.lists.current) {
      // Build mode: into the cart where you're standing (one at a time: the map builds around it).
      const outcome = props.build.pickUpHere(names[names.length - 1]);
      setNote(outcome);
      return { snapshot: outcome.snapshot, added: [] };
    }
    const result = props.quickAddTo(targetList, names, mode, targetList === props.lists.current ? hereKey : undefined);
    if (mode === 'cart') {
      // Put straight in the cart with no place here: quiet-save a clear guess, else ask.
      const unplaced = result.added.filter((a) => {
        if (!a.itemId || a.savedAt || a.conflict) return false;
        const p = catalog.productById.get(a.productId);
        return !p?.locations?.[layout.id] && !p?.clues?.[layout.id];
      });
      if (props.where.ask && unplaced.length) {
        const asItem = (a: QuickAddResult['added'][number]): ListItem => ({ id: a.itemId!, name: a.name, productId: a.productId, done: true });
        const first = askAtCheckout ? undefined : unplaced[0];
        const rest = askAtCheckout ? unplaced : unplaced.slice(1);
        if (first) {
          const item = asItem(first);
          const auto = autoPlaceFor(item);
          if (auto) {
            quietSavePlace(item, auto);
          } else {
            setToast({ ...result, mode });
            if (whereBarFor) setLaterHere((ids) => [...ids.filter((id) => id !== whereBarFor.id), whereBarFor.id]);
            setWhereBarFor(item);
          }
        } else {
          setToast({ ...result, mode });
        }
        if (rest.length) setLaterHere((ids) => [...ids.filter((id) => !rest.some((r) => r.itemId === id)), ...rest.map((r) => r.itemId!)]);
      } else {
        setToast({ ...result, mode });
      }
    }
    return result;
  }

  function toggle(item: ListItem) {
    if (building && !item.done) {
      // Build mode: picked up where you're standing; the map grows around it.
      setNote(props.build.pickUpHere(item.name, item.id));
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    props.where.notePick(item, !item.done);
    // Nothing saved about where it is in this store yet: auto-save a clear guess, else ask.
    const ask = needsPlace(item);
    // Only advance the pin to the item when we're not about to ask "Where was it?".
    // Jumping first made "Where I'm standing" save at the item's old/inferred place.
    const loc = locate(item);
    if (!item.done && !ask && loc.kind === 'spot') setPosition(loc.spot.point);
    if (!item.done && props.where.ask && ask && askAtCheckout) {
      setLaterHere((ids) => [...ids.filter((id) => id !== item.id), item.id]);
    } else if (!item.done && props.where.ask && ask) {
      const auto = autoPlaceFor(item);
      if (auto) {
        quietSavePlace(item, auto);
        return;
      }
      // Not answered the last one? It waits for later; this one takes the bar.
      if (whereBarFor && whereBarFor.id !== item.id) setLaterHere((ids) => [...ids.filter((id) => id !== whereBarFor.id), whereBarFor.id]);
      setWhereBarFor(item);
    }
  }

  /**
   * A clear one-tap place: single map spot for this kind, or the aisle the
   * trail predicts when it matches exactly one map spot. Undefined → ask.
   */
  function autoPlaceFor(item: ListItem): MapSpot | undefined {
    const p = productFor(item, catalog);
    // Cleared on purpose (testing / "Clear where…"): ask again, don't re-apply the map guess.
    if (p?.clearedAt?.includes(layout.id) || p?.mapClues?.[layout.id]) return undefined;
    // Shelf-code stores: keep the one-tap next-shelf chips — don't quiet-save onto a home shelf.
    if (layout.labels) return undefined;
    const spots = mapSpotsFor(item);
    if (spots.length === 1) return spots[0];
    // One clear home for this kind on the map (e.g. cereal already on aisle 3) — even when
    // nearby aisles are also offered as chips.
    if (p?.categoryId) {
      const home = homeOfKind(p.categoryId);
      if (home) {
        const atHome = spots.filter((s) => s.label === home || s.label.startsWith(`${home},`));
        if (atHome.length === 1) return atHome[0];
      }
    }
    const predicted = nextAisles(aisleTrail)[0];
    if (!predicted || spots.length < 2) return undefined;
    const match = spots.filter((s) => s.clue && 'aisle' in s.clue && s.clue.aisle === predicted);
    return match.length === 1 ? match[0] : undefined;
  }

  /** Saves a high-confidence place without opening WhereBar; Undo + Change on the toast. */
  function quietSavePlace(item: ListItem, spot: MapSpot) {
    if (spot.spot) {
      const product = productFor(item, catalog);
      if (!product) return;
      const snapshot = { items, products: catalog.products };
      props.setProductLocation(product.id, spot.spot);
      setToast({
        snapshot, added: [], mode: 'list',
        note: `${item.name}: saved at ${spot.label}`,
        action: { label: 'Change', run: () => setWhereBarFor(item) },
      });
      return;
    }
    if (!spot.clue) return;
    const snapshot = props.where.setClue(item, spot.clue);
    setLastClue(spot.clue);
    noteTrail(spot.clue);
    setToast({
      snapshot, added: [], mode: 'list',
      note: `${item.name}: saved at ${spot.label}`,
      action: { label: 'Change', run: () => setWhereBarFor(item) },
    });
  }
  /** No place of its own here (none saved or answered): worth a "Where was it?", even if the map has its kind. */
  function needsPlace(item: ListItem) {
    return isUnknownHere(item) || !!knownByCategory(item);
  }
  /** Where the map puts an item with no answer of its own, by its kind (the one place that stocks it); else undefined. */
  function knownByCategory(item: ListItem): string | undefined {
    const p = productFor(item, catalog);
    if (p?.locations?.[layout.id] || p?.clues?.[layout.id] || p?.mapClues?.[layout.id] || p?.clearedAt?.includes(layout.id) || !p?.categoryId) return undefined;
    return homeOfKind(p.categoryId);
  }

  // ---- "Where was it?" ----
  const [whereFor, setWhereFor] = useState<ListItem | null>(null);
  /** The item the quick "Where was it?" bar is asking about (at check-off). */
  const [whereBarFor, setWhereBarFor] = useState<ListItem | null>(null);
  /** Main-map taps / pulsing selection while PlaceOnMap is open (large 🗺 view). */
  const [placeMap, setPlaceMap] = useState<PlaceMapController | null>(null);
  // Items to ask about later (per store), and the last answer (for "Same as last").
  const [askLater, setAskLater] = usePersistentState<Record<string, string[]>>('aw.askLater', {});
  const [lastClue, setLastClue] = useState<Clue>();
  /** Aisle numbers answered this trip, in order (to guess the next one). */
  const [aisleTrail, setAisleTrail] = useState<string[]>([]);
  const noteTrail = (clue: Clue) => {
    if ('aisle' in clue && clue.aisle) setAisleTrail((t) => [...t.slice(-5), clue.aisle!]);
  };

  // Trip end: apply clear door / shelf-extend guesses quietly (Undo on the toast).
  // Wait until the last check-off quiz is done so its toast doesn't overwrite this one.
  const tripAutoKey = useRef<string>();
  useEffect(() => {
    if (!tripDone || whereBarFor) {
      if (!tripDone) tripAutoKey.current = undefined;
      return;
    }
    const doorGuess = props.where.door?.guess;
    const due = props.shelves.due[0];
    const key = `${layout.id}:${doorGuess ?? ''}:${due ? endKey(due.placeId, due.end) : ''}`;
    if (tripAutoKey.current === key) return;
    tripAutoKey.current = key;
    const notes: string[] = [];
    let snapshot: Snapshot | undefined;
    if (doorGuess !== undefined) {
      const s = props.where.setDoor(doorGuess);
      if (s) {
        snapshot = s;
        notes.push('Door set from where trips start');
      }
    }
    if (due) {
      const s = props.shelves.extend(due);
      if (s) {
        snapshot = s;
        notes.push(`“${due.label}” extended ${due.by} square${due.by === 1 ? '' : 's'} ${due.way}`);
      }
    }
    if (notes.length && snapshot) {
      setToast({ snapshot, added: [], mode: 'list', note: notes.join(' · ') });
    }
  }, [tripDone, whereBarFor, layout.id, props.where, props.shelves]);
  /** Setting up the store's shelf labels, from a label just typed (and the item it's for). */
  /** The departments screen is open (from the trip-done card: closing it means don't offer again). */
  const [wallsOpen, setWallsOpen] = useState<'trip' | 'settings' | null>(null);
  const [labelSetup, setLabelSetup] = useState<{ code?: string; item?: ListItem } | null>(null);
  /**
   * Worth asking about: no saved place and no answer for this store, and the
   * map can't already place it (its category isn't stocked in exactly one place).
   */
  function isUnknownHere(item: ListItem) {
    const p = productFor(item, catalog);
    if (p?.locations?.[layout.id] || p?.clues?.[layout.id]) return false;
    if (p?.mapClues?.[layout.id] || p?.clearedAt?.includes(layout.id)) return true; // (testing aid) its place was cleared: ask again
    const cat = p?.categoryId;
    return !(cat && homeOfKind(cat));
  }
  /**
   * The one place the map stocks a kind of thing, if there's just one: a shelf or area, or both shelves of one
   * aisle (said to be in that aisle, side not given), or the halves of a shelf split by a walkway.
   */
  function homeOfKind(cat: string): string | undefined {
    // Live parent: a subcategory (Nut Butters → Condiments) finds its department shelf.
    const at = catalog.homesOf(layout.places, cat);
    const group = (id: string) => id.replace(/~\d+$/, '').replace(/^(g-shelf-.+)-[LR]$/, '$1');
    const groups = [...new Set(at.map((pl) => group(pl.id)))];
    if (groups.length !== 1 || !at.length) return undefined;
    const aisle = /^g-shelf-(.+)$/.exec(groups[0])?.[1];
    return aisle && at.length > 1 ? `Aisle ${aisle}` : at[0].label || 'on the map';
  }
  // At this store: ask in one list at checkout, not as you go.
  const askAtCheckout = !!props.display.askAtCheckout?.includes(layout.id);
  const setAskAtCheckout = (on: boolean) => props.setDisplay((d) => ({
    ...d, askAtCheckout: [...(d.askAtCheckout ?? []).filter((id) => id !== layout.id), ...(on ? [layout.id] : [])],
  }));
  const [listOpen, setListOpen] = useState(false);
  // Things the map has only guessed the place of: asked one at a time, relative to what's on the map.
  // In the editor, only blocks are asked about (made with "New block").
  // Questions about where things go belong to shopping and map editing, not the Stores overview.
  const pending = useMemo(
    () => (role === 'stores' && !building ? [] : pendingPlacements(layout, catalog.products).filter((sub) => !building || isBlock(sub))),
    [layout, catalog.products, building, role],
  );
  const [placeLater, setPlaceLater] = useState<string[]>([]);
  /** A block the shopper asked to place (Store settings → Place…). */
  const [placeAsked, setPlaceAsked] = useState<string>();
  const asked = placeAsked ? blockSubject(layout, placeAsked) : undefined;
  const placing = asked ?? pending.find((sub) => !placeLater.includes(sub.ref));
  const laterHere = (askLater[layout.id] ?? [])
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is ListItem => !!i && needsPlace(i));
  const setLaterHere = (fn: (ids: string[]) => string[]) =>
    setAskLater((prev) => ({ ...prev, [layout.id]: fn(prev[layout.id] ?? []) }));
  /** After answering (or skipping), the next one waiting, if reviewing the ask-later list. */
  function nextWhere(after: ListItem) {
    const rest = laterHere.filter((i) => i.id !== after.id);
    setLaterHere((ids) => ids.filter((id) => id !== after.id));
    setWhereFor(reviewing && rest.length ? rest[0] : null);
    if (!rest.length) setReviewing(false);
  }
  const [reviewing, setReviewing] = useState(false);
  function saveWhere(item: ListItem, clue: Clue) {
    if (whereBarFor?.id === item.id) setWhereBarFor(null);
    const snapshot = props.where.setClue(item, clue);
    setLastClue(clue);
    noteTrail(clue);
    // A table, case or stand said like one something else is on: the same one, unless the shopper says another.
    const twin = clue.kind === 'open' && !clue.across ? sameKindOfOpen(item, clue) : undefined;
    setToast({
      snapshot, added: [], mode: 'list',
      note: twin ? `${item.name}: ${describeClue(clue)} — same one as ${twin.name}` : `${item.name}: ${describeClue(clue)}`,
      ...(twin && clue.kind === 'open' && { action: { label: 'Another one', run: () => {
        const another: Clue = { ...clue, n: twin.top + 1 };
        props.where.setClue(item, another);
        setToast({ snapshot, added: [], mode: 'list', note: `${item.name}: ${describeClue(another)}` });
      } } }),
    });
    nextWhere(item);
  }
  /** Another item said to be on a table, case or stand described the same way (and how many such there are). */
  function sameKindOfOpen(item: ListItem, clue: Extract<Clue, { kind: 'open' }>): { name: string; top: number } | undefined {
    const mine = productFor(item, catalog)?.id;
    const base = islandKey({ ...clue, n: undefined });
    const alike = catalog.products.filter((p) => {
      const c = p.clues?.[layout.id];
      return p.id !== mine && c?.kind === 'open' && !c.across && islandKey({ ...c, n: undefined }) === base;
    });
    const nOf = (p: Product) => { const c = p.clues![layout.id]; return c.kind === 'open' ? c.n ?? 1 : 1; };
    const same = alike.find((p) => nOf(p) === (clue.n ?? 1));
    if (!same) return undefined;
    return { name: same.name, top: Math.max(...alike.map(nOf)) };
  }

  const removeWithUndoOne = (item: ListItem) => removeWithUndo([item]);

  /**
   * Where the map already has an item's kind of thing (canned goods on 3L, vegetables in Produce): one-tap
   * answers for "Where was it?". Both shelves of an aisle make one "Aisle 3"; tables and stands aren't offered
   * (they hold a few things this week, not the kind).
   */
  function mapSpotsFor(item: ListItem): MapSpot[] {
    const cat = productFor(item, catalog)?.categoryId;
    if (!cat) return [];
    const top = catalog.topOf(cat);
    const shelves = layout.places.filter((p) => !p.id.startsWith('g-open-') && !p.display);
    // Its kind (live parent → top shelf); else nearby kinds from the same top; else a display.
    const own = catalog.stocking(shelves, cat);
    const near = own.length ? own : catalog.nearbyKinds(shelves, cat);
    const at = near.length ? near : catalog.stocking(layout.places, cat).filter((p) => !p.id.startsWith('g-'));
    const out: MapSpot[] = [];
    const add = (s: MapSpot) => { if (!out.some((o) => o.key === s.key)) out.push(s); };
    for (const p of at) {
      const shelf = /^g-shelf-(.+)-([LR])(?:~\d+)?$/.exec(p.id);
      const sec = /^g-sec-(.+)-(\d+)(?:~\d+)?$/.exec(p.id);
      const dept = /^g-dept-(\w+)$/.exec(p.id);
      const wall = /^g-wall-(left|right|back)-(chilled|frozen|shelf)$/.exec(p.id);
      const front = /^g-wall-front-(left|right)-/.exec(p.id);
      if (shelf) {
        const [, n, side] = shelf;
        const both = at.some((o) => o.id.replace(/~\d+$/, '') === `g-shelf-${n}-${side === 'L' ? 'R' : 'L'}`);
        if (both) add({ key: `a${n}`, label: `Aisle ${n}`, clue: { kind: 'aisle', aisle: n } });
        else add({ key: `a${n}${side}`, label: `Aisle ${n}, ${side === 'L' ? 'left' : 'right'}`, clue: { kind: 'aisle', aisle: n, side: side as 'L' | 'R' } });
      } else if (sec) {
        add({ key: `s${p.label}`, label: p.label, clue: { kind: 'shelf', code: p.label, section: sec[1], shelf: Number(sec[2]) } });
      } else if (dept) {
        add({ key: `d${dept[1]}`, label: p.label, clue: { kind: 'dept', dept: dept[1] as Dept } });
      } else if (wall) {
        const temp = wall[2] === 'shelf' ? undefined : (wall[2] as Temp);
        add({ key: `w${wall[1]}${wall[2]}`, label: `${p.label} (${wall[1]} wall)`, clue: { kind: 'wall', wall: wall[1] as Wall, ...(temp && { temp }) } });
      } else if (front) {
        add({ key: `f${front[1]}`, label: `${p.label} (front, ${front[1]} of the door)`, clue: { kind: 'wall', wall: 'front', part: front[1] as 'left' | 'right' } });
      } else if (!p.id.startsWith('g-')) {
        add({ key: `p${p.id}`, label: p.label || (p.kind === 'shelf' ? 'Shelf' : 'Area'), spot: `${p.id}:${top}` });
      }
    }
    return out;
  }
  /** "Where I'm standing": builds the choice there (straight away, with Undo) and saves the item on it. */
  function placeHereFor(item: ListItem, o: HereOption, at?: Point) {
    const product = productFor(item, catalog);
    if (!product) return;
    const r = props.here.place(product.id, o, at);
    if (!r) { setToast({ snapshot: { items, products: catalog.products }, added: [], mode: 'list', note: 'No room for that here.' }); return; }
    if (whereBarFor?.id === item.id) setWhereBarFor(null);
    setToast({ snapshot: r.snapshot, added: [], mode: 'list', note: `${item.name}: ${r.note}` });
    nextWhere(item);
  }
  /** Open-floor confirm: build the best choice at that cell and save the item there. */
  function saveFloorAt(item: ListItem, at: Point) {
    setPosition(at);
    const opts = hereOptions(layout, at).filter((o) => o.kind !== 'turn');
    const choice = opts[0] ?? ({ kind: 'area', label: 'New area' } as HereOption);
    placeHereFor(item, choice, at);
  }
  /** Saves a place drawn by hand as where an item is here; stocks the place with the item’s category. */
  function savePlace(item: ListItem, spotKey: string) {
    const product = productFor(item, catalog);
    if (whereBarFor?.id === item.id) setWhereBarFor(null);
    if (!product) return;
    const snapshot = { items, products: catalog.products };
    const placeId = spotKey.split(/[:@]/)[0];
    const place = layout.places.find((p) => p.id === placeId);
    const cat = product.categoryId;
    if (place && cat) {
      const own = place.own ?? place.categories;
      if (!own.includes(cat)) props.build.updatePlace(placeId, { categories: [...own, cat] });
    }
    props.setProductLocation(product.id, spotKey);
    const label = place?.label
      || resolveSpot(spotKey, layout, catalog)?.label
      || 'saved';
    setToast({ snapshot, added: [], mode: 'list', note: `${item.name}: ${label}` });
    nextWhere(item);
  }

  // ---- Clearing where things are (strip + per-row ⊘; testing the map) ----
  /** Whether the list shows a place for it here: saved, answered, or placed by its kind. */
  const hasWhereHere = (item: ListItem) => {
    const p = productFor(item, catalog);
    return !!(p?.locations?.[layout.id] || p?.clues?.[layout.id]) || locate(item).kind === 'spot';
  };
  function clearOneWhere(item: ListItem) {
    const snapshot = props.where.clearWhere([item]);
    setToast({ snapshot, added: [], mode: 'list', note: `Forgot where ${item.name} is at ${layout.name}.` });
  }

  /** Takes items off the list, with Undo. */
  function removeWithUndo(gone: ListItem[]) {
    if (!gone.length) return;
    const snapshot = props.listSnapshot();
    const ids = new Set(gone.map((i) => i.id));
    setItems((prev) => prev.filter((i) => !ids.has(i.id)));
    setToast({ snapshot, added: [], mode: 'list', note: gone.length === 1 ? `Removed ${gone[0].name} from the list.` : `Removed ${gone.length} items from the list.` });
  }

  function newTrip() {
    const snapshot = props.listSnapshot();
    const n = items.filter((i) => i.done).length;
    props.where.newTrip();
    setWhereBarFor(null); // its item is leaving with the cart
    setAisleTrail([]);
    setItems((prev) => prev.filter((i) => !i.done));
    setPosition(layout.entrance);
    setToast({ snapshot, added: [], mode: 'list', note: `Cart cleared (${n} item${n === 1 ? '' : 's'}). Ready for next time.` });
  }

  const listNameOf = (id: string) => props.lists.all.find((l) => l.id === id)?.name ?? id;
  const tripMulti = (props.lists.shopWith?.length ?? 0) > 0;
  const sourceBadges = (item: ListItem): string[] | undefined => {
    if (!tripMulti || !props.tripSourcesOf) return undefined;
    const ids = props.tripSourcesOf(item);
    if (ids.length < 2 && ids[0] === props.lists.current) return undefined;
    return ids.map(listNameOf);
  };

  // --- Drag an item onto a new location (map or stop card) ---
  /** What's under the finger: an exact spot on the map, or a stop in the list. */
  /** The last drop spot found past a shelf's end. */
  const droppedPast = useRef<{ key: string; placeId: string; end: 'start' | 'end'; to: number }>();
  const dropKeyAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    const svg = el?.closest('svg.map') as SVGSVGElement | null;
    if (svg) {
      const g = toGrid(svg, x, y);
      const place = placeUnder(layout, g.x, g.y);
      const cell = { x: Math.floor(g.x), y: Math.floor(g.y) };
      // Just past a shelf's end, lined up with it: on the shelf's end square (and a sign the shelf runs further).
      const past = place && contains(footprint(place), cell) ? undefined : pastEnd(layout, cell);
      if (place && (!past || past.shelf.id !== place.id)) return exactKey(place.id, exactSpotAt(place, g.x, g.y));
      if (!past) return undefined;
      const key = exactKey(past.shelf.id, { u: past.end === 'start' ? 0 : 1, v: 0.5 });
      droppedPast.current = { key, placeId: past.shelf.id, end: past.end, to: past.to };
      return key;
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
      const past = droppedPast.current;
      if (key && past?.key === key) {
        props.shelves.notePastEnd({ placeId: past.placeId, end: past.end, to: past.to, item: productFor(drag.item, catalog)?.name ?? drag.item.name, at: Date.now() });
      }
      droppedPast.current = undefined;
      setDrag(null);
    },
    onPointerCancel() {
      setDrag(null);
    },
  });

  const overSpot = drag?.over ? resolveSpot(drag.over, layout, catalog) : undefined;
  // Wide layout always shows the map in a side column; phones hide it until place/setup/🗺.
  const [wideShop, setWideShop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const sync = () => setWideShop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const mapForced = !!whereBarFor || !!setupKind;
  const mapView = resolveMapView(props.display);
  const mapOpen = mapForced || wideShop || mapView !== 'off';
  // While shopping the map is a strip showing you and your next stop (🗺 for the whole map); building shows it all.
  // While placing an item, always show the whole map so taps hit shelves clearly on a phone.
  // Wide side-by-side uses the full map in the map column (strip is phone-only when map is shown).
  const mapStrip = role === 'shop' && !building && !wideShop && mapView === 'strip' && !whereBarFor && !setupKind;
  /** The Stores screen shows the whole map as a plain picture (no you-are-here, items or taps). */
  const mapPreview = role === 'stores' && !building;

  const toolInfo = TOOLS.find((t) => t.id === tool)!;
  const toolTitle = editing ? (editing.label || (editing.kind === 'shelf' ? 'Shelf' : 'Area'))
    : editingAisle ? (editingAisle.label || 'Aisle')
      : chosenAisles.length ? selectionTitle(chosenAisles)
        : toolInfo.label;
  const toolHint = editing || editingAisle ? 'Name, what’s stocked, fridge or freezer: tap to open.' : toolInfo.hint;

  const storeMap = (
          <StoreMap
            layout={layout}
            you={mapPreview ? undefined : position}
            view={building ? zoom.rect : undefined}
            focus={!building && mapStrip ? (changeFocus ? stripFocus(layout, changeFocus.a, changeFocus.b) : stripFocus(layout, position, route[0]?.point)) : undefined}
            dots={mapPreview ? undefined : mapDots}
            pins={mapPreview ? undefined : pins}
            ghosts={mapPreview ? undefined : ghosts}
            look={props.mapLook}
            showGrid={building}
            highlightId={here?.id}
            pendingId={whereBarFor ? placeMap?.pendingId : undefined}
            pendingAt={whereBarFor ? placeMap?.pendingAt : undefined}
            selectedId={editing?.id}
            selectedAisleId={editingAisle?.id}
            selectedAisleIds={chosenAisles}
            onAisleTap={building && tool === 'walk' ? (id) => { aisleTapped.current = id; } : undefined}
            ref={svgRef}
            onMapTap={blocking || draftingArea || cutting || selecting || mapPreview ? undefined
              : whereBarFor && placeMap ? (x, y, place) => {
                  const cell = floor.snap({ x: Math.floor(x), y: Math.floor(y) });
                  setPosition(cell);
                  // Keep fractional coords so confirm saves the exact tap on the shelf/area.
                  placeMap.tapPlace(place, { x, y });
                }
                : building ? buildTap
                  : (x, y) => {
                      const cell = floor.snap({ x: Math.floor(x), y: Math.floor(y) });
                      setPosition(cell);
                    }}
            onPlacePointerDown={building && tool === 'walk' ? (place, e) => {
              if (place.id === editing?.id) beginMapDrag({ mode: 'move', id: place.id, start: cellOf(e), orig: place, snapshot: props.build.snapshot(), moved: false }, e);
            } : undefined}
            svgProps={blocking ? { className: 'map drawing', ...block.svgHandlers } : draftingArea ? {
              className: 'map drawing',
              ...areaDraft.svgHandlers,
            } : selecting ? {
              className: 'map drawing',
              ...selectSvgHandlers,
            } : cutting ? {
              className: 'map drawing',
              onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => { setCutWidth(undefined); cutDrag.down(e); },
              onPointerMove: cutDrag.move, onPointerUp: cutDrag.up, onPointerCancel: cutDrag.up,
            } : building ? {
              className: `map tappable${tool !== 'walk' || editing ? ' build-editing' : ''}`,
              onPointerMove: onMapDragMove,
              onPointerUp: endMapDrag,
              onPointerCancel: endMapDrag,
            } : whereBarFor ? { className: 'map tappable placing-map' }
              : !mapStrip ? { className: 'map tappable' }
                : { className: 'map strip tappable' }}
          >
            {selecting && selectDrag.rect && !selectMove.current && (
              <rect className="map-select-outline" x={selectDrag.rect.x} y={selectDrag.rect.y} width={selectDrag.rect.w} height={selectDrag.rect.h} />
            )}
            {cutting && cutBox && (
              <rect className="map-cut-outline" x={cutBox.x} y={cutBox.y} width={cutBox.w} height={cutBox.h} />
            )}
            {blocking && block.rect && (
              <rect className="map-block-outline" x={block.rect.x} y={block.rect.y} width={block.rect.w} height={block.rect.h} />
            )}
            {blocking && block.corners.map(({ corner, x, y }) => (
              <circle key={corner} className="block-corner-handle" cx={x + 0.5} cy={y + 0.5} r={0.7}
                aria-label={`Resize block ${corner}`}
                onPointerDown={(e) => block.beginCorner(corner, e)} />
            ))}
            {draftingArea && areaDraft.rect && (
              <rect className="map-block-outline" x={areaDraft.rect.x} y={areaDraft.rect.y} width={areaDraft.rect.w} height={areaDraft.rect.h} />
            )}
            {draftingArea && areaDraft.corners.map(({ corner, x, y }) => (
              <circle key={corner} className="block-corner-handle" cx={x + 0.5} cy={y + 0.5} r={0.7}
                aria-label={`Resize area ${corner}`}
                onPointerDown={(e) => areaDraft.beginCorner(corner, e)} />
            ))}
            {building && tool === 'walk' && (['entrance', 'checkout'] as const).map((which) => (
              <rect key={which} className="marker-hit" x={layout[which].x - 0.5} y={layout[which].y - 0.5} width={2} height={2}
                onPointerDown={(e) => beginMapDrag({ mode: which, start: cellOf(e), snapshot: props.build.snapshot(), moved: false }, e)} />
            ))}
            {building && tool === 'walk' && editing?.kind === 'shelf' && (() => {
              const h = handlePoint(editing);
              return (
                <circle className="resize-handle" cx={h.x} cy={h.y} r={1.2} aria-label="Resize"
                  onPointerDown={(e) => beginMapDrag({ mode: 'resize', id: editing.id, start: cellOf(e), orig: editing, snapshot: props.build.snapshot(), moved: false }, e)} />
              );
            })()}
            {building && tool === 'walk' && editing?.kind === 'area' && (['nw', 'ne', 'sw', 'se'] as BlockCorner[]).map((corner) => {
              const f = footprint(editing);
              const pt = areaCornerCell(f, corner);
              return (
                <circle key={corner} className="block-corner-handle" cx={pt.x + 0.5} cy={pt.y + 0.5} r={0.7}
                  aria-label={`Resize area ${corner}`}
                  onPointerDown={(e) => beginMapDrag({
                    mode: 'area-corner', id: editing.id, corner, fixed: areaCornerCell(f, areaOpposite(corner)),
                    orig: editing, snapshot: props.build.snapshot(), moved: false,
                  }, e)} />
              );
            })}
          </StoreMap>
  );
  const listMain = (
      <main>
        {laterHere.length > 0 && !tripDone && (
          <button className={`later-chip${items.every((i) => i.done) ? ' trip-done' : ''}`} onClick={() => setListOpen(true)}>
            <Icon name="map-pinned" /> {laterHere.length} to place{items.every((i) => i.done) ? ' before you go' : ''} · <b>Review</b>
          </button>
        )}
        {items.length === 0 && (
          <div className="empty">
            <EmptyArt name="shopping-cart" />
            <p>Your list is empty.</p>
            <p className="muted">
              Type below to add what you need. The list sorts itself into the shortest walk through the store and re-sorts as you move.
            </p>
            <button
              type="button"
              className="btn primary"
              onClick={() => document.querySelector<HTMLInputElement>('input[aria-label="Item to add"]')?.focus()}
            >Add your first item</button>
            <button className="link" onClick={onEditLayout}>Set up your store map</button>
          </div>
        )}

        {listSort === 'nearest' && nearestFirst.length > 0 && (
          <section className="card flat-list">
            <div className="stop-head">
              <h3>Nearest first</h3>
              <span className="muted small count-pill">{nearestFirst.length} item{nearestFirst.length === 1 ? '' : 's'}</span>
            </div>
            <ItemRows
              onClearWhere={clearOneWhere}
              clearable={hasWhereHere}
              items={nearestFirst.map((e) => e.item)}
              onToggle={toggle}
              onRemove={removeWithUndoOne}
              onMenu={setMenuFor}
              onPatch={!building ? patchItem : undefined}
              simple={!building}
              showQty={showQty}
              showPrice={showPrice}
              showLocation={showLocation}
              priceOf={showPrice ? rowPriceCue : undefined}
              onNotHere={(i) => markAvailable(i, false)}
              drag={building ? dragHandlers : undefined}
              dragging={drag?.item.id}
              iconOf={iconOf}
              pinned={pinned}
              headingOf={showCatHeads ? catsOf : undefined}
              badgesOf={sourceBadges}
              subOf={(item) => withCat(nearestFirst.find((e) => e.item.id === item.id)?.stop.label, item)}
              tintOf={(item) => { const e = nearestFirst.find((x) => x.item.id === item.id); return e && sectionColor(e.stop); }}
              dropOf={(item) => nearestFirst.find((e) => e.item.id === item.id)?.stop.key}
              firstIsNearest={!showCatHeads}
            />
          </section>
        )}

        {(listSort === 'category' || listSort === 'alpha') && flatSorted.length > 0 && (
          <section className="card flat-list">
            <div className="stop-head">
              <h3>{listSort === 'alpha' ? 'A–Z' : 'By category'}</h3>
              <span className="muted small count-pill">{flatSorted.length} item{flatSorted.length === 1 ? '' : 's'}</span>
            </div>
            <ItemRows
              onClearWhere={clearOneWhere}
              clearable={hasWhereHere}
              items={flatSorted.map((e) => e.item)}
              onToggle={toggle}
              onRemove={removeWithUndoOne}
              onMenu={setMenuFor}
              onPatch={!building ? patchItem : undefined}
              simple={!building}
              showQty={showQty}
              showPrice={showPrice}
              showLocation={showLocation}
              priceOf={showPrice ? rowPriceCue : undefined}
              onNotHere={(i) => markAvailable(i, false)}
              iconOf={iconOf}
              pinned={pinned}
              headingOf={showCatHeads ? catsOf : undefined}
              badgesOf={sourceBadges}
              subOf={(item) => flatSorted.find((e) => e.item.id === item.id)?.sub}
            />
          </section>
        )}

        {listSort === 'nearest' && byClue.length > 0 && (
          <section className="card by-clue">
            <h3>
              {byClue.some((b) => b.clue) ? 'By aisle' : 'In typical store order'}
              <span className="muted small"> · {byClue.some((b) => !b.clue) ? 'until you say where things are' : 'not on the map yet'}</span>
            </h3>
            <ItemRows
              onClearWhere={clearOneWhere}
              clearable={hasWhereHere}
              items={(showCatHeads
                ? [...byClue].sort((a, b) => orderOf(a.categoryId ?? productFor(a.item, catalog)?.categoryId ?? '') - orderOf(b.categoryId ?? productFor(b.item, catalog)?.categoryId ?? '') || a.rank - b.rank)
                : byClue
              ).map((b) => b.item)}
              onToggle={toggle}
              onRemove={removeWithUndoOne}
              onMenu={setMenuFor}
              onPatch={!building ? patchItem : undefined}
              simple={!building}
              showQty={showQty}
              showPrice={showPrice}
              showLocation={showLocation}
              priceOf={showPrice ? rowPriceCue : undefined}
              onNotHere={(i) => markAvailable(i, false)}
              iconOf={iconOf}
              headingOf={showCatHeads ? catsOf : undefined}
              badgesOf={sourceBadges}
              subOf={(item) => {
                const b = byClue.find((x) => x.item.id === item.id);
                if (!b) return undefined;
                if (b.clue) return describeClue(b.clue);
                // With category headings shown, the line doesn't repeat the category.
                return showCatHeads || showCats
                  ? noShelfText(b.categoryId!, catalog)
                  : `${noShelfText(b.categoryId!, catalog)} · usually ${typicalWhere(b.categoryId!, catalog)}`;
              }}
            />
          </section>
        )}

        {listSort === 'nearest' && unplaced.length > 0 && (
          <section className="card unplaced-items" aria-label="Unplaced items">
            <h3 className="off-head">
              Unplaced Items
              {unplaced.length > 1 && <button className="link" onClick={() => removeWithUndo(unplaced)}>Remove all</button>}
            </h3>
            {unplaced.map((item) => (
              <div className="row off-row" key={item.id}>
                <button
                  type="button"
                  className="icon place-on-map-btn"
                  aria-label={`Place ${item.name} on the map`}
                  title="Tap the map twice to place"
                  onClick={() => {
                    setWhereBarFor(item);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                ><Icon name="map-pinned" /></button>
                <span className="handle" aria-label={`Drag ${item.name}`} {...dragHandlers(item)}><Icon name="grip-vertical" /></span>
                <label>
                  <input type="checkbox" checked={false} onChange={() => toggle(item)} aria-label={building ? `Got ${item.name} here` : `Got ${item.name}`} />
                  {iconOf(item) && <span className="item-icon" aria-hidden="true">{iconOf(item)}</span>}
                  <span className="name">{item.name}</span>
                </label>
                <span className="row-actions">
                  <button className="icon" onClick={() => setMenuFor(item)} aria-label={`More options for ${item.name}`}>⋯</button>
                  <button className="icon" onClick={() => removeWithUndo([item])} aria-label={`Remove ${item.name}`}><Icon name="x" /></button>
                </span>
              </div>
            ))}
          </section>
        )}
        {notSold.length > 0 && (
          <details className="card unavailable-section">
            <summary className="off-head">
              <span>Not sold at {layout.name} ({notSold.length})</span>
              {notSold.length > 1 && (
                <button
                  type="button"
                  className="link"
                  onClick={(e) => { e.preventDefault(); removeWithUndo(notSold); }}
                >Remove all</button>
              )}
            </summary>
            <p className="muted small">Get these somewhere else.</p>
            {notSold.map((item) => (
              <div className="row unavailable" key={item.id}>
                <span className="name">{item.name}</span>
                <button className="btn" onClick={() => markAvailable(item, true)}>Sold here</button>
                <button className="icon" onClick={() => removeWithUndo([item])} aria-label={`Remove ${item.name}`}><Icon name="x" /></button>
              </div>
            ))}
          </details>
        )}

        {tripDone && (
          <TripDoneCard
            inCart={done.length}
            minutes={tripMinutes}
            elsewhere={notSold.map((i) => i.name)}
            toPlace={laterHere.map((i) => i.name)}
            onReview={() => setListOpen(true)}
            question={props.where.question}
            onAnswer={(o) => props.where.answer(props.where.question!, o)}
            onClear={newTrip}
            otherLists={props.lists.all
              .filter((l) => l.id !== props.lists.current && (props.lists.counts.get(l.id) ?? 0) > 0)
              .map((l) => ({ id: l.id, name: l.name, toBuy: props.lists.counts.get(l.id) ?? 0 }))}
            onShopList={(id) => props.lists.switchTo(id)}
            walls={offerWalls(layout) ? () => setWallsOpen('trip') : undefined}
          />
        )}

        {done.length > 0 && (
          <details className="card done">
            <summary>In the cart ({done.length})</summary>
            <ItemRows
              onClearWhere={clearOneWhere}
              clearable={hasWhereHere}
              items={done}
              onToggle={toggle}
              onRemove={removeWithUndoOne}
              onMenu={setMenuFor}
              onPatch={patchItem}
              iconOf={iconOf}
              simple
              showQty={showQty}
              showPrice={showPrice}
              showLocation={showLocation}
              priceOf={showPrice ? rowPriceCue : undefined}
              badgesOf={sourceBadges}
            />
            <button className="link" onClick={newTrip}>Clear cart and start a new trip</button>
          </details>
        )}
      </main>
  );

  return (
    <>
      {props.listsOpen && role === 'shop' && (
        <ListsSheet
          lists={props.lists}
          onClose={props.onListsClose}
          onCombined={(note, snapshot) => setToast({ snapshot, added: [], mode: 'list', note })}
        />
      )}
      {whereFor && (
        <WherePanel
          key={whereFor.id}
          itemName={whereFor.name}
          categoryId={productFor(whereFor, catalog)?.categoryId}
          storeName={layout.name}
          labels={layout.labels}
          layout={layout}
          onNeedLabels={(code) => setLabelSetup({ code, item: whereFor })}
          recentAisles={aislesUsed(catalog.products, layout.id)}
          lastClue={lastClue}
          queued={reviewing ? Math.max(0, laterHere.filter((i) => i.id !== whereFor.id).length) : undefined}
          onSave={(clue) => saveWhere(whereFor, clue)}
          onLater={reviewing ? undefined : () => { setLaterHere((ids) => [...ids.filter((id) => id !== whereFor.id), whereFor.id]); setWhereFor(null); }}
          onSkip={() => nextWhere(whereFor)}
          onStopAsking={() => { props.where.setAsk(false); setWhereFor(null); setReviewing(false); }}
        />
      )}
      {!building && role === 'stores' && (
        <div className="stores-setup">
          {layout.places.length > 0 ? (
            <div className="map-wrap shop-map store-preview">{storeMap}</div>
          ) : (
            <EmptyArt name="map" />
          )}
          <p className="muted small">
            {layout.places.length > 0
              ? <>{layout.places.length} shelves and areas. The map also learns as you shop; use Edit map to draw or fix it by hand.</>
              : <>This map is empty. It fills in as you check items off, or draw it yourself with Edit map.</>}
          </p>
          <div className="stores-setup-actions">
            <button type="button" className="btn primary" onClick={() => props.setDisplay((d) => ({ ...d, buildMode: true }))}
              aria-label="Edit map"><Icon name="map" /> Edit map</button>
            <button type="button" className="btn" onClick={() => props.onOpenStores?.()}>Change store</button>
            <button type="button" className="btn" onClick={() => props.build.store.shareStore()}><Icon name="share-2" /> Share this store</button>
          </div>
        </div>
      )}
      {!building && role === 'shop' && (
        <div className="shop-columns">
          <div className="shop-map-slot is-open">
            {(items.length > 0 || !!setupKind) && (layout.places.length > 0 || !!setupKind) && (
              mapOpen ? (
                <div className={`map-wrap shop-map${setupKind ? ' setup-map' : ''}`}>
                  {storeMap}
                  {!mapForced && !wideShop && (
                    <div className="map-ctl" role="group" aria-label="Map size">
                      <button
                        type="button"
                        className="map-tool"
                        onClick={() => props.setDisplay((d) => ({ ...d, mapView: mapView === 'full' ? 'strip' : 'full' }))}
                        aria-label={mapView === 'full' ? 'Show less of the map' : 'Show the whole map'}
                      ><Icon name={mapView === 'full' ? 'minimize-2' : 'maximize-2'} /></button>
                      <button
                        type="button"
                        className="map-tool"
                        onClick={() => props.setDisplay((d) => ({ ...d, mapView: 'off' }))}
                        aria-label="Hide the map"
                      ><Icon name="x" /></button>
                    </div>
                  )}
                  {hereLabel && items.length > 0 && (
                    <p className="you-at muted small" aria-live="polite">You’re at {hereLabel}</p>
                  )}
                </div>
              ) : (
                <button type="button" className="link map-show" onClick={() => props.setDisplay((d) => ({ ...d, mapView: 'strip' }))}>
                  <Icon name="map" /> Show map
                </button>
              )
            )}
            {setupKind && (
              <section className="card setup-card" aria-label="Set up the map">
                <p>
                  {setupKind === 'entrance'
                    ? <><Icon name="door-open" /> Tap where the door is on the map</>
                    : blankStep === 'entrance'
                      ? <><Icon name="door-open" /> Tap where you came in</>
                      : blankStep === 'shelf'
                        ? <><span aria-hidden="true">▮ </span>Tap the ghost shelf to place your first aisle</>
                        : <><span aria-hidden="true">▦ </span>Tap to place an open area (produce, endcap…)</>}
                </p>
                <button type="button" className="link" onClick={() => props.where.clearSetup()}>Skip for now</button>
              </section>
            )}
          </div>
          <div className="shop-list-col">
            {listMain}
            <div className="shop-compose" aria-label="Add items">
              <AddItemsSheet
                inline
                listName={props.lists.all.find((l) => l.id === props.lists.current)?.name ?? 'Shopping list'}
                catalog={catalog}
                onList={onList}
                listedAnywhere={new Set([
                  ...[...onList],
                  ...props.lists.all.flatMap((l) => [...props.onListIds(l.id)]),
                ])}
                inCart={new Set(items.filter((i) => i.done).map((i) => productFor(i, catalog)?.id).filter(Boolean) as string[])}
                hereLabel={hereLabel}
                whereText={(p) => whereText(p, layout, catalog)}
                iconOf={(id) => (id ? props.looks.get(id)?.icon : undefined)}
                onAdd={addNames}
                onUndo={props.undo}
                tools={<ListSortToggle display={props.display} setDisplay={props.setDisplay} />}
              />
            </div>
          </div>
        </div>
      )}
      {building && (
        <div className="build-screen" role="region" aria-label="Edit map">
          <div className="build-top">
            <button className="btn primary" onClick={() => props.setDisplay((d) => ({ ...d, buildMode: false }))}>Done</button>
            <span className="build-top-name">{layout.name}</span>
            <button className="btn" onClick={undoLast} disabled={!undoStack.length} aria-label="Undo"><Icon name="undo-2" /> Undo</button>
          </div>
          <div className="build-map" {...zoom.handlers}>
            <div className="map-wrap">
          <StoreMap
              layout={layout}
              you={position}
              view={building ? zoom.rect : undefined}
              focus={!building && mapStrip ? (changeFocus ? stripFocus(layout, changeFocus.a, changeFocus.b) : stripFocus(layout, position, route[0]?.point)) : undefined}
              dots={mapDots}
              pins={pins}
              ghosts={ghosts}
              look={props.mapLook}
              showGrid={building}
              highlightId={here?.id}
              selectedId={editing?.id}
              selectedAisleId={editingAisle?.id}
              selectedAisleIds={chosenAisles}
              onAisleTap={building && tool === 'walk' ? (id) => { aisleTapped.current = id; } : undefined}
              ref={svgRef}
              onMapTap={blocking || draftingArea || cutting || selecting ? undefined : building ? buildTap : (x, y) => setPosition(floor.snap({ x: Math.floor(x), y: Math.floor(y) }))}
              onPlacePointerDown={building && tool === 'walk' ? (place, e) => {
                if (place.id === editing?.id) beginMapDrag({ mode: 'move', id: place.id, start: cellOf(e), orig: place, snapshot: props.build.snapshot(), moved: false }, e);
              } : undefined}
              svgProps={blocking ? { className: 'map drawing', ...block.svgHandlers } : draftingArea ? {
                className: 'map drawing',
                ...areaDraft.svgHandlers,
              } : selecting ? {
                className: 'map drawing',
                ...selectSvgHandlers,
              } : cutting ? {
                className: 'map drawing',
                onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => { setCutWidth(undefined); cutDrag.down(e); },
                onPointerMove: cutDrag.move, onPointerUp: cutDrag.up, onPointerCancel: cutDrag.up,
              } : building ? {
                className: `map tappable${tool !== 'walk' || editing ? ' build-editing' : ''}`,
                onPointerMove: onMapDragMove,
                onPointerUp: endMapDrag,
                onPointerCancel: endMapDrag,
              } : mapStrip ? { className: 'map strip tappable' } : undefined}
            >
              {selecting && selectDrag.rect && !selectMove.current && (
                <rect className="map-select-outline" x={selectDrag.rect.x} y={selectDrag.rect.y} width={selectDrag.rect.w} height={selectDrag.rect.h} />
              )}
              {cutting && cutBox && (
                <rect className="map-cut-outline" x={cutBox.x} y={cutBox.y} width={cutBox.w} height={cutBox.h} />
              )}
              {blocking && block.rect && (
                <rect className="map-block-outline" x={block.rect.x} y={block.rect.y} width={block.rect.w} height={block.rect.h} />
              )}
              {blocking && block.corners.map(({ corner, x, y }) => (
                <circle key={corner} className="block-corner-handle" cx={x + 0.5} cy={y + 0.5} r={0.7}
                  aria-label={`Resize block ${corner}`}
                  onPointerDown={(e) => block.beginCorner(corner, e)} />
              ))}
              {draftingArea && areaDraft.rect && (
                <rect className="map-block-outline" x={areaDraft.rect.x} y={areaDraft.rect.y} width={areaDraft.rect.w} height={areaDraft.rect.h} />
              )}
              {draftingArea && areaDraft.corners.map(({ corner, x, y }) => (
                <circle key={corner} className="block-corner-handle" cx={x + 0.5} cy={y + 0.5} r={0.7}
                  aria-label={`Resize area ${corner}`}
                  onPointerDown={(e) => areaDraft.beginCorner(corner, e)} />
              ))}
              {building && tool === 'walk' && (['entrance', 'checkout'] as const).map((which) => (
                <rect key={which} className="marker-hit" x={layout[which].x - 0.5} y={layout[which].y - 0.5} width={2} height={2}
                  onPointerDown={(e) => beginMapDrag({ mode: which, start: cellOf(e), snapshot: props.build.snapshot(), moved: false }, e)} />
              ))}
              {building && tool === 'walk' && editing?.kind === 'shelf' && (() => {
                const h = handlePoint(editing);
                return (
                  <circle className="resize-handle" cx={h.x} cy={h.y} r={1.2} aria-label="Resize"
                    onPointerDown={(e) => beginMapDrag({ mode: 'resize', id: editing.id, start: cellOf(e), orig: editing, snapshot: props.build.snapshot(), moved: false }, e)} />
                );
              })()}
              {building && tool === 'walk' && editing?.kind === 'area' && (['nw', 'ne', 'sw', 'se'] as BlockCorner[]).map((corner) => {
                const f = footprint(editing);
                const pt = areaCornerCell(f, corner);
                return (
                  <circle key={corner} className="block-corner-handle" cx={pt.x + 0.5} cy={pt.y + 0.5} r={0.7}
                    aria-label={`Resize area ${corner}`}
                    onPointerDown={(e) => beginMapDrag({
                      mode: 'area-corner', id: editing.id, corner, fixed: areaCornerCell(f, areaOpposite(corner)),
                      orig: editing, snapshot: props.build.snapshot(), moved: false,
                    }, e)} />
                );
              })}
            </StoreMap>
              {mapTools && <MapTools svgRef={svgRef} viewKey={zoom.rect ? `${zoom.rect.x},${zoom.rect.y},${zoom.rect.w}` : 'all'} {...mapTools} />}
            </div>
            <BuildToolbar rail tool={tool} setTool={setTool} more={!!props.display.buildMoreTools}
              setMore={(more) => props.setDisplay((d) => ({ ...d, buildMoreTools: more }))} />
            <div className="zoom-buttons" role="group" aria-label="Zoom">
              <button className="map-tool" onClick={() => zoom.zoomIn(mapTools ? { x: mapTools.anchor.x + mapTools.anchor.w / 2, y: mapTools.anchor.y + mapTools.anchor.h / 2 } : undefined)} aria-label="Zoom in" disabled={zoom.scale >= MAX_ZOOM}><Icon name="zoom-in" size="1.3rem" /></button>
              <button className="map-tool" onClick={zoom.zoomOut} aria-label="Zoom out" disabled={zoom.scale <= 1}><Icon name="zoom-out" size="1.3rem" /></button>
              <button className="map-tool" onClick={zoom.fit} aria-label="Show the whole store" disabled={zoom.scale <= 1}><Icon name="maximize-2" size="1.3rem" /></button>
            </div>
          </div>
          <section className={`build-sheet${sheetOpen ? ' open' : ''}`} aria-label="Editor details">
            <div className="build-sheet-head">
              <div className="segmented mini-seg" role="tablist" aria-label="Editor">
                {([['tool', toolTitle], ['list', `List${items.filter((i) => !i.done).length ? ` (${items.filter((i) => !i.done).length})` : ''}`], ['store', 'Store']] as const).map(([t, text]) => (
                  <button key={t} role="tab" aria-selected={sheetTab === t} className={sheetTab === t ? 'active' : ''}
                    onClick={() => { if (sheetTab === t) setSheetOpen((o) => !o); else { setSheetTab(t); setSheetOpen(true); } }}>
                    {text}
                    {t === 'store' && problems.length > 0 && !layout.gen?.enabled && (
                      <span className="tab-badge" role="img" aria-label={`${problems.length} things to check`}>{problems.length}</span>
                    )}
                  </button>
                ))}
              </div>
              <button className="icon sheet-toggle" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen} aria-label={sheetOpen ? 'Smaller' : 'Bigger'}><Icon name={sheetOpen ? 'chevron-down' : 'chevron-up'} size="1.3rem" /></button>
            </div>
            {!sheetOpen && <p className="build-sheet-peek muted small" onClick={() => setSheetOpen(true)}>{toolHint}</p>}
            {sheetOpen && (
              <div className="build-sheet-body">
                {sheetTab === 'tool' && (
                  <>
          {editingAisle && (
            <AisleEditor aisle={editingAisle} api={props.build.aisles} onDone={() => setEditingAisleId(undefined)} onNote={setNote} />
          )}
          {editing && (
            <div className="build-edit">
              <div className="build-edit-head">
                <h3>Editing “{editing.label || (editing.kind === 'shelf' ? 'shelf' : 'area')}”</h3>
                <button className="btn primary" onClick={() => setEditingId(undefined)}>Done</button>
              </div>
              <PlacePanel
                place={editing}
                due={props.shelves.due.find((d) => d.placeId === editing.id)}
                onExtend={(d) => { const snapshot = props.shelves.extend(d); if (snapshot) say(`Extended ${d.by} square${d.by === 1 ? '' : 's'} ${d.way}.`, snapshot); }}
                onKeep={(d) => props.shelves.keep(d)}
                onChange={(patch) => props.build.updatePlace(editing.id, patch as Partial<Place>)}
                usedElsewhere={(catId) => layout.places.find((p) => p.id !== editing.id && p.categories.includes(catId))?.label}
                categories={catalog.categories}
                looks={props.looks}
              />
            </div>
          )}
          {blocking && (
            <ShelfBlockPanel
              rect={block.rect}
              shelves={block.shelves}
              orientation={block.orientation}
              setOrientation={block.setOrientation}
              double={double}
              setDouble={setDouble}
              lane={lane}
              setLane={(n) => props.setDisplay((x) => ({ ...x, blockLane: n }))}
              startLabel={block.startLabel}
              setStartLabel={block.setStartLabel}
              onAdd={() => { stampShelves(block.shelves, false); setTool('walk'); }}
              onCancel={() => setTool('walk')}
            />
          )}
          {draftingArea && (
            <AreaPanel
              rect={areaDraft.rect}
              label={areaDraft.label}
              setLabel={areaDraft.setLabel}
              onAdd={() => {
                if (!areaDraft.rect) return;
                const r = props.build.addArea(areaDraft.rect, areaDraft.label);
                setEditingId(r.placeId);
                const extras = [
                  r.moved ? `Moved ${r.moved} to make room` : '',
                  r.grown ? 'Map grew' : '',
                ].filter(Boolean).join(' · ');
                setNote({
                  kind: 'message',
                  text: extras ? `Added “${r.label}”. ${extras}.` : `Added “${r.label}”.`,
                  snapshot: r.snapshot,
                });
                setTool('walk');
              }}
              onCancel={() => setTool('walk')}
            />
          )}
          {renumberMode && selecting && (
            <section className="card block-panel renumber-panel" aria-label="Renumber selection">
              <div className="block-head">
                <b>123 Renumber</b>
                <span className="muted small">Tap a shelf or aisle on the map to make it first. Labels update live.</span>
              </div>
              <label className="lane-field first-label-field">
                <span>First</span>
                <input
                  value={renumberMode.start}
                  onChange={(e) => setRenumberMode({ ...renumberMode, start: e.target.value })}
                  placeholder="B1"
                  aria-label="First label"
                  inputMode="text"
                  autoCapitalize="characters"
                  style={{ fontSize: 16 }}
                />
              </label>
              <div className="sheet-actions">
                <button className="btn" onClick={() => setRenumberMode(undefined)}>Cancel</button>
                <span style={{ flex: 1 }} />
                <button className="btn" onClick={() => setRenumberMode({ ...renumberMode, flip: !renumberMode.flip })}>
                  <Icon name={runsUp(layout, renumberMode.ids) ? 'arrow-left-right' : 'arrow-up-down'} /> Flip
                </button>
                <button className="btn primary" onClick={() => {
                  const snapshot = props.build.aisles.renumberFrom(renumberMode.ids, renumberMode.start || '1', renumberMode.flip);
                  setRenumberMode(undefined);
                  say(`Renumbered ${selectionTitle(renumberMode.ids)}.`, snapshot);
                }}>Apply</button>
              </div>
            </section>
          )}
          {cutting && (
            <CutPanel
              box={cutBox}
              shelves={cut?.shelves.length ?? 0}
              aisles={cut?.aisles.map((a) => a.label) ?? []}
              nextNumber={Math.max(0, ...(layout.aisles ?? []).map((a) => parseInt(a.label.replace(/^\D*/, ''), 10)).filter((n) => !Number.isNaN(n))) + 1}
              width={cutBox ? (cutsVertical(cutBox) ? cutBox.h : cutBox.w) : 2}
              setWidth={setCutWidth}
              numbers={cutNumbers}
              setNumbers={setCutNumbers}
              onCut={() => {
                if (!cutBox) return;
                const r = props.build.aisles.cut(cutBox, cutNumbers);
                setTool('walk');
                setNote({ kind: 'message', snapshot: r.snapshot,
                  text: r.renamed.length ? `Cut ${r.cut} shelves. New aisles: ${r.renamed.join(', ')}.` : `Cut ${r.cut} shelves; the aisles carry on past the break.` });
              }}
              onCancel={() => setTool('walk')}
            />
          )}
          {building && tool === 'brush' && (
            <BrushPanel
              brush={brush}
              categories={catalog.categories}
              iconOf={(id) => props.looks.get(id)?.icon}
              nextAisle={nextAisleLabel(layout)}
              setBrush={setBrush}
              dir={brushDir}
              onStep={brushStepTo}
              onNudge={(d) => { setBrushDir(d); props.build.stepTo(d); }}
              canBack={brushSteps.length > 0}
              onBack={brushBackUp}
              lastResult={brushResult}
            />
          )}
          {building && !blocking && !draftingArea && !cutting && tool !== 'brush' && (
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
              aisleAction={aisleAction}
              double={double}
              setDouble={setDouble}
              onNote={setNote}
            />
          )}
                  </>
                )}
                {sheetTab === 'list' && listMain}
                {sheetTab === 'store' && (
                  <>
          {building && (
            <StoreSettings
              layout={layout}
              store={props.build.store}
              onLabels={() => setLabelSetup({})}
              onWalls={() => setWallsOpen('settings')}
              onPlaceBlock={(ref) => { setPlaceAsked(ref); setSheetOpen(false); }}
              problems={problems}
              onNewStore={() => setNewStoreOpen(true)}
              onPickPlace={(id) => { setToolState('walk'); setEditingId(id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
              onUndoable={(text, snapshot) => setNote({ kind: 'message', text, snapshot })}
            />
          )}
                    <div className="view-menu" role="group" aria-label="View settings">
                      <DisplayToggles display={props.display} setDisplay={props.setDisplay} show={['mapColors', 'mapIcons', 'listColors', 'listIcons']} />
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      )}
      {note && !drag && (
        <BuildBanner
          note={note}
          skipped={skipped}
          onFill={() => stampShelves(skipped, true)}
          layout={layout}
          catalog={catalog}
          build={props.build}
          onUndo={(snap) => { props.undo(snap); dropFromUndo(snap); setNote(null); }}
          onNote={setNote}
          onClose={() => setNote(null)}
        />
      )}

      {whereBarFor && !whereFor && !drag && !note && (
        <PlaceOnMap
          key={whereBarFor.id}
          itemName={whereBarFor.name}
          layout={layout}
          look={props.mapLook}
          mapSpots={mapSpotsFor(whereBarFor)}
          here={productFor(whereBarFor, catalog) ? props.here.options : undefined}
          onHere={(o) => placeHereFor(whereBarFor, o)}
          onMapController={setPlaceMap}
          onAskAtCheckout={() => {
            setLaterHere((ids) => [...ids.filter((id) => id !== whereBarFor.id), whereBarFor.id]);
            setWhereBarFor(null);
            setAskAtCheckout(true);
            setToast({ snapshot: { items, products: catalog.products }, added: [], mode: 'list', note: `At ${layout.name} you’ll be asked at checkout, all in one list.` });
          }}
          onSavePlace={(key) => savePlace(whereBarFor, key)}
          onSaveClue={(clue) => saveWhere(whereBarFor, clue)}
          onSaveFloor={(at) => saveFloorAt(whereBarFor, at)}
          onDescribe={() => { setWhereFor(whereBarFor); setWhereBarFor(null); }}
          onLater={() => { setLaterHere((ids) => [...ids.filter((id) => id !== whereBarFor.id), whereBarFor.id]); setWhereBarFor(null); }}
        />
      )}
      {newStoreOpen && (
        <TemplatePicker name="the new store" onClose={() => setNewStoreOpen(false)} onCreate={(id, aisles, opts) => {
          props.build.startBlankStore(id, aisles, opts);
          setEditingId(undefined);
          setNote({
            kind: 'message',
            text: id === 'blank'
              ? 'Blank store started — tap the door ghosts on the map to begin.'
              : 'Store started from a default map. Tap the door on the map, then shop: dashed parts are guesses.',
          });
        }} />
      )}
      {wallsOpen && (
        <DeptWallsSheet
          layout={layout}
          onClose={() => {
            if (wallsOpen === 'trip') props.build.store.setGen({ wallsOffered: true });
            setWallsOpen(null);
          }}
          onSave={(wallOrder) => {
            // The walls follow this order now, even parts that were moved by hand.
            const locked = (props.build.store.gen?.locked ?? []).filter((id) => !/^g-(dept|wall)-/.test(id));
            const snapshot = props.build.store.setGen({ wallOrder, wallsOffered: true, locked });
            setWallsOpen(null);
            const note = 'Departments set out along the walls.';
            if (building) setNote({ kind: 'message', text: note, snapshot });
            else setToast({ snapshot, added: [], mode: 'list', note });
          }}
        />
      )}
      {labelSetup && (
        <LabelStyleSheet
          initial={labelSetup.code}
          current={layout.labels}
          onClose={() => setLabelSetup(null)}
          onAisles={layout.labels ? () => {
            const snapshot = props.where.setLabels(undefined);
            setLabelSetup(null);
            setToast({ snapshot, added: [], mode: 'list', note: `${layout.name} uses aisle numbers.` });
          } : undefined}
          onSave={(style) => {
            const snapshot = props.where.setLabels(style);
            const { code, item } = labelSetup;
            setLabelSetup(null);
            const r = code ? parseLabel(style, code) : undefined;
            if (item && code && r) {
              const clue: Clue = { kind: 'shelf', code, section: r.section, ...(r.shelf !== undefined && { shelf: r.shelf }) };
              if (whereBarFor?.id === item.id) setWhereBarFor(null);
              if (whereFor?.id === item.id) setWhereFor(null);
              props.where.setClue(item, clue);
              setLastClue(clue);
              noteTrail(clue);
              setLaterHere((ids) => ids.filter((id) => id !== item.id));
              setToast({ snapshot, added: [], mode: 'list', note: `${item.name}: ${describeClue(clue)}` });
            } else {
              setToast({ snapshot, added: [], mode: 'list', note: `Shelf labels set up for ${layout.name}.` });
            }
          }}
        />
      )}
      {placing && !whereBarFor && !whereFor && !listOpen && !menuFor && (!askAtCheckout || tripDone) && (
        <PlacementCard
          key={placing.ref}
          layout={layout}
          products={catalog.products}
          subject={placing}
          look={props.mapLook}
          onPlace={(placement, label, dir) => {
            const snapshot = props.where.place(placing.ref, placement, dir);
            setPlaceAsked(undefined);
            setToast({ snapshot, added: [], mode: 'list', note: `${placing.name}: ${label}` });
          }}
          onNotSure={() => { if (asked) setPlaceAsked(undefined); else props.where.skipPlacement(placing.ref); }}
          onLater={() => { if (asked) setPlaceAsked(undefined); else setPlaceLater((l) => [...l, placing.ref]); }}
        />
      )}
      {listOpen && !whereFor && (
        <WhereList
          items={laterHere}
          layout={layout}
          look={props.mapLook}
          mapSpotsOf={mapSpotsFor}
          askAtCheckout={askAtCheckout}
          onSavePlace={(item, key) => { savePlace(item, key); setLaterHere((ids) => ids.filter((id) => id !== item.id)); }}
          onSaveClue={(item, clue) => {
            const snapshot = props.where.setClue(item, clue);
            setLastClue(clue);
            noteTrail(clue);
            setLaterHere((ids) => ids.filter((id) => id !== item.id));
            setToast({ snapshot, added: [], mode: 'list', note: `${item.name}: ${describeClue(clue)}` });
          }}
          onSaveFloor={(item, at) => {
            saveFloorAt(item, at);
            setLaterHere((ids) => ids.filter((id) => id !== item.id));
          }}
          onDescribe={(item) => setWhereFor(item)}
          onSkip={(item) => setLaterHere((ids) => ids.filter((id) => id !== item.id))}
          onAskAtCheckout={setAskAtCheckout}
          onClose={() => setListOpen(false)}
        />
      )}
      {toast && !drag && !note && !whereBarFor && !(placing && !tripDone && !whereFor && !listOpen && !menuFor && !askAtCheckout) && (
        <ToastBar
          toast={toast}
          layout={layout}
          catalog={catalog}
          onUndo={() => { props.undo(toast.snapshot); dropFromUndo(toast.snapshot); setToast(null); }}
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
            const p = productFor(menuFor, catalog);
            if (!p) return 'No place yet';
            const loc = locateProduct(p, layout, catalog);
            if (loc.kind === 'not-sold') return `Not sold at ${layout.name}`;
            return whereText(p, layout, catalog);
          })()}
          storeName={layout.name}
          categoryId={productFor(menuFor, catalog)?.categoryId}
          categories={catalog.categories}
          looks={props.looks}
          lists={props.lists.all}
          currentList={props.lists.current}
          onCategory={(id) => props.setItemCategory(menuFor, id)}
          onChangePlace={() => {
            setPicking({ productId: productFor(menuFor, catalog)?.id, item: menuFor, name: menuFor.name });
            setMenuFor(null);
          }}
          onWhere={() => {
            setWhereFor(menuFor);
            setMenuFor(null);
          }}
          onAmount={(patch) => {
            setItems((prev) => prev.map((i) => (i.id === menuFor.id ? { ...i, ...patch } : i)));
            setMenuFor({ ...menuFor, ...patch });
            learnPrice(menuFor, patch);
          }}
          pinned={pinned.has(menuFor.id)}
          onPin={() => {
            togglePin(menuFor);
            setMenuFor(null);
          }}
          onNotAvailable={() => {
            markAvailable(menuFor, false);
            setMenuFor(null);
          }}
          onRemove={() => {
            removeWithUndoOne(menuFor);
            setMenuFor(null);
          }}
          onMoveTo={(to) => {
            const name = props.lists.all.find((l) => l.id === to)?.name ?? 'list';
            const r = props.moveItemTo(menuFor.id, to);
            setMenuFor(null);
            setToast({
              snapshot: r.snapshot, added: [], mode: 'list',
              note: r.moved ? `Moved ${menuFor.name} to “${name}”.` : r.skipped ? `${menuFor.name} is already on “${name}”.` : 'Couldn’t move that.',
            });
          }}
          onCopyTo={(to) => {
            const name = props.lists.all.find((l) => l.id === to)?.name ?? 'list';
            const r = props.copyItemTo(menuFor.id, to);
            setMenuFor(null);
            setToast({
              snapshot: r.snapshot, added: [], mode: 'list',
              note: r.copied ? `Copied ${menuFor.name} to “${name}”.` : r.skipped ? `${menuFor.name} is already on “${name}”.` : 'Couldn’t copy that.',
            });
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
            }}>Not sold here</button>
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
