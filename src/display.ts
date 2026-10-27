/** Per-phone display choices. */
export interface Display {
  mapColors: boolean;
  mapIcons: boolean;
  listColors: boolean;
  /** Category icon next to each item in the list. */
  listIcons?: boolean;
  /** Group the shopping list by shelf/area (off: one list, nearest first). */
  groupList?: boolean;
  /** Build the store map from where you pick things up. */
  buildMode: boolean;
  /** In build mode, what picking up on open floor makes. */
  buildArea?: boolean;
  /** New shelves come in back-to-back pairs. */
  buildDouble?: boolean;
  /** Walkway width (squares) between shelves in a shelf block. */
  blockLane?: number;
}

export const defaultDisplay: Display = { mapColors: true, mapIcons: true, listColors: true, listIcons: true, buildMode: false };

/** How to colour and label category sections on the map. Leave a function out to hide that. */
export interface SectionLook {
  colorOf?: (categoryId: string) => string | undefined;
  iconOf?: (categoryId: string) => string | undefined;
}
