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
}

/** A spot where items are picked up: a place, optionally narrowed to one category. */
export interface Spot {
  /** `placeId` or `placeId:categoryId`. */
  key: string;
  placeId: string;
  label: string;
  point: Point;
}

export interface Stop extends Spot {
  items: ListItem[];
}

/** Item name (normalized) → spot key, taught by the user for one layout. */
export type Learned = Record<string, string>;
