import type { ReactNode } from 'react';
import type { Display, ItemsSort, ListSort } from '../display';
import { resolveItemsSort, resolveListSort } from '../display';

/** Display settings that are on/off switches. */
type Switch = { [K in keyof Display]-?: NonNullable<Display[K]> extends boolean ? K : never }[keyof Display];

/** Full names, for screen readers and tooltips. */
const LABELS: Record<Switch, string> = {
  mapColors: 'Colors on map',
  mapIcons: 'Icons on map',
  groupList: 'Group by section',
  listCategories: 'Categories in list',
  listGroupByCategory: 'Group by category',
  itemsGroupByCategory: 'Group by category',
  listQty: 'Quantity stepper',
  listPrice: 'Prices',
  listLocation: 'Location under name',
  listColors: 'Colors in list',
  listIcons: 'Icons in list',
  buildMode: 'Build mode',
  buildArea: 'Build areas',
  buildDouble: 'Double shelves',
  mapFull: 'Whole map',
  buildMoreTools: 'More build tools',
};

/** What the compact switch shows. */
const SHORT: Record<Switch, string> = {
  buildMode: '🛠 Edit map',
  groupList: '☰',
  listCategories: '🏷',
  listGroupByCategory: '☰',
  itemsGroupByCategory: '☰',
  listQty: '×',
  listPrice: '$',
  listLocation: '📍',
  mapColors: '🎨',
  mapIcons: '🍎',
  listColors: '🎨',
  listIcons: '🍎',
  buildArea: 'Areas',
  buildDouble: 'Double',
  mapFull: '🗺',
  buildMoreTools: '⋯',
};

/** Switches shown together under a heading ("List 🎨 🍎"). Field toggles (🏷 × 📍) stay individual. */
const GROUPS: { name: string; keys: Switch[] }[] = [
  { name: 'List', keys: ['listColors', 'listIcons'] },
  { name: 'Map', keys: ['mapColors', 'mapIcons'] },
];

const SORTS: { id: ListSort; short: string; label: string }[] = [
  { id: 'nearest', short: '◎', label: 'Sort nearest first' },
  { id: 'category', short: '🏷︎', label: 'Sort by category' },
  { id: 'alpha', short: 'A–Z', label: 'Sort alphabetically' },
];

/**
 * Cycles the shopping-list order: nearest → category → A–Z.
 * Shown on the list strip so shoppers can change sort without opening settings.
 */
export function ListSortToggle({ display, setDisplay }: {
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
}) {
  const current = resolveListSort(display);
  const i = SORTS.findIndex((s) => s.id === current);
  const next = SORTS[(i + 1) % SORTS.length]!;
  const shown = SORTS[i >= 0 ? i : 0]!;
  return (
    <button
      type="button"
      className={`toggle${shown.short.length <= 2 ? ' icon-only' : ''}`}
      aria-label={`${shown.label} (tap for ${next.label})`}
      title={`${shown.label} · tap to change`}
      onClick={() => setDisplay((d) => ({ ...d, listSort: next.id }))}
    >
      {shown.short}
    </button>
  );
}

const ITEM_SORTS: { id: ItemsSort; short: string; label: string }[] = [
  { id: 'category', short: '🏷︎', label: 'Sort by category' },
  { id: 'alpha', short: 'A–Z', label: 'Sort alphabetically' },
];

/**
 * Cycles Grocery Items catalog order: category → A–Z.
 * Same toggle chrome as Shop; nearest is omitted (no shopper position).
 */
export function ItemsSortToggle({ display, setDisplay }: {
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
}) {
  const current = resolveItemsSort(display);
  const i = ITEM_SORTS.findIndex((s) => s.id === current);
  const next = ITEM_SORTS[(i + 1) % ITEM_SORTS.length]!;
  const shown = ITEM_SORTS[i >= 0 ? i : 0]!;
  return (
    <button
      type="button"
      className={`toggle${shown.short.length <= 2 ? ' icon-only' : ''}`}
      aria-label={`${shown.label} (tap for ${next.label})`}
      title={`${shown.label} · tap to change`}
      onClick={() => setDisplay((d) => ({ ...d, itemsSort: next.id }))}
    >
      {shown.short}
    </button>
  );
}

/**
 * On/off switches in one compact row: short labels (full names on hover and
 * for screen readers), with the colour/icon pairs grouped as "Map 🎨 🍎" and
 * "List 🎨 🍎". `extra` goes at the end of the row.
 */
export function DisplayToggles({ display, setDisplay, show, offByDefault = ['buildMode', 'buildArea', 'buildDouble'], lead, extra }: {
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
  show: Switch[];
  /** Switches that start off when never set. */
  offByDefault?: Switch[];
  /** Goes at the start of the row (e.g. the add button). */
  lead?: ReactNode;
  extra?: ReactNode;
}) {
  const on = (k: Switch) => display[k] ?? !offByDefault.includes(k);
  const button = (k: Switch) => (
    <button
      key={k}
      type="button"
      className={`toggle${SHORT[k].length <= 2 ? ' icon-only' : ''}`}
      aria-pressed={on(k)}
      aria-label={LABELS[k]}
      title={LABELS[k]}
      onClick={() => setDisplay((d) => ({ ...d, [k]: !(d[k] ?? !offByDefault.includes(k)) }))}
    >
      {SHORT[k]}
    </button>
  );
  const grouped = new Set(GROUPS.flatMap((g) => g.keys));
  return (
    <div className="toggles" role="group" aria-label="Display">
      {lead}
      {show.filter((k) => !grouped.has(k)).map(button)}
      {GROUPS.map((g) => {
        const keys = g.keys.filter((k) => show.includes(k));
        if (!keys.length) return null;
        return (
          <span key={g.name} className="toggle-group" role="group" aria-label={g.name}>
            <span className="toggle-group-name">{g.name}</span>
            {keys.map(button)}
          </span>
        );
      })}
      {extra}
    </div>
  );
}
