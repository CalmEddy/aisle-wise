/** How the shopping list is ordered. */
export type ListSort = 'nearest' | 'category' | 'alpha';

/** Per-phone display choices. */
export interface Display {
  mapColors: boolean;
  mapIcons: boolean;
  listColors: boolean;
  /** Category icon next to each item in the list. */
  listIcons?: boolean;
  /**
   * Legacy: grouped-by-shelf vs flat nearest. Prefer `listSort`; kept so older
   * saved phones still load. Both legacy values now resolve to nearest.
   */
  groupList?: boolean;
  /**
   * How to order the shopping list (nearest / category / A–Z).
   * Legacy saved value `"route"` is treated as nearest.
   */
  listSort?: ListSort | 'route';
  /** Show items' categories and subcategories in the shopping list (beside where it is). */
  listCategories?: boolean;
  /** Group shopping-list rows under category headings. */
  listGroupByCategory?: boolean;
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
  const raw = d.listSort;
  // "route" was removed (same results as nearest); map it and legacy groupList to nearest.
  if (raw === 'route' || raw === undefined) return 'nearest';
  return raw;
}

/** How to colour and label category sections on the map. Leave a function out to hide that. */
export interface SectionLook {
  colorOf?: (categoryId: string) => string | undefined;
  iconOf?: (categoryId: string) => string | undefined;
}
