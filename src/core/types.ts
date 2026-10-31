import type { LabelStyle } from './labels';
/** A square on the store's floor grid. x runs left→right, y runs top→bottom. */
export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Orientation = 'vertical' | 'horizontal';

interface PlaceBase {
  id: string;
  /** Shown on the map (on the shelf itself, for shelves) and in the list. */
  label: string;
  /** Top-left corner, in grid squares. */
  x: number;
  y: number;
  /** Category ids stocked here, in order along the shelf (top/left first) or across the area. */
  categories: string[];
  /** Generated from aisle answers but not confirmed by any (drawn dashed). */
  guess?: boolean;
  /** A freezer or a fridge (cold case), not room-temperature shelving. */
  temp?: Temp;
}

/** Freezer or fridge. */
export type Temp = 'frozen' | 'chilled';

/** A shelf: a single run of shelving, one square thick, reachable from either side. */
export interface Shelf extends PlaceBase {
  kind: 'shelf';
  orientation: Orientation;
  /** Length in grid squares. */
  length: number;
  /**
   * A wall shelf: stocked from one side only. This is the closed side (its
   * back): -1 = left (vertical) or top (horizontal), 1 = right or bottom.
   * Missing: open on both sides.
   */
  back?: -1 | 1;
}

/** An open, walkable rectangle such as Produce or the Deli counter. */
export interface Area extends PlaceBase {
  kind: 'area';
  w: number;
  h: number;
}

export type Place = Shelf | Area;

export interface StoreLayout {
  id: string;
  name: string;
  width: number;
  height: number;
  places: Place[];
  entrance: Point;
  checkout: Point;
  /** Named walkways ("Aisle 5"), drawn along the space between shelves. */
  aisles?: AisleLabel[];
  /** How this store labels its shelves, when not by aisle number ("B12"). */
  labels?: LabelStyle;
  /** Map generated from shoppers' aisle answers ("Where was it?"). */
  gen?: GeneratedMap;
  /** Where the store is (for picking it automatically when you walk in). */
  geo?: GeoPoint;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** How a generated store is arranged, beyond which corner the entrance is in. Unset means the usual. */
export interface Arrangement {
  /** Aisle 1 on the right, numbers going up to the left (usual: 'near'), or aisle 1 on the left ('far'). */
  aisleOne?: 'near' | 'far';
  /** Produce up the right wall and Frozen down the left (usual: 'near'), or the other way round ('far'). */
  produce?: 'near' | 'far';
  /** The back-wall departments in the usual order left to right (Dairy, Seafood, Meat), or reversed. */
  backWall?: 'usual' | 'reversed';
}

/** A generated-map setting the app can learn or ask about. */
export type LayoutSetting = 'entrance' | keyof Arrangement;

/** Settings for a store map generated from aisle answers. */
export interface GeneratedMap extends Arrangement {
  /** Regenerate automatically when answers change. */
  enabled: boolean;
  /** No longer used: every generated map has its entrance in the middle of the front (kept so older saved maps load). */
  entrance: 'left' | 'right';
  /** Generated parts (by id) the shopper changed or deleted: never regenerated. */
  locked: string[];
  /** What the current map was generated from (to know when to regenerate). */
  key?: string;
  /** Settings the shopper chose or answered: never changed by learning. */
  sure?: LayoutSetting[];
  /** Settings the shopper wasn't sure about when asked: not asked again. */
  skipped?: LayoutSetting[];
  /** Where the shopper placed things relative to others (by part: "sec:bakery", "isl:…"). */
  placements?: Record<string, Placement>;
  /** Parts the shopper wasn't sure where to place: not asked again. */
  placementsSkipped?: string[];
  /** Runs of aisles drawn as their own block ("aisles:7" = aisles 7 to 10), e.g. running side to side below the rest. */
  aisleGroups?: { from: string; to: string }[];
  /**
   * What the shopper put on each wall, in order (side walls front to back, the back wall left to
   * right), by section key ("produce", "left-chilled"). Departments not heard of yet can be here too.
   */
  wallOrder?: Record<MainWall, string[]>;
  /** The shopper's been offered the departments screen and closed it: not offered again. */
  wallsOffered?: boolean;
  /** Where the door is along the front, 0 (left) to 1 (right); unset: the middle. */
  door?: number;
  /** Which way each block's shelves run ("block:C", "aisles:7"); unset: up and down (aisle groups: side to side). */
  directions?: Record<string, Orientation>;
  /** How a section's shelves are shaped ("block:A" → short stubs, or split in two by a walkway); long when not said. */
  shapes?: Record<string, SectionShape>;
}

/**
 * Where something goes, relative to something already on the map: next to
 * a wall section (before or after it along the wall: side walls run front to
 * back, the back wall left to right), on an empty wall ("wall:left"), or out
 * in the open by an aisle ("aisle:5").
 */
export interface Placement {
  /** "sec:<wall section>", "block:<shelf section>", "wall:left|back|right" or "aisle:<label>". */
  of: string;
  /** Along a wall: before or after it; shelf sections: left of, right of, above (behind) or below (in front of) it. */
  side?: 'before' | 'after' | 'left' | 'right' | 'above' | 'below';
}

/** A label for a walkway: the rectangle of floor it names. */
export interface AisleLabel {
  id: string;
  label: string;
  /** Generated, but no answer mentions this aisle yet (drawn faint). */
  guess?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ListItem {
  id: string;
  name: string;
  done: boolean;
  /** The master-list item this was added from, if any. */
  productId?: string;
  /** Which shopping list it's on. Missing means the main list (MAIN_LIST). */
  listId?: string;
  /** How many (missing means one). */
  qty?: number;
  /** A note for whoever shops ("the big tub", "2 lb"). */
  note?: string;
}

/** A named shopping list, e.g. "Weekly staples" or "Taco night". */
export interface ShoppingList {
  id: string;
  name: string;
}

/** The first list everyone has. Items saved before there were several lists belong to it. */
export const MAIN_LIST = 'main';

/** A kind of product, e.g. Dairy. Places in a layout list the categories they stock. */
export interface Category {
  id: string;
  name: string;
  /** CSS colour, e.g. #4caf50. Defaults per category (see categories.ts). */
  color?: string;
  /** An emoji. */
  icon?: string;
}

/** An item in the master grocery list. */
export interface Product {
  id: string;
  name: string;
  categoryId?: string;
  /** Layout id → spot key, where the user said this item is in that store. */
  locations?: Record<string, string>;
  /** Layout ids of stores that don't sell this item. */
  notAt?: string[];
  /**
   * Layout id → where the shopper said it was, in plain store terms ("aisle 7,
   * left, middle", "Produce"). Independent of the map, so maps can be
   * regenerated without losing it.
   */
  clues?: Record<string, Clue>;
}

/** A side of an aisle, as you walk in from the front of the store. */
export type AisleSide = 'L' | 'R';
/** How far along an aisle, from the front of the store. */
export type AislePos = 'front' | 'middle' | 'back';
/** Store departments (usually around the walls). */
export type Dept = 'produce' | 'floral' | 'bakery' | 'deli' | 'meat' | 'seafood' | 'dairy' | 'frozen' | 'pharmacy';

/** Where an item was found, in the words a store uses. */
export type Clue =
  /** In a numbered aisle; `temp` when it was in a fridge or freezer there. */
  | { kind: 'aisle'; aisle: string; side?: AisleSide; pos?: AislePos; temp?: Temp }
  | { kind: 'dept'; dept: Dept }
  /** Along a wall, as you face into the store from the entrance. */
  | { kind: 'wall'; wall: Wall; part?: WallPart; temp?: Temp }
  /** Out in the open: a table, case or stand on the floor, not against a wall or in an aisle. */
  /** `n`: which one, when there's more than one like it ("another table near the door" is 2). */
  | { kind: 'open'; near?: OpenNear; aisle?: string; fixture?: Fixture; temp?: Temp; across?: Across; n?: number }
  /** A labelled shelf in a store that labels shelves, not aisles ("B12": section B, shelf 12). */
  | { kind: 'shelf'; code: string; section: string; shelf?: number; temp?: Temp }
  /** Older answers: a freezer case in an aisle, or along a wall (no aisle). */
  | { kind: 'freezer'; aisle?: string; side?: AisleSide; pos?: AislePos }
  /** The display at the end of an aisle. */
  | { kind: 'endcap'; aisle: string; end: 'front' | 'back' }
  /** Older answers: a display near an aisle or in a department. */
  | { kind: 'display'; aisle?: string; dept?: Dept }
  | { kind: 'checkout' };

/** The walls, as you face into the store from the entrance. */
/** A wall of the store. The front wall runs along the bottom line, either side of the door. */
export type Wall = 'left' | 'back' | 'right' | 'front';
/** The walls departments line (the departments screen): not the front, which has the door and checkouts. */
export type MainWall = Exclude<Wall, 'front'>;
/** Where along a wall: front/middle/back for the side walls, left/middle/right for the back wall. */
export type WallPart = 'front' | 'middle' | 'back' | 'left' | 'right';
/** Where out in the open. */
/** A section's shelves: full length, short stubs, or two short runs with a walkway between. */
export type SectionShape = 'long' | 'short' | 'split';
export type OpenNear = 'entrance' | 'middle' | 'far' | 'back';
export type Fixture = 'table' | 'case' | 'stand';
/** Out in the middle of a block, across aisles (or sections) `from`–`to`, at its front, middle or back: the shelves there make way. */
export interface Across { from: string; to: string; part?: AislePos }

/** A spot where items are picked up. */
export interface Spot {
  /**
   * `placeId` (anywhere in the place), `placeId:categoryId` (where that
   * category is stocked), or `placeId@u,v` (an exact spot, see geometry.ts).
   */
  key: string;
  placeId: string;
  /** The place's label, e.g. "Aisle 4". */
  placeLabel: string;
  /** Where in the place, e.g. "left side, middle" or "Pasta & Rice". */
  detail?: string;
  /** `placeLabel · detail`. */
  label: string;
  /** Walking target (a floor square). */
  point: Point;
  /** Where to draw the item on the map (grid units, may be on a shelf). */
  mark: { x: number; y: number };
}

export interface Stop extends Spot {
  items: ListItem[];
}
