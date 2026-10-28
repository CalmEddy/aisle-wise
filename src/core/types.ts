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
}

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
}

/** A label for a walkway: the rectangle of floor it names. */
export interface AisleLabel {
  id: string;
  label: string;
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
}

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
