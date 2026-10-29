import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ItemsView } from './components/ItemsView';
import { HouseholdButton, HouseholdSheet } from './components/HouseholdSheet';
import { ImportSheet, ShareSheet } from './components/ShareSheets';
import { ShoppingView } from './components/ShoppingView';
import { ListBar } from './components/ListsSheet';
import { StoreSheet } from './components/StoreSheet';
import { storeHere } from './core/stores';
import { Catalog, normalize } from './core/catalog';
import { categoryLook, defaultCategories, defaultProducts } from './core/categories';
import { defaultDisplay, type Display, type SectionLook } from './display';
import { demoLayout } from './core/demoLayout';
import { Floor } from './core/floor';
import { hasOldAisles, migrateToShelves } from './core/migrate';
import { areaHere, blankStore, moveHere, nextLabel, pickUp, step, turnPair, turnShelf, type BuildAction, type BuildChoice, type Direction, type ExtendCandidate, type SideOption } from './core/build';
import { DEFAULT_BRUSH, paintStep, type Brush } from './core/brush';
import { addAisle, clipAisles, removeAisle, renameAisle } from './core/aisles';
import { recordPick, startTrip, TRIP_GAP, unrecordPick, type Trip } from './core/trips';
import { BACK_WALL, buildModel, modelKey, newlyEdited, regenerate } from './core/generate';
import { DEPTS } from './core/clues';
import { describeArrangement, learnArrangement, type LayoutQuestion } from './core/learn';
import { productFor, resolveSpot } from './core/locate';
import {
  applyListShare, applyStoreShare, buildListShare, buildStoreShare, decodeShare, shareFromHash, type Share,
} from './core/share';
import type { Clue, GeoPoint, Rect } from './core/types';
import { MAIN_LIST, type Category, type ListItem, type Place, type Point, type Product, type Shelf, type ShoppingList, type StoreLayout } from './core/types';
import { combineLists, defaultLists, itemsOn, listOf, removeList, updateList } from './core/lists';
import { clampPlace } from './core/geometry';
import { useHousehold } from './sync/useHousehold';
import { usePersistentState } from './usePersistentState';

type View = 'list' | 'items';

export interface QuickAddResult {
  snapshot: Snapshot;
  added: {
    productId: string;
    name: string;
    isNew: boolean;
    /** Spot key saved as the item's location in this store by this add. */
    savedAt?: string;
    alreadyOnList: boolean;
    /** The item was put in the cart away from its saved location: ask before moving it. */
    conflict?: { savedKey: string; hereKey: string };
  }[];
}

const newId = () => Math.random().toString(36).slice(2, 10);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What to put back for Undo. */
export interface Snapshot {
  items: ListItem[];
  products: Product[];
  layouts?: StoreLayout[];
}

/** What happened when something was picked up in build mode. */
export type BuildOutcome =
  | { kind: 'built'; action: BuildAction; placeId: string; label: string; itemName: string; snapshot: Snapshot; /** A new shelf copied this neighbour. */ matched?: string; /** Its back-to-back partner (double shelves). */ pairId?: string }
  | { kind: 'conflict'; productId: string; itemName: string; savedKey: string; snapshot: Snapshot }
  | { kind: 'choose'; productId: string; itemName: string; at: Point; options: ExtendCandidate[]; snapshot: Snapshot }
  | { kind: 'chooseSide'; productId: string; itemName: string; at: Point; options: SideOption[]; snapshot: Snapshot }
  | { kind: 'blocked'; itemName: string; snapshot: Snapshot };

export default function App() {
  const [layouts, setLayouts] = usePersistentState<StoreLayout[]>('aw.layouts', [demoLayout]);
  const [activeId, setActiveId] = usePersistentState('aw.activeLayout', demoLayout.id);
  const [savedView, setView] = usePersistentState<View | 'layout'>('aw.view', 'list');
  // The old "Store layout" tab is now build mode on the Shop tab.
  const view: View = savedView === 'layout' ? 'list' : savedView;
  // Every list's items; the app works on the list being shopped (`items`).
  const [allItems, setAllItems] = usePersistentState<ListItem[]>('aw.items', []);
  const [savedLists, setLists] = usePersistentState<ShoppingList[]>('aw.lists', defaultLists);
  // The main list always exists (items from before there were several lists are on it).
  const lists = useMemo(
    () => (savedLists.some((l) => l.id === MAIN_LIST) ? savedLists : [...defaultLists, ...savedLists]),
    [savedLists],
  );
  const [savedListId, setActiveListId] = usePersistentState('aw.activeList', MAIN_LIST);
  const listId = lists.some((l) => l.id === savedListId) ? savedListId : MAIN_LIST;
  const items = useMemo(() => itemsOn(allItems, listId), [allItems, listId]);
  /** Changes the current list's items (other lists are left alone). */
  const setItems = useCallback(
    (fn: (prev: ListItem[]) => ListItem[]) => setAllItems((all) => updateList(all, listId, fn)),
    [listId, setAllItems],
  );
  const [products, setProducts] = usePersistentState<Product[]>('aw.products', defaultProducts);
  const [categories, setCategories] = usePersistentState<Category[]>('aw.categories', defaultCategories);
  const [display, setDisplay] = usePersistentState<Display>('aw.display', defaultDisplay);
  const [pos, setPos] = usePersistentState<{ layoutId: string; point: Point } | null>('aw.position.v2', null);
  useEffect(() => {
    if (savedView !== 'layout') return;
    setView('list');
    setDisplay((d) => ({ ...d, buildMode: true }));
  }, [savedView, setView, setDisplay]);

  useMoveOldLocationsIntoProducts(setProducts);

  // Stores saved (or synced from an older phone) with aisles: turn each aisle into two shelves.
  useEffect(() => {
    if (!hasOldAisles(layouts)) return;
    const r = migrateToShelves(layouts, products);
    setLayouts(() => r.layouts);
    setProducts(() => r.products);
  }, [layouts, products, setLayouts, setProducts]);

  // Live sharing with a household (Supabase). Off unless configured and joined.
  const syncData = useMemo(() => ({ items: allItems, lists, products, categories, layouts }), [allItems, lists, products, categories, layouts]);
  const household = useHousehold(syncData, (d) => {
    setAllItems(() => d.items);
    setLists(() => d.lists);
    setProducts(() => d.products);
    setCategories(() => d.categories);
    setLayouts(() => (d.layouts.length ? d.layouts : [demoLayout]));
  });
  const [householdOpen, setHouseholdOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [joinCode, setJoinCode] = useState<string>();

  // Sharing: what we're sending, and anything that arrived in a link.
  const [sending, setSending] = useState<{ title: string; summary: string; share: Share } | null>(null);
  const [incoming, setIncoming] = useState<Share | 'error' | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const check = () => {
      const join = /^#join=([A-Za-z0-9]+)$/.exec(location.hash)?.[1];
      if (join) {
        history.replaceState(null, '', location.pathname + location.search);
        setJoinCode(join.toUpperCase());
        setHouseholdOpen(true);
        return;
      }
      const text = shareFromHash(location.hash);
      if (!text) return;
      history.replaceState(null, '', location.pathname + location.search);
      decodeShare(text).then(setIncoming, () => setIncoming('error'));
    };
    check();
    window.addEventListener('hashchange', check);
    return () => window.removeEventListener('hashchange', check);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const layout = layouts.find((l) => l.id === activeId) ?? layouts[0] ?? demoLayout;
  const floor = useMemo(() => new Floor(layout), [layout]);
  const catalog = useMemo(() => new Catalog(products, categories), [products, categories]);
  // Each category's colour and icon, and how the map should show them.
  const looks = useMemo(() => new Map(categories.map((c, i) => [c.id, categoryLook(c, i)])), [categories]);
  const mapLook: SectionLook = useMemo(() => ({
    colorOf: display.mapColors ? (id: string) => looks.get(id)?.color : undefined,
    iconOf: display.mapIcons ? (id: string) => looks.get(id)?.icon : undefined,
  }), [looks, display.mapColors, display.mapIcons]);
  const position = pos?.layoutId === layout.id ? pos.point : layout.entrance;
  const done = items.filter((i) => i.done).length;
  const onList = useMemo(
    () => new Set(items.filter((i) => !i.done).map((i) => productFor(i, catalog)?.id).filter(Boolean) as string[]),
    [items, catalog],
  );

  /** Remembers where an item is in the current store, adding it to the master list if it's new. */
  function setLocation(item: ListItem, spotKey: string) {
    const product = productFor(item, catalog);
    if (product) {
      setProducts((prev) => prev.map((p) => (p.id === product.id
        ? { ...p, locations: { ...p.locations, [layout.id]: spotKey }, notAt: p.notAt?.filter((id) => id !== layout.id) }
        : p)));
      return;
    }
    const created: Product = { id: `p-${newId()}`, name: capitalize(item.name.trim()), locations: { [layout.id]: spotKey } };
    setProducts((prev) => [...prev, created]);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, productId: created.id } : i)));
  }

  /**
   * Adds items while shopping. `mode: 'cart'` means the shopper is holding
   * it, so it's checked off and its location here is saved. New items join
   * the master list at `hereKey` (where the shopper is standing).
   */
  function quickAdd(names: string[], mode: 'list' | 'cart', hereKey?: string): QuickAddResult {
    const snapshot = { items, products };
    let nextProducts = products;
    let nextItems = items;
    const results: QuickAddResult['added'] = [];

    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      let product = new Catalog(nextProducts, categories).exact(name);
      let saved: string | undefined;
      let conflict: QuickAddResult['added'][number]['conflict'];

      if (!product) {
        product = { id: `p-${newId()}`, name: capitalize(name), ...(hereKey && { locations: { [layout.id]: hereKey } }) };
        nextProducts = [...nextProducts, product];
        saved = hereKey;
      } else if (mode === 'cart' && hereKey) {
        // You're holding it, so it's sold here. Save where you are only if it had no saved
        // location in this store; if it's saved somewhere else, ask before moving it.
        const savedKey = product.locations?.[layout.id];
        const savedSpot = savedKey ? resolveSpot(savedKey, layout, catalog) : undefined;
        const soldHere = !product.notAt?.includes(layout.id);
        if (!savedSpot || !soldHere) {
          const updated: Product = {
            ...product,
            locations: savedSpot ? product.locations : { ...product.locations, [layout.id]: hereKey },
            notAt: product.notAt?.filter((id) => id !== layout.id),
          };
          nextProducts = nextProducts.map((p) => (p.id === updated.id ? updated : p));
          if (!savedSpot) saved = hereKey;
          product = updated;
        }
        if (savedSpot && savedKey && savedSpot.placeId !== hereKey.split(':')[0]) {
          conflict = { savedKey, hereKey };
        }
      }

      const pid = product.id;
      const waiting = nextItems.find((i) => !i.done && (i.productId === pid || productFor(i, catalog)?.id === pid));
      if (waiting && mode === 'cart') {
        nextItems = nextItems.map((i) => (i.id === waiting.id ? { ...i, done: true, productId: pid } : i));
      } else if (!waiting) {
        nextItems = [...nextItems, { id: newId(), name: product.name, done: mode === 'cart', productId: pid }];
      }
      results.push({ productId: pid, name: product.name, isNew: !snapshot.products.some((p) => p.id === pid), savedAt: saved, alreadyOnList: !!waiting && mode === 'list', conflict });
    }

    setProducts(() => nextProducts);
    setItems(() => nextItems);
    return { snapshot, added: results };
  }

  function undo(snapshot: Snapshot) {
    setProducts(() => snapshot.products);
    setItems(() => snapshot.items);
    if (snapshot.layouts) setLayouts(() => snapshot.layouts!);
  }

  // ---- Build mode: grow the map from where things are picked up ----

  /** A shopper's change to a store. Generated parts they change are kept as they are from then on. */
  const keepEdits = (before: StoreLayout, after: StoreLayout): StoreLayout => {
    const edited = newlyEdited(before, after);
    return edited.length && after.gen ? { ...after, gen: { ...after.gen, locked: [...after.gen.locked, ...edited] } } : after;
  };
  const replaceLayout = (next: StoreLayout) => setLayouts((prev) => prev.map((l) => (l.id === next.id ? keepEdits(l, next) : l)));

  // ---- Map generated from aisle answers ----
  // Rebuilt whenever the answers for this store change; a blank store starts doing this with its first answer.
  useEffect(() => {
    const hasAnswers = products.some((p) => p.clues?.[layout.id]);
    if (!layout.gen && !(hasAnswers && layout.places.length === 0)) return;
    const gen = layout.gen ?? { enabled: true, entrance: 'left' as const, locked: [] };
    if (!gen.enabled) return;
    const model = buildModel(products, layout.id);
    if (modelKey(model, gen) === gen.key) return;
    setLayouts((prev) => prev.map((l) => (l.id === layout.id ? regenerate({ ...l, gen }, model) : l)));
  }, [products, layout, setLayouts]);

  /** Turns generating on or off, flips the entrance side, or lets edited parts be regenerated. */
  function setGen(patch: Partial<NonNullable<StoreLayout['gen']>>): Snapshot {
    const snapshot = snapshotNow();
    setLayouts((prev) => prev.map((l) => {
      if (l.id !== layout.id) return l;
      const gen = { enabled: true, entrance: 'left' as const, locked: [], ...l.gen, ...patch, key: undefined };
      return { ...l, gen };
    }));
    return snapshot;
  }

  /**
   * Picks up an item where the shopper is standing (checking it off, or into
   * the cart) and builds the map around it: puts it on the shelf beside them,
   * extends a shelf, or creates one. If the item is already saved somewhere
   * else in this store, nothing moves and the caller asks first.
   */
  function pickUpHere(name: string, itemId?: string): BuildOutcome {
    const snapshot: Snapshot = { items, products, layouts };
    const r = pickUp({ items, products, layout, catalog }, name, itemId, position, display.buildArea ? 'area' : 'shelf', !!display.buildDouble, brush.width);
    if (r.layout !== layout) replaceLayout(r.layout);
    setProducts(() => r.products);
    setItems(() => r.items);
    const o = r.outcome;
    if (o.kind === 'conflict') return { kind: 'conflict', productId: o.productId, itemName: o.itemName, savedKey: o.savedKey, snapshot };
    if (o.kind === 'blocked') return { kind: 'blocked', itemName: o.itemName, snapshot };
    if (o.kind === 'choose' || o.kind === 'chooseSide') return { ...o, snapshot };
    return { kind: 'built', action: o.action, placeId: o.placeId, label: o.label, itemName: o.itemName, snapshot, matched: o.matched, pairId: o.pairId };
  }

  /** "Move here" after a conflict: build at the current spot and move the item there. */
  function moveHereAndBuild(productId: string): BuildOutcome {
    const snapshot: Snapshot = { items, products, layouts };
    const r = moveHere({ products, layout, catalog }, productId, position, display.buildArea ? 'area' : 'shelf', !!display.buildDouble);
    const name = catalog.productById.get(productId)?.name ?? '';
    if (!r || r.plan.action === 'blocked') return { kind: 'blocked', itemName: name, snapshot };
    replaceLayout(r.layout);
    setProducts(() => r.products);
    return { kind: 'built', action: r.plan.action, placeId: r.plan.placeId!, label: r.plan.label, itemName: name, snapshot, matched: r.plan.matched, pairId: r.plan.pairId };
  }

  /** The shopper chose where an item picked up on open floor goes: extend a shelf, or a new shelf/area. */
  function placeChosen(productId: string, at: Point, choice: BuildChoice, snapshot: Snapshot): BuildOutcome {
    const r = moveHere({ products, layout, catalog }, productId, at, choice, !!display.buildDouble);
    const name = catalog.productById.get(productId)?.name ?? '';
    if (!r || r.plan.action === 'blocked') return { kind: 'blocked', itemName: name, snapshot };
    replaceLayout(r.layout);
    setProducts(() => r.products);
    return { kind: 'built', action: r.plan.action, placeId: r.plan.placeId!, label: r.plan.label, itemName: name, snapshot, matched: r.plan.matched, pairId: r.plan.pairId };
  }

  /**
   * Adds shelves (from "next shelf" or the skipped-shelves suggestion),
   * numbered in the order given. Returns their ids and what Undo restores.
   */
  function addShelves(shelves: Shelf[]): { placeIds: string[]; snapshot: Snapshot } {
    const snapshot: Snapshot = { items, products, layouts };
    let next = layout;
    const placeIds: string[] = [];
    for (const s of shelves) {
      const shelf: Shelf = { ...s, id: `s-${newId()}`, label: nextLabel(next, 'shelf'), categories: [] };
      next = { ...next, places: [...next.places, shelf] };
      placeIds.push(shelf.id);
    }
    replaceLayout(next);
    return { placeIds, snapshot };
  }

  // ---- Aisle brush ----
  const brush: Brush = { ...DEFAULT_BRUSH, ...display.brush };

  /**
   * One brush step: paints the sides along the next squares in `dir` and
   * moves you there. Returns what Back up restores (the store and saved spots).
   */
  function brushStep(dir: Direction, avoid: Rect[]): { snapshot: Snapshot; from: Point; painted: number; blocked: number; lane: Rect; shift: Point } {
    const snapshot: Snapshot = { items, products, layouts };
    const r = paintStep(layout, position, dir, brush, avoid);
    replaceLayout(r.layout);
    setProducts((prev) => prev.map((p) => {
      const k = p.locations?.[layout.id];
      const nk = k ? r.rekey(k) : k;
      return nk !== k ? { ...p, locations: { ...p.locations, [layout.id]: nk! } } : p;
    }));
    setPos({ layoutId: layout.id, point: r.position });
    return { snapshot, from: position, painted: r.painted, blocked: r.blocked, lane: r.lane, shift: r.shift };
  }

  /** Back up one brush step: the store and saved spots as they were, and you where you were. Items you ticked stay ticked. */
  function brushBack(step: { snapshot: Snapshot; from: Point }, original: Point) {
    if (step.snapshot.layouts) setLayouts(() => step.snapshot.layouts!);
    setProducts(() => step.snapshot.products);
    setPos({ layoutId: layout.id, point: original });
  }

  /** Turns a shelf the other way round where the shopper stands. Returns what Undo restores, or nothing if it can't turn. */
  function turnShelfHere(shelfId: string, pairId?: string): Snapshot | undefined {
    const snapshot: Snapshot = { items, products, layouts };
    const r = pairId ? turnPair(layout, shelfId, pairId, position) : turnShelf(layout, shelfId, position);
    if (!r) return undefined;
    replaceLayout(r.layout);
    setProducts((prev) => prev.map((p) => {
      const k = p.locations?.[layout.id];
      const nk = k ? r.rekey(k) : k;
      return nk !== k ? { ...p, locations: { ...p.locations, [layout.id]: nk! } } : p;
    }));
    return snapshot;
  }

  // ---- Where things are, in plain words ("aisle 7, left") ----

  // Check-off order per trip, per store (on this phone only), for learning the layout later.
  const [trips, setTrips] = usePersistentState<Trip[]>('aw.trips', []);

  // ---- Learning how the store is arranged from the trips ----
  /** What all the trips here say (including one in progress): for the one question. */
  const learned = useMemo(() => learnArrangement(layout, products, trips, catalog), [layout, products, trips, catalog]);
  /** Updates the generated map with what these trips clearly show. */
  function learnFrom(list: Trip[]) {
    const l = learnArrangement(layout, products, list, catalog);
    if (!Object.keys(l.apply).length) return;
    setLayouts((prev) => prev.map((x) => (x.id === layout.id && x.gen ? { ...x, gen: { ...x.gen, ...l.apply } } : x)));
    setNotice(`Map updated from your trips: ${describeArrangement(l.apply, buildModel(products, layout.id))}.`);
  }
  // Once per store per visit to the app, from the finished trips (not one in progress, so the map doesn't shift mid-shop).
  const learnedFor = useRef(new Set<string>());
  useEffect(() => {
    if (!layout.gen?.enabled || learnedFor.current.has(layout.id)) return;
    learnedFor.current.add(layout.id);
    const mine = trips.filter((t) => t.layoutId === layout.id);
    const last = mine[mine.length - 1];
    const lastAt = last?.picks[last.picks.length - 1]?.at ?? 0;
    learnFrom(last && Date.now() - lastAt < TRIP_GAP ? trips.filter((t) => t !== last) : trips);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.id, layout.gen?.enabled]);
  /** Which arrangement settings this store's map has (for Store settings). */
  const layoutHas = useMemo(() => {
    const m = buildModel(products, layout.id);
    const back = BACK_WALL.filter((d) => m.depts.includes(d)).map((d) => DEPTS.find((x) => x.id === d)!.name);
    return { aisles: m.aisles.length >= 2, produce: m.depts.includes('produce'), backWall: back.length >= 2 ? [back[0], back[back.length - 1]] as [string, string] : undefined };
  }, [products, layout.id]);
  /** The shopper's answer to the layout question (undefined: not sure). */
  function answerLayout(q: LayoutQuestion, option: number | undefined) {
    const gen = layout.gen;
    if (!gen) return;
    if (option === undefined) {
      setGen({ skipped: [...(gen.skipped ?? []), q.setting] });
      return;
    }
    setGen({ ...q.options[option].patch, sure: [...(gen.sure ?? []), q.setting] });
    setNotice('Thanks – the map is updated.');
  }
  function endTrip() {
    learnFrom(trips);
    setTrips((prev) => startTrip(prev, layout.id, Date.now()));
  }
  function notePick(item: ListItem, picked: boolean) {
    const product = productFor(item, catalog);
    setTrips((prev) => (picked
      ? recordPick(prev, layout.id, { ...(product && { productId: product.id }), name: product?.name ?? item.name, at: Date.now() })
      : unrecordPick(prev, layout.id, product?.name ?? item.name)));
  }

  /** Saves where a list item is in this store (on its master-list item, creating one if needed). Returns what Undo restores. */
  function setClue(item: ListItem, clue: Clue | undefined): Snapshot {
    const snapshot: Snapshot = { items, products, layouts };
    const apply = (p: Product): Product => {
      const clues = { ...p.clues };
      if (clue) clues[layout.id] = clue;
      else delete clues[layout.id];
      return { ...p, clues };
    };
    const product = productFor(item, catalog);
    if (product) {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? apply(p) : p)));
      if (item.productId !== product.id) setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, productId: product.id } : i)));
    } else {
      const created = apply({ id: `p-${newId()}`, name: capitalize(item.name.trim()) });
      setProducts((prev) => [...prev, created]);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, productId: created.id } : i)));
    }
    return snapshot;
  }

  /** Whether to ask "Where was it?" at check-off in this store. */
  const askWhere = !display.noAskStores?.includes(layout.id);
  const setAskWhere = (on: boolean) => setDisplay((d) => ({
    ...d,
    noAskStores: on ? (d.noAskStores ?? []).filter((id) => id !== layout.id) : [...(d.noAskStores ?? []).filter((id) => id !== layout.id), layout.id],
  }));

  /** Changes a list item's category (on its master-list item, creating one if needed). */
  function setItemCategory(item: ListItem, categoryId: string | undefined) {
    const product = productFor(item, catalog);
    if (product) {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, categoryId } : p)));
      if (item.productId !== product.id) setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, productId: product.id } : i)));
      return;
    }
    const created: Product = { id: `p-${newId()}`, name: capitalize(item.name.trim()), categoryId };
    setProducts((prev) => [...prev, created]);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, productId: created.id } : i)));
  }

  /** Edits a shelf or area in the current store (build mode's edit panel). */
  function updatePlace(placeId: string, patch: Partial<Place>) {
    replaceLayout({ ...layout, places: layout.places.map((p) => (p.id === placeId ? clampPlace({ ...p, ...patch } as Place, layout) : p)) });
  }

  /** What Undo puts back for a change to the current store. */
  const snapshotNow = (): Snapshot => ({ items, products, layouts });

  /** Adds a shelf (10 squares) or open area (6 × 4) centred where the map was tapped. */
  function addPlaceAt(kind: 'shelf-v' | 'shelf-h' | 'area', at: Point): { placeId: string; label: string; snapshot: Snapshot } {
    const snapshot = snapshotNow();
    const id = `${kind === 'area' ? 'a' : 's'}-${newId()}`;
    const place: Place = kind === 'area'
      ? { kind: 'area', id, label: nextLabel(layout, 'area'), x: at.x - 3, y: at.y - 2, w: 6, h: 4, categories: [] }
      : {
          kind: 'shelf', id, label: nextLabel(layout, 'shelf'),
          orientation: kind === 'shelf-h' ? 'horizontal' : 'vertical',
          x: kind === 'shelf-h' ? at.x - 5 : at.x,
          y: kind === 'shelf-h' ? at.y : at.y - 5,
          length: 10, categories: [],
        };
    replaceLayout({ ...layout, places: [...layout.places, clampPlace(place, layout)] });
    return { placeId: id, label: place.label, snapshot };
  }

  /** Puts the entrance or checkout on a square of the map (the tapped one, or where it was dragged). */
  function markAt(which: 'entrance' | 'checkout', at: Point) {
    setLayouts((prev) => prev.map((l) => (l.id === layout.id
      ? keepEdits(l, { ...l, [which]: { x: clamp(at.x, 0, l.width - 1), y: clamp(at.y, 0, l.height - 1) } })
      : l)));
  }

  // ---- Aisle labels ----
  const aisleApi = {
    add(rect: Rect, label: string): { id: string; snapshot: Snapshot } {
      const snapshot = snapshotNow();
      const r = addAisle(layout, rect, label);
      replaceLayout(r.layout);
      return { id: r.aisle.id, snapshot };
    },
    rename(id: string, label: string) {
      replaceLayout(renameAisle(layout, id, label));
    },
    remove(id: string): Snapshot {
      const snapshot = snapshotNow();
      replaceLayout(removeAisle(layout, id));
      return snapshot;
    },
  };

  // ---- Store settings (build mode) ----

  function renameStore(name: string) {
    replaceLayout({ ...layout, name });
  }

  /** Changes the store's size, keeping everything inside the walls. */
  function resizeStore(width: number, height: number) {
    const next = { ...layout, width: clamp(width, 10, 150), height: clamp(height, 10, 150) };
    const inside = (p: Point) => ({ x: Math.min(p.x, next.width - 1), y: Math.min(p.y, next.height - 1) });
    replaceLayout(clipAisles({ ...next, entrance: inside(layout.entrance), checkout: inside(layout.checkout), places: layout.places.map((p) => clampPlace(p, next)) }));
  }

  /** A copy of the current store (with its item locations), and switches to it. */
  function copyStore() {
    const id = `l-${newId()}`;
    const copy: StoreLayout = { ...structuredClone(layout), id, name: `${layout.name} copy` };
    setLayouts((prev) => [...prev, copy]);
    copyItemLocations(layout.id, id);
    setActiveId(id);
  }

  /** Deletes the current store (not the last one). Returns false if it wasn't deleted. */
  function deleteStore(): boolean {
    if (layouts.length <= 1) return false;
    if (!confirm(`Delete “${layout.name}”? This can’t be undone.`)) return false;
    const rest = layouts.filter((l) => l.id !== layout.id);
    setLayouts(() => rest);
    setActiveId(rest[0].id);
    return true;
  }

  function resetDemo(): Snapshot {
    const snapshot = snapshotNow();
    replaceLayout(structuredClone(demoLayout));
    return snapshot;
  }

  function deletePlace(placeId: string) {
    replaceLayout({ ...layout, places: layout.places.filter((p) => p.id !== placeId) });
  }

  function renamePlace(placeId: string, label: string) {
    replaceLayout({ ...layout, places: layout.places.map((p) => (p.id === placeId ? { ...p, label } : p)) });
  }

  function addAreaHere(): { placeId: string; snapshot: Snapshot } | undefined {
    const r = areaHere(layout, position);
    if (!r) return undefined;
    const snapshot = { items, products, layouts };
    replaceLayout(r.layout);
    return { placeId: r.area.id, snapshot };
  }

  function stepTo(dir: Direction) {
    const r = step(layout, position, dir);
    if (r.layout !== layout) replaceLayout(r.layout);
    setPos({ layoutId: layout.id, point: r.position });
  }

  function markHere(which: 'entrance' | 'checkout'): Snapshot {
    const snapshot: Snapshot = { items, products, layouts };
    replaceLayout({ ...layout, [which]: floor.snap(position) });
    return snapshot;
  }

  // ---- Which store: by location ----
  const [storesOpen, setStoresOpen] = useState(false);
  const [here, setHere] = useState<GeoPoint>();
  const [locating, setLocating] = useState<'finding' | 'off' | 'ok'>('off');
  /** Asks the phone where we are (it may ask permission the first time). */
  function locate(then?: (p: GeoPoint) => void) {
    if (!('geolocation' in navigator)) {
      setLocating('off');
      return;
    }
    setLocating('finding');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setHere(p);
        setLocating('ok');
        then?.(p);
      },
      () => setLocating('off'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }
  function openStores() {
    setStoresOpen(true);
    locate();
  }
  // Walking into a store you've shopped at: pick it automatically (only if location is already allowed – never asks on its own).
  useEffect(() => {
    let cancelled = false;
    navigator.permissions?.query({ name: 'geolocation' as PermissionName }).then((s) => {
      if (cancelled || s.state !== 'granted') return;
      locate((p) => {
        const at = storeHere(layoutsRef.current, p);
        if (at && at.id !== activeIdRef.current) {
          setActiveId(at.id);
          setNotice(`You’re at ${at.name}. Tap the store name to change.`);
        }
      });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  /** A new, empty store where you're standing (it learns its layout as you shop). */
  function newStoreHere(name: string) {
    const fresh = { ...blankStore(name), ...(here && { geo: here }) };
    setLayouts((prev) => [...prev, fresh]);
    setActiveId(fresh.id);
    setPos({ layoutId: fresh.id, point: fresh.entrance });
    setView('list');
  }

  function saveStoreHere() {
    if (!here) return;
    setLayouts((prev) => prev.map((l) => (l.id === layout.id ? { ...l, geo: here } : l)));
    setNotice(`${layout.name} will be picked when you’re here.`);
  }

  function startBlankStore() {
    const fresh = blankStore(`New store ${layouts.length + 1}`);
    setLayouts((prev) => [...prev, fresh]);
    setActiveId(fresh.id);
    setPos({ layoutId: fresh.id, point: fresh.entrance });
  }

  /** Sets (or clears, with `null`) where a master-list item is in the current store. */
  function setProductLocation(productId: string, spotKey: string | null) {
    setProducts((prev) => prev.map((p) => {
      if (p.id !== productId) return p;
      const locations = { ...p.locations };
      if (spotKey) locations[layout.id] = spotKey;
      else delete locations[layout.id];
      return { ...p, locations, notAt: p.notAt?.filter((id) => id !== layout.id) };
    }));
  }

  /**
   * Marks a list item as (not) available at the current store, adding it to the
   * master list if it's new. Returns what to restore for Undo.
   */
  function setAvailable(item: ListItem, available: boolean): QuickAddResult['snapshot'] {
    const snapshot = { items, products };
    const product = productFor(item, catalog);
    if (product) {
      setProducts((prev) => prev.map((p) => {
        if (p.id !== product.id) return p;
        const notAt = (p.notAt ?? []).filter((id) => id !== layout.id);
        return { ...p, notAt: available ? notAt : [...notAt, layout.id] };
      }));
    } else if (!available) {
      const created: Product = { id: `p-${newId()}`, name: capitalize(item.name.trim()), notAt: [layout.id] };
      setProducts((prev) => [...prev, created]);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, productId: created.id } : i)));
    }
    return snapshot;
  }

  /** A copied store starts with the same item locations and "not sold here" settings. */
  function copyItemLocations(fromId: string, toId: string) {
    setProducts((prev) => prev.map((p) => ({
      ...p,
      locations: p.locations?.[fromId] ? { ...p.locations, [toId]: p.locations[fromId] } : p.locations,
      clues: p.clues?.[fromId] ? { ...p.clues, [toId]: p.clues[fromId] } : p.clues,
      notAt: p.notAt?.includes(fromId) ? [...p.notAt, toId] : p.notAt,
    })));
  }

  // ---- Several lists ----

  /** How many things are still to buy on each list. */
  const listCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of allItems) if (!i.done) m.set(listOf(i), (m.get(listOf(i)) ?? 0) + 1);
    return m;
  }, [allItems]);

  function createList(name: string) {
    const id = `l-${newId()}`;
    setLists((prev) => [...(prev.some((l) => l.id === MAIN_LIST) ? prev : [...defaultLists, ...prev]), { id, name }]);
    setActiveListId(id);
  }

  function renameList(id: string, name: string) {
    setLists((prev) => {
      const base = prev.some((l) => l.id === MAIN_LIST) ? prev : [...defaultLists, ...prev];
      return base.map((l) => (l.id === id ? { ...l, name } : l));
    });
  }

  /** Deletes a list and its items (not the main list). */
  function deleteList(id: string) {
    if (id === MAIN_LIST) return;
    setLists((prev) => prev.filter((l) => l.id !== id));
    setAllItems((all) => removeList(all, id));
    if (listId === id) setActiveListId(MAIN_LIST);
  }

  /** Copies what's still to buy on other lists onto this one. Returns what Undo restores and the counts. */
  function combineInto(sources: string[]): { added: number; skipped: number; snapshot: Snapshot } {
    const snapshot: Snapshot = { items, products, layouts };
    const r = combineLists(allItems, listId, sources, catalog);
    setAllItems(() => r.items);
    return { added: r.added, skipped: r.skipped, snapshot };
  }

  function addToList(product: Product) {
    setItems((prev) => [...prev, { id: newId(), name: product.name, done: false, productId: product.id }]);
  }

  function shareList() {
    const share = buildListShare(items, catalog);
    setSending({ title: 'your list', summary: `${share.items.length} item${share.items.length === 1 ? '' : 's'} still to get.`, share });
  }

  function shareStore(l: StoreLayout) {
    const share = buildStoreShare(l, catalog);
    const located = share.items.filter((i) => i.at).length;
    const unavailable = share.items.filter((i) => i.notAvailable).length;
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const summary = `The store layout and ${plural(located, 'item location')}`
      + (unavailable ? `, plus ${plural(unavailable, 'item')} not available there.` : '.');
    setSending({ title: `“${l.name}”`, summary, share });
  }

  const data = () => ({ items, products, categories, layouts });

  function importList() {
    if (!incoming || incoming === 'error' || incoming.kind !== 'list') return;
    const r = applyListShare(incoming, data());
    setCategories(() => r.categories);
    setProducts(() => r.products);
    setItems(() => r.items);
    setIncoming(null);
    setView('list');
    setNotice(`Added ${r.added} item${r.added === 1 ? '' : 's'} to your list${r.skipped ? ` (${r.skipped} already on it)` : ''}.`);
  }

  function importStore(replaceId?: string) {
    if (!incoming || incoming === 'error' || incoming.kind !== 'store') return;
    const r = applyStoreShare(incoming, data(), replaceId);
    setCategories(() => r.categories);
    setProducts(() => r.products);
    setLayouts(() => r.layouts);
    setActiveId(r.layoutId);
    setIncoming(null);
    setView('list');
    const name = r.layouts.find((l) => l.id === r.layoutId)?.name;
    setNotice(replaceId ? `Updated “${name}”.` : `Added “${name}”. You’re now shopping there.`);
  }

  const tab = (id: View, label: string) => (
    <button role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
      {label}
    </button>
  );

  return (
    <div className="app">
      <header className="top">
        <div className="title">
          <div className="title-line">
            <h1>Aisle Wise</h1>
            <HouseholdButton api={household} onClick={() => setHouseholdOpen(true)} />
            {view === 'list' && (
              <button className="info-btn" aria-pressed={showHint} aria-label="How this works" title="How this works" onClick={() => setShowHint((v) => !v)}>ⓘ</button>
            )}
          </div>
          <div className="title-sub">
            <button className="store-pick" onClick={openStores} aria-label={`Store: ${layout.name}. Change store`}>
              {layout.name} <span aria-hidden="true">▾</span>
            </button>
            {view === 'list' && (
              <ListBar name={lists.find((l) => l.id === listId)?.name ?? 'Shopping list'} count={lists.length} onOpen={() => setListsOpen(true)} />
            )}
          </div>
        </div>
        {view === 'list' && (
          <div className="top-right">
            {items.length > done && (
              <button className="btn share-btn" onClick={shareList} aria-label="Share list">Share</button>
            )}
            <div className="progress" aria-label="Progress">
              <strong>{done}</strong>/{items.length}
            </div>
          </div>
        )}
      </header>

      <nav className="tabs" role="tablist">
        {tab('items', 'Items')}
        {tab('list', 'Shop')}
      </nav>

      {view === 'list' && (
        <ShoppingView
          key={listId}
          listsOpen={listsOpen}
          showHint={showHint}
          onListsClose={() => setListsOpen(false)}
          lists={{
            all: lists, current: listId, counts: listCounts, switchTo: setActiveListId,
            create: createList, rename: renameList, remove: deleteList, combine: combineInto,
            preview: (sources) => combineLists(allItems, listId, sources, catalog),
          }}
          layout={layout}
          floor={floor}
          catalog={catalog}
          items={items}
          setItems={setItems}
          setLocation={setLocation}
          quickAdd={quickAdd}
          build={{
            pickUpHere, moveHereAndBuild, placeChosen, addShelves, turnShelfHere, renamePlace, addAreaHere, stepTo, markHere,
            startBlankStore, updatePlace, deletePlace, snapshot: snapshotNow, addPlaceAt, markAt, brushStep, brushBack, aisles: aisleApi,
            store: {
              layouts, renameStore, resizeStore, copyStore, deleteStore, shareStore: () => shareStore(layout), resetDemo, isDemo: layout.id === demoLayout.id,
              gen: layout.gen, setGen, answers: products.filter((p) => p.clues?.[layout.id]).length, question: learned.question, answer: answerLayout, layoutHas,
            },
          }}
          setItemCategory={setItemCategory}
          where={{ ask: askWhere, setAsk: setAskWhere, setClue, notePick, newTrip: endTrip, question: learned.question, answer: answerLayout }}
          undo={undo}
          setProductLocation={setProductLocation}
          setAvailable={setAvailable}
          position={position}
          setPosition={(point) => setPos({ layoutId: layout.id, point })}
          onEditLayout={() => setDisplay((d) => ({ ...d, buildMode: true }))}
          display={display}
          setDisplay={setDisplay}
          mapLook={mapLook}
          looks={looks}
        />
      )}
      {view === 'items' && (
        <ItemsView
          catalog={catalog}
          layouts={layouts}
          layout={layout}
          setProducts={setProducts}
          setCategories={setCategories}
          setLayouts={setLayouts}
          onAddToList={addToList}
          onList={onList}
          listName={lists.find((l) => l.id === listId)?.name ?? 'Shopping list'}
          snapshot={snapshotNow}
          undo={undo}
        />
      )}
      {storesOpen && (
        <StoreSheet
          layouts={layouts}
          activeId={layout.id}
          here={here}
          locating={locating}
          onPick={(id) => setActiveId(id)}
          onNew={newStoreHere}
          onSaveHere={saveStoreHere}
          onClose={() => setStoresOpen(false)}
        />
      )}
      {householdOpen && (
        <HouseholdSheet
          api={household}
          joinCode={household.household ? undefined : joinCode}
          onClose={() => { setHouseholdOpen(false); setJoinCode(undefined); }}
        />
      )}
      {sending && <ShareSheet {...sending} onClose={() => setSending(null)} />}
      {incoming && (
        <ImportSheet
          share={incoming}
          layouts={layouts}
          onAddList={importList}
          onAddStore={importStore}
          onCancel={() => setIncoming(null)}
        />
      )}
      {notice && <div className="toast top" role="status"><span className="toast-text">{notice}</span></div>}
    </div>
  );
}

/**
 * The previous version kept taught locations in a separate table keyed by
 * item name. Move them onto master-list items once, then drop the table.
 */
function useMoveOldLocationsIntoProducts(setProducts: (fn: (prev: Product[]) => Product[]) => void) {
  useEffect(() => {
    let old: Record<string, Record<string, string>> | null = null;
    try {
      old = JSON.parse(localStorage.getItem('aw.learned.v2') ?? 'null');
    } catch {
      return;
    }
    if (!old) return;
    setProducts((prev) => {
      const next = [...prev];
      for (const [layoutId, byName] of Object.entries(old!)) {
        for (const [name, spot] of Object.entries(byName)) {
          let i = next.findIndex((p) => normalize(p.name) === name);
          if (i < 0) {
            next.push({ id: `p-${newId()}`, name: capitalize(name) });
            i = next.length - 1;
          }
          next[i] = { ...next[i], locations: { ...next[i].locations, [layoutId]: spot } };
        }
      }
      return next;
    });
    try {
      localStorage.removeItem('aw.learned.v2');
    } catch {
      // ignore
    }
  }, [setProducts]);
}
