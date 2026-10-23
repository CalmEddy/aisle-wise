/** A spot on the store floor plan. x runs left→right, y runs front (0) → back. */
export interface Point {
  x: number;
  y: number;
}

/** A place in the store where products live, e.g. "Aisle 3 – Pasta". */
export interface Section {
  id: string;
  name: string;
  /** Short label shown on chips and the map, e.g. "A3" or "Produce". */
  short: string;
  point: Point;
}

export interface StoreLayout {
  id: string;
  name: string;
  width: number;
  /** Distance from the front cross-aisle (y = 0) to the back cross-aisle. */
  depth: number;
  /** x positions of the walkable aisles that run front-to-back. */
  aisleXs: number[];
  entrance: Point;
  checkout: Point;
  sections: Section[];
  /** Keyword → section id. Multi-word keywords are allowed. */
  catalog: Record<string, string>;
}

export interface ListItem {
  id: string;
  name: string;
  done: boolean;
  /** Set by the user when the app couldn't place the item. */
  sectionId?: string;
}

/** One stop on the route: a section and the items to grab there. */
export interface Stop {
  section: Section;
  items: ListItem[];
}
