/** How the shopping list is ordered. */
export type ListSort = 'route' | 'nearest' | 'category' | 'alpha';

/** Per-phone display choices. */
export interface Display {
  mapColors: boolean;
  mapIcons: boolean;
  listColors: boolean;
  /** Category icon next to each item in the list. */
  listIcons?: boolean;
  /**
   * Group the shopping list by shelf/area (off: one list, nearest first).
   * Prefer `listSort`; kept so older saved phones still load.
   */
  groupList?: boolean;
  /** How to order the shopping list (route / nearest / category / A–Z). */
  listSort?: ListSort;
  /** Show items' categories and subcategories in the shopping list (headings, or beside where it is). */
  listCategories?: boolean;
  /** Show the −/＋ quantity stepper on shopping rows (default on). */
  listQty?: boolean;
  /** Show where-it-is under each item name (aisle / place line; default on). */
  listLocation?: boolean;
  /** Build the store map from where you pick things up. */
  buildMode: boolean;
  /** In build mode, what picking up on open floor makes. */
  buildArea?: boolean;
  /** New shelves come in back-to-back pairs. */
  buildDouble?: boolean;
  /** Walkway width (squares) between shelves in a shelf block. */
  blockLane?: number;
  /** Show the whole map while shopping (otherwise a strip around you and the next stop). */
  mapFull?: boolean;
  /** Build mode shows every tool (single shelves, cut, entrance, checkout), not just the main four. */
  buildMoreTools?: boolean;
  /** Stores where the app doesn't ask "Where was it?" at check-off. */
  noAskStores?: string[];
  /** Stores where "Where was it?" waits for checkout (one list) instead of asking at each check-off. */
  askAtCheckout?: string[];
  /** The aisle brush's sides and walkway width. */
  brush?: { left: 'shelf' | 'wall' | 'gap'; right: 'shelf' | 'wall' | 'gap'; width: number; leftCategory?: string; rightCategory?: string; aisleLabel?: string };
}

export const defaultDisplay: Display = { mapColors: true, mapIcons: true, listColors: true, listIcons: true, buildMode: false };

/** Resolve the list order from new `listSort` or the older `groupList` flag. */
export function resolveListSort(d: Pick<Display, 'listSort' | 'groupList'>): ListSort {
  if (d.listSort) return d.listSort;
  return (d.groupList ?? true) ? 'route' : 'nearest';
}

/** How to colour and label category sections on the map. Leave a function out to hide that. */
export interface SectionLook {
  colorOf?: (categoryId: string) => string | undefined;
  iconOf?: (categoryId: string) => string | undefined;
}
