/** Per-phone display choices. */
export interface Display {
  mapColors: boolean;
  mapIcons: boolean;
  listColors: boolean;
  /** Build the store map from where you pick things up. */
  buildMode: boolean;
}

export const defaultDisplay: Display = { mapColors: true, mapIcons: true, listColors: true, buildMode: false };

/** How to colour and label category sections on the map. Leave a function out to hide that. */
export interface SectionLook {
  colorOf?: (categoryId: string) => string | undefined;
  iconOf?: (categoryId: string) => string | undefined;
}
