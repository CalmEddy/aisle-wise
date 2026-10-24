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
  label: string;
  /** Top-left corner of the place's footprint, in grid squares. */
  x: number;
  y: number;
  /** Category ids stocked here, in order along the aisle/area. */
  categories: string[];
}

/** A walkway with a row of shelves on each long side. */
export interface Aisle extends PlaceBase {
  kind: 'aisle';
  orientation: Orientation;
  /** Length of the aisle in grid squares. */
  length: number;
  /** Width of the walkway between the two shelves. */
  width: number;
}

/** An open, walkable rectangle such as Produce or the Deli counter. */
export interface Area extends PlaceBase {
  kind: 'area';
  w: number;
  h: number;
}

export type Place = Aisle | Area;

export interface StoreLayout {
  id: string;
  name: string;
  width: number;
  height: number;
  places: Place[];
  entrance: Point;
  checkout: Point;
}

export interface ListItem {
  id: string;
  name: string;
  done: boolean;
  /** The master-list item this was added from, if any. */
  productId?: string;
}

/** A kind of product, e.g. Dairy. Places in a layout list the categories they stock. */
export interface Category {
  id: string;
  name: string;
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
