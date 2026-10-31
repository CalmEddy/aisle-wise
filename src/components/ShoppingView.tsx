import { useEffect, useMemo, useRef, useState } from 'react';
import { cutPreview, cutsVertical, shelvesUnder, type CutNumbers } from '../core/cut';
import { CutPanel } from './CutPanel';
import { useBlockDrag } from './ShelfBlock';
import type { Usual } from '../core/trips';
import type { LayoutQuestion } from '../core/learn';
import type { BuildOutcome, QuickAddResult, Snapshot } from '../App';
import { planBuild, type BuildChoice, type Direction } from '../core/build';
import { addedRect, nextShelves, skippedShelves } from '../core/rows';
import type { Catalog } from '../core/catalog';
import { Floor } from '../core/floor';
import { exactKey, exactSpotAt, footprint, placeAt, stripFocus } from '../core/geometry';
import { groupIntoStops, locateItem, locateProduct, productFor, resolveSpot } from '../core/locate';
import { groupVisits, planGroupedRoute } from '../core/route';
import type { Clue, ListItem, Orientation, Place, Placement, Point, Product, Rect, Shelf, Stop, StoreLayout } from '../core/types';
import type { Display, SectionLook } from '../display';
import { DisplayToggles } from './DisplayToggles';
import { BrushPanel, BuildToolbar, StoreSettings, TOOLS, type BuildTool, type StoreApi } from './BuildTools';
import { DEFAULT_BRUSH, brushArea, brushSegments, segmentRect, type Brush } from '../core/brush';
import { nextAisleLabel, walkwayAt } from '../core/aisles';
import { contains } from '../core/geometry';
import { PlacePanel, clamp, handlePoint } from './PlacePanel';
import { checkLayout } from '../core/validate';
import { SpotPicker } from './SpotPicker';
import { StoreMap, placeUnder, toGrid, type MapDot, type MapGhost } from './StoreMap';
import { AddItemsSheet } from './AddItemsSheet';
import { WherePanel } from './WherePanel';
import { WhereBar } from './WhereBar';
import { aislesUsed, describeClue } from '../core/clues';
import { usePersistentState } from '../usePersistentState';
import { ListsSheet, type ListsApi } from './ListsSheet';
import { ShelfBlockPanel, useShelfBlock } from './ShelfBlock';
import { type Drag, VisitCard, ItemRows } from './ItemRows';
import { type Toast, ToastBar } from './ToastBar';
import { ItemMenu } from './ItemMenu';
import { type BuildNote, BuildPanel, BuildBanner } from './BuildPanel';
import { typicalWhere, whereText } from './whereText';
import { AisleEditor } from './AisleEditor';
import { WhereList } from './WhereList';
import { PlacementCard } from './PlacementCard';
import { LabelStyleSheet } from './LabelStyleSheet';
import { parseLabel, type LabelStyle } from '../core/labels';
import { blockSubject, isBlock, pendingPlacements } from '../core/placement';
import { MapTools, type MapAction } from './MapTools';
import { MAX_ZOOM, useMapZoom } from './useMapZoom';
import { aisleShelves, runsUp, selectionRect } from '../core/aisles';
import { TripDoneCard } from './TripDoneCard';
import { DoorCard } from './DoorCard';
import { DeptWallsSheet } from './DeptWallsSheet';
import { offerWalls } from '../core/walls';

interface Props {
  /** The household's lists; this view shows the current one. */
  lists: ListsApi;
  /** The lists sheet (opened from the list picker in the header). */
  listsOpen: boolean;
  onListsClose: () => void;
  /** Show the how-it-works hint (toggled by ⓘ in the header). */
  /** Things bought before, most likely wanted again first. */
  usuals: Usual[];
  /** Parts of the map just added or changed (outlined). */
  mapChanges: string[];
  /** A changed part has been looked at (tapped in Edit map). */
  onSeenChange: (id: string) => void;
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
  /** "Where was it?": whether to ask in this store, saving answers, and logging check-off order. */
  where: {
    ask: boolean;
    setAsk: (on: boolean) => void;
    setClue: (item: ListItem, clue: Clue | undefined) => Snapshot;
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
    /** Sets how this store labels its shelves ("B12"), or back to aisle numbers. Returns what Undo restores. */
    setLabels: (style: LabelStyle | undefined) => Snapshot;
  };
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
  updatePlace: (placeId: string, patch: Partial<Place>) => boolean;
  deletePlace: (placeId: string) => void;
  /** What Undo would put back right now. */
  snapshot: () => Snapshot;
  /** Adds a shelf or open area where the map was tapped. */
  addPlaceAt: (kind: 'shelf-v' | 'shelf-h' | 'area', at: Point) => { placeId: string; label: string; snapshot: Snapshot };
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
    move: (ids: string | string[], dx: number, dy: number) => boolean;
    turn: (ids: string | string[]) => Snapshot | undefined;
    deleteMany: (ids: string[]) => Snapshot;
    makeBlock: (ids: string[]) => Snapshot | undefined;
    cutUnder: (areaId: string) => { snapshot: Snapshot; cut: number };
    within: (box: Rect) => string[];
    cut: (box: Rect, numbers: CutNumbers) => { snapshot: Snapshot; cut: number; renamed: string[] };
  };
  store: StoreApi;
}

/** Dragging something on the map in build mode's Walk tool. */
type MapDrag =
  | { mode: 'move' | 'resize'; id: string; start: Point; orig: Place; snapshot: Snapshot; moved: boolean }
  | { mode: 'entrance' | 'checkout'; start: Point; snapshot: Snapshot; moved: boolean };

const overlapsRect = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function ShoppingView(props: Props) {
  const { layout, floor, catalog, items, setItems, setLocation, setAvailable, position, setPosition, onEditLayout } = props;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [picking, setPicking] = useState<{ productId?: string; item?: ListItem; name: string } | null>(null);
  const [menuFor, setMenuFor] = useState<ListItem | null>(null);
  const [note, setNote] = useState<BuildNote | null>(null);
  const building = props.display.buildMode;
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
  // Cut tool: drag a box across a block of aisles to make a cross aisle.
  const cutDrag = useBlockDrag(layout);
  const [cutWidth, setCutWidth] = useState<number>();
  const [cutNumbers, setCutNumbers] = useState<CutNumbers>('same');
  const cutting = building && tool === 'cut';
  // Select tool: a group of aisles to turn, move or delete together.
  const selectDrag = useBlockDrag(layout);
  const [selectedAisles, setSelectedAisles] = useState<string[]>([]);
  const selecting = building && tool === 'select';
  const chosenAisles = selecting ? selectedAisles.filter((id) => layout.aisles?.some((a) => a.id === id) || layout.places.some((p) => p.id === id)) : [];
  function finishSelect() {
    const r = selectDrag.rect;
    selectDrag.up();
    selectDrag.clear();
    if (!r) return;
    const isAisle = (id: string) => !!layout.aisles?.some((a) => a.id === id);
    /** Shelves that come with these aisles anyway. */
    const alongAisles = (ids: string[]) => new Set((layout.aisles ?? []).filter((a) => ids.includes(a.id)).flatMap((a) => aisleShelves(layout, a).map((x) => x.id)));
    if (r.w === 1 && r.h === 1) {
      // A tap adds or takes out the one thing under it: what's on that square, else the aisle's walkway, else a thin shelf just beside it.
      const here = props.build.aisles.within(r);
      const id = here.find((x) => !isAisle(x)) ?? here.find(isAisle) ?? placeUnder(layout, r.x + 0.5, r.y + 0.5)?.id;
      if (!id) return;
      setSelectedAisles((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        // A shelf of a selected aisle: take that aisle out.
        const owner = prev.filter((x) => isAisle(x) && alongAisles([x]).has(id));
        if (owner.length) return prev.filter((x) => !owner.includes(x));
        return [...prev, id];
      });
      return;
    }
    // A box picks everything it touches (aisles bring their shelves).
    const ids = props.build.aisles.within(r);
    const along = alongAisles(ids);
    setSelectedAisles(ids.filter((id) => !along.has(id)));
  }
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
    selectDrag.clear();
    if (t !== 'select') setSelectedAisles([]);
    cutDrag.clear();
    setCutWidth(undefined);
    setBrushSteps([]);
    if (t === 'brush' || t === 'block' || t === 'cut') { setSheetTab('tool'); setSheetOpen(true); }
    if (t === 'block' || t === 'cut' || t === 'select') {
      setEditingId(undefined);
      setNote(null);
    }
  }
  // ---- Controls on the map, next to what's selected ----
  const say = (text: string, snapshot?: Snapshot) => setNote({ kind: 'message', text, ...(snapshot && { snapshot }) });
  const arrows = (move: (dx: number, dy: number) => boolean, what: string): MapAction[] =>
    ([['←', -1, 0, 'left'], ['↑', 0, -1, 'up'], ['↓', 0, 1, 'down'], ['→', 1, 0, 'right']] as const).map(([icon, dx, dy, word]) => ({
      key: word, icon, label: `Move ${what} ${word}`,
      onClick: () => { if (!move(dx, dy)) say('Can’t move it that way: something’s in the way, or it’s at the wall.'); },
    }));
  function aisleTools(ids: string[], title: string, onGone: () => void) {
    const anchor = selectionRect(layout, ids);
    if (!anchor) return undefined;
    const vertical = runsUp(layout, ids);
    const aisleIds = ids.filter((id) => layout.aisles?.some((a) => a.id === id));
    const onlyAisles = aisleIds.length === ids.length;
    const what = !onlyAisles ? 'them' : ids.length === 1 ? 'aisle' : 'aisles';
    return {
      anchor, title,
      rows: [
        [
          { key: 'turn', icon: vertical ? '↔' : '↕', label: vertical ? 'Turn side to side' : 'Turn up and down', onClick: () => {
            const snapshot = props.build.aisles.turn(ids);
            if (snapshot) say(`Turned ${title}.`, snapshot);
            else say('No room to turn here: something’s in the way, or it would go past the walls.');
          } },
          ...arrows((dx, dy) => props.build.aisles.move(ids, dx, dy), what),
          ...(layout.gen?.enabled && aisleIds.length > 0 && aisleIds.every((id) => id.startsWith('g-aisle-')) ? [{
            key: 'block', icon: '⧉', label: 'Make these aisles a block', onClick: () => {
              const snapshot = props.build.aisles.makeBlock(aisleIds);
              if (!snapshot) { say('Only numbered aisles from answers can be made into a block.'); return; }
              onGone();
              say(`${title} are their own block now: say where on the map.`, snapshot);
            },
          }] : []),
          { key: 'delete', icon: '🗑', label: onlyAisles ? `Delete ${what} and shelves` : `Delete ${title}`, danger: true, onClick: () => {
            const snapshot = props.build.aisles.deleteMany(ids);
            onGone();
            say(`Deleted ${title}.`, snapshot);
          } },
          { key: 'clear', icon: '✕', label: 'Clear the selection', onClick: onGone },
        ],
      ] as MapAction[][],
    };
  }
  function placeTools(p: Place) {
    const anchor = footprint(p);
    const update = (patch: Partial<Place>) => props.build.updatePlace(p.id, patch);
    const turn: MapAction = p.kind === 'shelf'
      ? { key: 'turn', icon: p.orientation === 'vertical' ? '↔' : '↕', label: 'Turn the shelf', onClick: () => {
          // About its middle.
          const v = p.orientation === 'vertical';
          const half = Math.floor(p.length / 2);
          const patch = v ? { orientation: 'horizontal' as const, x: p.x - half, y: p.y + half } : { orientation: 'vertical' as const, x: p.x + half, y: p.y - half };
          if (!update(patch)) say('No room to turn it here.');
        } }
      : { key: 'turn', icon: '⟳', label: 'Turn the area', onClick: () => { update({ w: p.h, h: p.w } as Partial<Place>); } };
    const size: MapAction[] = p.kind === 'shelf'
      ? [
          { key: 'shorter', icon: '−', label: 'Shorter', disabled: p.length <= 2, onClick: () => { update({ length: p.length - 1 } as Partial<Place>); } },
          { key: 'longer', icon: '+', label: 'Longer', onClick: () => { if (!update({ length: p.length + 1 } as Partial<Place>)) say('Can’t make it longer: something’s in the way.'); } },
        ]
      : [
          { key: 'narrower', icon: '⇤', label: 'Narrower', disabled: p.w <= 1, onClick: () => { update({ w: p.w - 1 } as Partial<Place>); } },
          { key: 'wider', icon: '⇥', label: 'Wider', onClick: () => { update({ w: p.w + 1 } as Partial<Place>); } },
          { key: 'shallower', icon: '⤒', label: 'Less deep', disabled: p.h <= 1, onClick: () => { update({ h: p.h - 1 } as Partial<Place>); } },
          { key: 'deeper', icon: '⤓', label: 'Deeper', onClick: () => { update({ h: p.h + 1 } as Partial<Place>); } },
        ];
    // An area over shelves (a display or promo space): offer clearing the shelves under it.
    const under = p.kind === 'area' ? shelvesUnder(layout, footprint(p)) : 0;
    const cutBtn: MapAction[] = under ? [{ key: 'cut-under', icon: '✂', label: 'Cut the shelves under it', onClick: () => {
      const r = props.build.aisles.cutUnder(p.id);
      say(`Cut ${r.cut} shel${r.cut === 1 ? 'f' : 'ves'} under “${p.label || 'the area'}”.`, r.snapshot);
    } }] : [];
    const del: MapAction = { key: 'delete', icon: '🗑', label: `Delete ${p.kind}`, danger: true, onClick: () => {
      const snapshot = props.build.snapshot();
      props.build.deletePlace(p.id);
      setEditingId(undefined);
      say(`Deleted “${p.label || p.kind}”.`, snapshot);
    } };
    return {
      anchor, title: p.label || (p.kind === 'shelf' ? 'Shelf' : 'Area'),
      rows: [[turn, ...size, ...cutBtn, del], arrows((dx, dy) => update({ x: p.x + dx, y: p.y + dy }), p.kind)],
    };
  }
  const mapTools = !building ? undefined
    : selecting && chosenAisles.length ? aisleTools(chosenAisles, selectionTitle(chosenAisles), () => setSelectedAisles([]))
      : tool === 'walk' && editingAisle ? aisleTools([editingAisle.id], editingAisle.label || 'aisle', () => setEditingAisleId(undefined))
        : tool === 'walk' && editing ? placeTools(editing)
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
    onGesture: () => { mapDrag.current = null; block.reset(); selectDrag.clear(); cutDrag.clear(); },
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
    ? { text: `🏷 “${aisleHere.label}”`, run: () => { setEditingId(undefined); setEditingAisleId(aisleHere.id); } }
    : walkwayHere
      ? { text: '🏷 Label aisle', run: () => {
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
    if (last) setNote({ kind: 'shelves', placeId: last, count: r.placeIds.length, filled, snapshot: r.snapshot });
  }

  const ghosts: MapGhost[] = [];
  if (building && tool === 'brush') {
    // The next step's walkway and what it will paint.
    const a = brushArea(position, brushDir, brush.width);
    ghosts.push({ rect: a.orientation === 'vertical'
      ? { x: a.lo, y: a.start, w: a.hi - a.lo + 1, h: a.end - a.start + 1 }
      : { x: a.start, y: a.lo, w: a.end - a.start + 1, h: a.hi - a.lo + 1 }, kind: 'lane' });
    for (const seg of brushSegments(position, brushDir, brush)) ghosts.push({ rect: segmentRect(seg), kind: seg.kind === 'wall' ? 'wall' : 'preview' });
  } else if (blocking) {
    for (const sh of block.shelves) ghosts.push({ rect: footprint(sh), kind: 'block' });
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
      note: available ? `${item.name} is back on your route` : `${item.name} marked not available at ${layout.name}`,
    });
  }

  // The add window (opened with + on the toggle strip).
  const [adding, setAdding] = useState(false);

  // The banner fades after a while, unless it's asking a question or a window is open over it
  // (place picker, lists, add items): then its Undo is still there when you come back.
  const asking = toast?.added.some((a) => a.conflict);
  const covered = !!picking || props.listsOpen || adding;
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

  // Without grouping: every item on the route, nearest first (by walking distance from you).
  const grouped = props.display.groupList ?? true;
  const nearestFirst = useMemo(() => {
    if (grouped) return [];
    return route
      .flatMap((st, order) => st.items.map((item) => ({ item, stop: st, order, d: floor.distance(position, st.point) })))
      .sort((a, b) => a.d - b.d || a.order - b.order);
  }, [grouped, route, floor, position]);

  const onList = useMemo(
    () => new Set(items.filter((i) => !i.done).map((i) => productFor(i, catalog)?.id).filter(Boolean) as string[]),
    [items, catalog],
  );
  /** "Buy again": things bought before that are in the master list, best first. */
  const buyAgain = useMemo(() => {
    const out: Product[] = [];
    for (const u of props.usuals) {
      const p = (u.productId && catalog.productById.get(u.productId)) || catalog.match(u.name);
      if (p && !out.includes(p)) out.push(p);
    }
    return out;
  }, [props.usuals, catalog]);

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
    if (building && mode === 'cart') {
      // Build mode: into the cart where you're standing (one at a time: the map builds around it).
      const outcome = props.build.pickUpHere(names[names.length - 1]);
      setNote(outcome);
      return { snapshot: outcome.snapshot, added: [] };
    }
    const result = props.quickAdd(names, mode, hereKey);
    if (mode === 'cart') setToast({ ...result, mode });
    return result;
  }

  function toggle(item: ListItem) {
    if (building && !item.done) {
      // Build mode: picked up where you're standing; the map grows around it.
      setNote(props.build.pickUpHere(item.name, item.id));
      return;
    }
    const before = { items, products: catalog.products };
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    props.where.notePick(item, !item.done);
    // Picking something up tells us where the shopper is standing.
    const loc = locate(item);
    if (!item.done && loc.kind === 'spot') setPosition(loc.spot.point);
    // Nothing saved about where it is in this store yet: ask.
    if (!item.done && props.where.ask && isUnknownHere(item) && askAtCheckout) {
      setLaterHere((ids) => [...ids.filter((id) => id !== item.id), item.id]);
    } else if (!item.done && props.where.ask && isUnknownHere(item)) {
      // Not answered the last one? It waits for later; this one takes the bar.
      if (whereBarFor && whereBarFor.id !== item.id) setLaterHere((ids) => [...ids.filter((id) => id !== whereBarFor.id), whereBarFor.id]);
      setWhereBarFor(item);
    } else if (!item.done && props.where.ask && knownByCategory(item)) {
      // Not asked: the map already has its kind of thing in one place. It might have been on a display or
      // table this time, though: one tap to say so.
      const where = knownByCategory(item)!;
      setToast({
        snapshot: before, added: [], mode: 'list', note: `${item.name} · ${where}`,
        action: { label: 'Somewhere else?', run: () => { setToast(null); setWhereFor(item); } },
      });
    }
  }
  /** Where the map puts an item with no answer of its own, by its kind (the one place that stocks it); else undefined. */
  function knownByCategory(item: ListItem): string | undefined {
    const p = productFor(item, catalog);
    if (p?.locations?.[layout.id] || p?.clues?.[layout.id] || !p?.categoryId) return undefined;
    const at = layout.places.filter((pl) => pl.categories.includes(p.categoryId!));
    return at.length === 1 ? at[0].label || 'on the map' : undefined;
  }

  // ---- "Where was it?" ----
  const [whereFor, setWhereFor] = useState<ListItem | null>(null);
  /** The item the quick "Where was it?" bar is asking about (at check-off). */
  const [whereBarFor, setWhereBarFor] = useState<ListItem | null>(null);
  // Items to ask about later (per store), and the last answer (for "Same as last").
  const [askLater, setAskLater] = usePersistentState<Record<string, string[]>>('aw.askLater', {});
  const [lastClue, setLastClue] = useState<Clue>();
  /** Aisle numbers answered this trip, in order (to guess the next one). */
  const [aisleTrail, setAisleTrail] = useState<string[]>([]);
  /** Shelves answered this trip ("B12" → section B, shelf 12), to guess the next. */
  const [shelfTrail, setShelfTrail] = useState<{ section: string; shelf?: number }[]>([]);
  const noteTrail = (clue: Clue) => {
    if ('aisle' in clue && clue.aisle) setAisleTrail((t) => [...t.slice(-5), clue.aisle!]);
    if (clue.kind === 'shelf') setShelfTrail((t) => [...t.slice(-5), { section: clue.section, shelf: clue.shelf }]);
  };
  /** The store's sections of labelled shelves (from the map), in order. */
  const storeSections = useMemo(() => [...new Set(layout.places.map((p) => /^g-sec-(.+)-\d+$/.exec(p.id)?.[1]).filter((x): x is string => !!x))].sort(), [layout.places]);
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
    const cat = p?.categoryId;
    return !(cat && layout.places.filter((pl) => pl.categories.includes(cat)).length === 1);
  }
  // At this store: ask in one list at checkout, not as you go.
  const askAtCheckout = !!props.display.askAtCheckout?.includes(layout.id);
  const setAskAtCheckout = (on: boolean) => props.setDisplay((d) => ({
    ...d, askAtCheckout: [...(d.askAtCheckout ?? []).filter((id) => id !== layout.id), ...(on ? [layout.id] : [])],
  }));
  const [listOpen, setListOpen] = useState(false);
  // Things the map has only guessed the place of: asked one at a time, relative to what's on the map.
  // In the editor, only blocks are asked about (made with "New block").
  const pending = useMemo(() => pendingPlacements(layout, catalog.products).filter((sub) => !building || isBlock(sub)), [layout, catalog.products, building]);
  const [placeLater, setPlaceLater] = useState<string[]>([]);
  /** A block the shopper asked to place (Store settings → Place…). */
  const [placeAsked, setPlaceAsked] = useState<string>();
  const asked = placeAsked ? blockSubject(layout, placeAsked) : undefined;
  const placing = asked ?? pending.find((sub) => !placeLater.includes(sub.ref));
  const laterHere = (askLater[layout.id] ?? [])
    .map((id) => items.find((i) => i.id === id))
    .filter((i): i is ListItem => !!i && isUnknownHere(i));
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
    setToast({ snapshot, added: [], mode: 'list', note: `${item.name}: ${describeClue(clue)}` });
    nextWhere(item);
  }

  const removeWithUndoOne = (item: ListItem) => removeWithUndo([item]);

  /** Takes items off the list, with Undo. */
  function removeWithUndo(gone: ListItem[]) {
    if (!gone.length) return;
    const snapshot = { items, products: catalog.products };
    const ids = new Set(gone.map((i) => i.id));
    setItems((prev) => prev.filter((i) => !ids.has(i.id)));
    setToast({ snapshot, added: [], mode: 'list', note: gone.length === 1 ? `Removed ${gone[0].name} from the list.` : `Removed ${gone.length} items from the list.` });
  }

  function newTrip() {
    const snapshot = { items, products: catalog.products };
    const n = items.filter((i) => i.done).length;
    props.where.newTrip();
    setWhereBarFor(null); // its item is leaving with the cart
    setAisleTrail([]);
    setShelfTrail([]);
    setItems((prev) => prev.filter((i) => !i.done));
    setPosition(layout.entrance);
    setToast({ snapshot, added: [], mode: 'list', note: `Cart cleared (${n} item${n === 1 ? '' : 's'}). Ready for next time.` });
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
  // While shopping the map is a strip showing you and your next stop (🗺 for the whole map); building shows it all.
  const mapStrip = !building && !props.display.mapFull;
  const [viewOpen, setViewOpen] = useState(false);
  const addButton = (
    <button type="button" className="toggle add-toggle" onClick={() => setAdding(true)} aria-label="Add items" title="Add items">＋</button>
  );

  const toolInfo = TOOLS.find((t) => t.id === tool)!;
  const toolTitle = editing ? (editing.label || (editing.kind === 'shelf' ? 'Shelf' : 'Area'))
    : editingAisle ? (editingAisle.label || 'Aisle')
      : chosenAisles.length ? selectionTitle(chosenAisles)
        : toolInfo.label;
  const toolHint = editing || editingAisle ? 'Name, what’s stocked, fridge or freezer: tap to open.' : toolInfo.hint;

  const storeMap = (
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
            changedIds={props.mapChanges}
            onAisleTap={building && tool === 'walk' ? (id) => { aisleTapped.current = id; } : undefined}
            ref={svgRef}
            onMapTap={blocking || cutting || selecting ? undefined : building ? buildTap : (x, y) => setPosition(floor.snap({ x: Math.floor(x), y: Math.floor(y) }))}
            onPlacePointerDown={building && tool === 'walk' ? (place, e) => {
              if (place.id === editing?.id) beginMapDrag({ mode: 'move', id: place.id, start: cellOf(e), orig: place, snapshot: props.build.snapshot(), moved: false }, e);
            } : undefined}
            svgProps={blocking ? { className: 'map drawing', ...block.svgHandlers } : selecting ? {
              className: 'map drawing',
              onPointerDown: selectDrag.down, onPointerMove: selectDrag.move, onPointerUp: finishSelect, onPointerCancel: finishSelect,
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
            {selecting && selectDrag.rect && (
              <rect className="map-select-outline" x={selectDrag.rect.x} y={selectDrag.rect.y} width={selectDrag.rect.w} height={selectDrag.rect.h} />
            )}
            {cutting && cutBox && (
              <rect className="map-cut-outline" x={cutBox.x} y={cutBox.y} width={cutBox.w} height={cutBox.h} />
            )}
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
  );
  const listMain = (
      <main>
        {laterHere.length > 0 && !tripDone && (
          <button className={`later-chip${items.every((i) => i.done) ? ' trip-done' : ''}`} onClick={() => setListOpen(true)}>
            📍 {laterHere.length} to place{items.every((i) => i.done) ? ' before you go' : ''} · <b>Review</b>
          </button>
        )}
        {items.length === 0 && (
          <div className="empty">
            <p>Your list is empty.</p>
            <p className="muted">
              Add what you need. The list sorts itself into the shortest walk through the store and re-sorts as you move.
            </p>
            <button className="btn primary" onClick={() => setAdding(true)}>＋ Add items</button>
            <button className="link" onClick={onEditLayout}>Set up your store’s layout</button>
          </div>
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
              onRemove={removeWithUndoOne}
              onMenu={setMenuFor}
              simple={!building}
              onNotHere={(i) => markAvailable(i, false)}
              drag={building ? dragHandlers : undefined}
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
          <div className="card route-list">
          <VisitCard visit={nextVisit} next drag={drag} onGoTo={(st) => setPosition(st.point)} colorOf={sectionColor} sectionName={(st) => catalog.categoryById.get(st.key.split(':')[1] ?? '')?.name} rows={(st, sub) => (
            <ItemRows items={st.items} onToggle={toggle} onRemove={removeWithUndoOne} onMenu={setMenuFor} drag={building ? dragHandlers : undefined} dragging={drag?.item.id} iconOf={iconOf} pinned={pinned} onPin={togglePin} subOf={sub} simple={!building} onNotHere={(i) => markAvailable(i, false)} big />
          )} />
        {laterVisits.map((v) => (
          <VisitCard key={`${v.number}-${v.placeId}`} visit={v} drag={drag} onGoTo={(st) => setPosition(st.point)} colorOf={sectionColor} sectionName={(st) => catalog.categoryById.get(st.key.split(':')[1] ?? '')?.name} rows={(st, sub) => (
            <ItemRows items={st.items} onToggle={toggle} onRemove={removeWithUndoOne} onMenu={setMenuFor} drag={building ? dragHandlers : undefined} dragging={drag?.item.id} iconOf={iconOf} pinned={pinned} onPin={togglePin} subOf={sub} simple={!building} onNotHere={(i) => markAvailable(i, false)} />
          )} />
        ))}
          </div>
        )}

        {byClue.length > 0 && (
          <section className="card by-clue">
            <h3>
              {byClue.some((b) => b.clue) ? 'By aisle' : 'In typical store order'}
              <span className="muted small"> · {byClue.some((b) => !b.clue) ? 'until you say where things are' : 'not on the map yet'}</span>
            </h3>
            <ItemRows
              items={byClue.map((b) => b.item)}
              onToggle={toggle}
              onRemove={removeWithUndoOne}
              onMenu={setMenuFor}
              simple={!building}
              onNotHere={(i) => markAvailable(i, false)}
              iconOf={iconOf}
              subOf={(item) => { const b = byClue.find((x) => x.item.id === item.id); return b && (b.clue ? describeClue(b.clue) : `usually ${typicalWhere(b.categoryId!, catalog)}`); }}
            />
          </section>
        )}

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
                  <div className="row off-row" key={item.id}>
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
                    <span className="row-actions">
                      <button className="icon" onClick={() => setMenuFor(item)} aria-label={`More options for ${item.name}`}>⋯</button>
                      <button className="icon" onClick={() => removeWithUndo([item])} aria-label={`Remove ${item.name}`}>×</button>
                    </span>
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
            door={props.where.door && (
              <DoorCard layout={layout} guess={props.where.door.guess}
                onPick={(f) => {
                  const snapshot = props.where.setDoor(f);
                  if (snapshot) setToast({ snapshot, added: [], mode: 'list', note: 'Door moved: the next trip starts there.' });
                }}
                onSkip={() => props.where.setDoor(undefined)} />
            )}
            walls={offerWalls(layout) ? () => setWallsOpen('trip') : undefined}
          />
        )}

        {done.length > 0 && (
          <details className="card done">
            <summary>In the cart ({done.length})</summary>
            <ItemRows items={done} onToggle={toggle} onRemove={removeWithUndoOne} iconOf={iconOf} simple />
            <button className="link" onClick={newTrip}>Clear cart and start a new trip</button>
          </details>
        )}
      </main>
  );

  return (
    <>
      {props.listsOpen && (
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
      {adding && (
        <AddItemsSheet
          listName={props.lists.all.find((l) => l.id === props.lists.current)?.name ?? 'Shopping list'}
          catalog={catalog}
          onList={onList}
          hereLabel={hereLabel}
          whereText={(p) => whereText(p, layout, catalog)}
          iconOf={(id) => (id ? props.looks.get(id)?.icon : undefined)}
          onAdd={addNames}
          buyAgain={buyAgain}
          onUndo={props.undo}
          onClose={() => setAdding(false)}
        />
      )}

      {!building && items.length === 0 && (
        <DisplayToggles display={props.display} setDisplay={props.setDisplay} show={['buildMode']} lead={addButton} />
      )}
      {!building && items.length > 0 && (
        <>
          {layout.places.length > 0 && <div className="map-wrap">{storeMap}</div>}
          <DisplayToggles
            display={props.display}
            setDisplay={props.setDisplay}
            show={['groupList', 'buildMode']}
            lead={addButton}
            extra={(
              <>
                {!building && (
                  <button type="button" className="toggle icon-only action" aria-pressed={!mapStrip} onClick={() => props.setDisplay((d) => ({ ...d, mapFull: !d.mapFull }))}
                    aria-label={mapStrip ? 'Show the whole map' : 'Smaller map'} title={mapStrip ? 'Show the whole map' : 'Smaller map'}>🗺</button>
                )}
                <button type="button" className="toggle icon-only action" aria-pressed={viewOpen} aria-expanded={viewOpen} onClick={() => setViewOpen((v) => !v)}
                  aria-label="View settings" title="View settings">⚙</button>
              </>
            )}
          />
          {viewOpen && (
            <div className="view-menu" role="group" aria-label="View settings">
              <DisplayToggles display={props.display} setDisplay={props.setDisplay} show={['mapColors', 'mapIcons', 'listColors', 'listIcons']} />
              <span className="muted small">🎨 category colours · 🍎 category icons</span>
            </div>
          )}
        </>
      )}
      {building && (
        <div className="build-screen" role="region" aria-label="Edit map">
          <div className="build-top">
            <button className="btn primary" onClick={() => props.setDisplay((d) => ({ ...d, buildMode: false }))}>Done</button>
            <span className="build-top-name">{layout.name}</span>
            <button className="btn" onClick={undoLast} disabled={!undoStack.length} aria-label="Undo">↶ Undo</button>
            {problems.length > 0 && !layout.gen?.enabled && (
              <button className="btn warn" onClick={() => { setSheetTab('store'); setSheetOpen(true); }} aria-label={`${problems.length} things to check`}>⚠ {problems.length}</button>
            )}
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
              changedIds={props.mapChanges}
              onAisleTap={building && tool === 'walk' ? (id) => { aisleTapped.current = id; } : undefined}
              ref={svgRef}
              onMapTap={blocking || cutting || selecting ? undefined : building ? buildTap : (x, y) => setPosition(floor.snap({ x: Math.floor(x), y: Math.floor(y) }))}
              onPlacePointerDown={building && tool === 'walk' ? (place, e) => {
                if (place.id === editing?.id) beginMapDrag({ mode: 'move', id: place.id, start: cellOf(e), orig: place, snapshot: props.build.snapshot(), moved: false }, e);
              } : undefined}
              svgProps={blocking ? { className: 'map drawing', ...block.svgHandlers } : selecting ? {
                className: 'map drawing',
                onPointerDown: selectDrag.down, onPointerMove: selectDrag.move, onPointerUp: finishSelect, onPointerCancel: finishSelect,
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
              {selecting && selectDrag.rect && (
                <rect className="map-select-outline" x={selectDrag.rect.x} y={selectDrag.rect.y} width={selectDrag.rect.w} height={selectDrag.rect.h} />
              )}
              {cutting && cutBox && (
                <rect className="map-cut-outline" x={cutBox.x} y={cutBox.y} width={cutBox.w} height={cutBox.h} />
              )}
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
              {mapTools && <MapTools svgRef={svgRef} viewKey={zoom.rect ? `${zoom.rect.x},${zoom.rect.y},${zoom.rect.w}` : 'all'} {...mapTools} />}
            </div>
            <BuildToolbar rail tool={tool} setTool={setTool} more={!!props.display.buildMoreTools}
              setMore={(more) => props.setDisplay((d) => ({ ...d, buildMoreTools: more }))} />
            <div className="zoom-buttons" role="group" aria-label="Zoom">
              <button className="map-tool" onClick={() => zoom.zoomIn(mapTools ? { x: mapTools.anchor.x + mapTools.anchor.w / 2, y: mapTools.anchor.y + mapTools.anchor.h / 2 } : undefined)} aria-label="Zoom in" disabled={zoom.scale >= MAX_ZOOM}>＋</button>
              <button className="map-tool" onClick={zoom.zoomOut} aria-label="Zoom out" disabled={zoom.scale <= 1}>－</button>
              <button className="map-tool" onClick={zoom.fit} aria-label="Show the whole store" disabled={zoom.scale <= 1}>⤢</button>
            </div>
          </div>
          <section className={`build-sheet${sheetOpen ? ' open' : ''}`} aria-label="Editor details">
            <div className="build-sheet-head">
              <div className="segmented mini-seg" role="tablist" aria-label="Editor">
                {([['tool', toolTitle], ['list', `List${items.filter((i) => !i.done).length ? ` (${items.filter((i) => !i.done).length})` : ''}`], ['store', 'Store']] as const).map(([t, text]) => (
                  <button key={t} role="tab" aria-selected={sheetTab === t} className={sheetTab === t ? 'active' : ''}
                    onClick={() => { if (sheetTab === t) setSheetOpen((o) => !o); else { setSheetTab(t); setSheetOpen(true); } }}>{text}</button>
                ))}
              </div>
              <button className="icon sheet-toggle" onClick={() => setSheetOpen((o) => !o)} aria-expanded={sheetOpen} aria-label={sheetOpen ? 'Smaller' : 'Bigger'}>{sheetOpen ? '▾' : '▴'}</button>
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
                onChange={(patch) => props.build.updatePlace(editing.id, patch as Partial<Place>)}
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
          {building && !blocking && !cutting && tool !== 'brush' && (
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
              onNewStore={() => {
                props.build.startBlankStore();
                setEditingId(undefined);
                setNote({ kind: 'message', text: 'New blank store started. Tap “I’m at the entrance” where you came in.' });
              }}
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
      {!building && listMain}

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
        <WhereBar
          key={whereBarFor.id}
          itemName={whereBarFor.name}
          categoryId={productFor(whereBarFor, catalog)?.categoryId}
          labels={layout.labels}
          shelfTrail={shelfTrail}
          sections={storeSections}
          onNeedLabels={(code) => setLabelSetup({ code, item: whereBarFor })}
          recentAisles={aislesUsed(catalog.products, layout.id)}
          lastClue={lastClue}
          trail={aisleTrail}
          onAskAtCheckout={() => {
            setLaterHere((ids) => [...ids.filter((id) => id !== whereBarFor.id), whereBarFor.id]);
            setWhereBarFor(null);
            setAskAtCheckout(true);
            setToast({ snapshot: { items, products: catalog.products }, added: [], mode: 'list', note: `At ${layout.name} you’ll be asked at checkout, all in one list.` });
          }}
          onSave={(clue) => saveWhere(whereBarFor, clue)}
          onOther={() => { setWhereFor(whereBarFor); setWhereBarFor(null); }}
          onLater={() => { setLaterHere((ids) => [...ids.filter((id) => id !== whereBarFor.id), whereBarFor.id]); setWhereBarFor(null); }}
        />
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
            const note = 'Departments set out along the walls. Changes are outlined.';
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
      {placing && !whereBarFor && !whereFor && !adding && !listOpen && !menuFor && (!askAtCheckout || tripDone) && (
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
          categoryOf={(i) => productFor(i, catalog)?.categoryId}
          recentAisles={aislesUsed(catalog.products, layout.id)}
          lastClue={lastClue}
          trail={aisleTrail}
          labels={layout.labels}
          shelfTrail={shelfTrail}
          sections={storeSections}
          onNeedLabels={(item, code) => setLabelSetup({ code, item })}
          askAtCheckout={askAtCheckout}
          onSave={(item, clue) => {
            const snapshot = props.where.setClue(item, clue);
            setLastClue(clue);
            noteTrail(clue);
            setLaterHere((ids) => ids.filter((id) => id !== item.id));
            setToast({ snapshot, added: [], mode: 'list', note: `${item.name}: ${describeClue(clue)}` });
          }}
          onOther={(item) => setWhereFor(item)}
          onSkip={(item) => setLaterHere((ids) => ids.filter((id) => id !== item.id))}
          onAskAtCheckout={setAskAtCheckout}
          onClose={() => setListOpen(false)}
        />
      )}
      {toast && !drag && !note && !whereBarFor && !(placing && !whereFor && !adding && !listOpen && !menuFor && (!askAtCheckout || tripDone)) && (
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
            const loc = locate(menuFor);
            return loc.kind === 'spot' ? loc.spot.label : loc.kind === 'clue' ? describeClue(loc.clue) : loc.kind === 'guess' ? `Usually ${typicalWhere(loc.categoryId, catalog)}` : loc.kind === 'not-sold' ? `Not available at ${layout.name}` : 'No location yet';
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
          onWhere={() => {
            setWhereFor(menuFor);
            setMenuFor(null);
          }}
          onAmount={(patch) => {
            setItems((prev) => prev.map((i) => (i.id === menuFor.id ? { ...i, ...patch } : i)));
            setMenuFor({ ...menuFor, ...patch });
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
