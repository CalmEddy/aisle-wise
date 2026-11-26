import type { ReactNode } from 'react';
import type { Display, ItemsSort, ListSort, ListsEditSort } from '../display';
import { resolveItemsSort, resolveListSort, resolveListsEditSort } from '../display';
import { Icon, type IconName } from './Icon';

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
  buildMode: 'Edit map',
  buildArea: 'Map areas',
  buildDouble: 'Double shelves',
  mapFull: 'Whole map',
  buildMoreTools: 'More build tools',
};

/** What each switch shows: an icon and a short word (the full name is its accessible name). */
const CHIPS: Record<Switch, { icon: IconName; word: string }> = {
  buildMode: { icon: 'map', word: 'Edit map' },
  groupList: { icon: 'layers', word: 'Sections' },
  listCategories: { icon: 'tag', word: 'Category' },
  listGroupByCategory: { icon: 'layers', word: 'Group' },
  itemsGroupByCategory: { icon: 'layers', word: 'Group' },
  listQty: { icon: 'hash', word: 'Qty' },
  listPrice: { icon: 'dollar-sign', word: 'Price' },
  listLocation: { icon: 'map-pin', word: 'Place' },
  mapColors: { icon: 'palette', word: 'Colors' },
  mapIcons: { icon: 'smile', word: 'Icons' },
  listColors: { icon: 'palette', word: 'Colors' },
  listIcons: { icon: 'smile', word: 'Icons' },
  buildArea: { icon: 'layers', word: 'Areas' },
  buildDouble: { icon: 'layers', word: 'Double' },
  mapFull: { icon: 'map', word: 'Whole map' },
  buildMoreTools: { icon: 'ellipsis', word: 'More' },
};

/** Switches shown together under a heading ("List: Colors, Icons"). Field toggles (Category, Qty, Place) stay individual. */
const GROUPS: { name: string; keys: Switch[] }[] = [
  { name: 'List', keys: ['listColors', 'listIcons'] },
  { name: 'Map', keys: ['mapColors', 'mapIcons'] },
];

type SortOption<T extends string> = { id: T; icon: IconName; word: string; label: string };

/**
 * All the ways to order a list, side by side, with the current one marked.
 * (Replaces the single button that cycled through them.)
 */
function SortSegment<T extends string>({ options, value, onPick, name = 'Sort' }: {
  options: SortOption<T>[];
  value: T;
  onPick: (id: T) => void;
  name?: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={name}>
      <span className="seg-name" aria-hidden="true">{name}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          aria-label={o.label}
          title={o.label}
          className={`seg-btn${o.id === value ? ' on' : ''}`}
          onClick={() => onPick(o.id)}
        >
          <Icon name={o.icon} />
          <span>{o.word}</span>
        </button>
      ))}
    </div>
  );
}

const SORTS: SortOption<ListSort>[] = [
  { id: 'nearest', icon: 'locate-fixed', word: 'Nearest', label: 'Sort nearest first' },
  { id: 'category', icon: 'tag', word: 'Category', label: 'Sort by category' },
  { id: 'alpha', icon: 'arrow-down-a-z', word: 'A–Z', label: 'Sort alphabetically' },
];

/** Shop list order: nearest, category or A–Z. Sits by the add box so it is easy to reach. */
export function ListSortToggle({ display, setDisplay }: {
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
}) {
  return <SortSegment options={SORTS} value={resolveListSort(display)} onPick={(id) => setDisplay((d) => ({ ...d, listSort: id }))} />;
}

const ITEM_SORTS: SortOption<ItemsSort>[] = [
  { id: 'category', icon: 'tag', word: 'Category', label: 'Sort by category' },
  { id: 'alpha', icon: 'arrow-down-a-z', word: 'A–Z', label: 'Sort alphabetically' },
];

/** Grocery Items catalog order: category or A–Z (nearest needs a shopper position). */
export function ItemsSortToggle({ display, setDisplay }: {
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
}) {
  return <SortSegment options={ITEM_SORTS} value={resolveItemsSort(display)} onPick={(id) => setDisplay((d) => ({ ...d, itemsSort: id }))} />;
}

const LISTS_EDIT_SORTS: SortOption<ListsEditSort>[] = [
  { id: 'entry', icon: 'list-ordered', word: 'Added', label: 'Sort by order of entry' },
  { id: 'category', icon: 'tag', word: 'Category', label: 'Sort by category' },
  { id: 'alpha', icon: 'arrow-down-a-z', word: 'A–Z', label: 'Sort alphabetically' },
];

/** Setup → Lists edit order: order added, category or A–Z. */
export function ListsEditSortToggle({ display, setDisplay }: {
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
}) {
  return <SortSegment options={LISTS_EDIT_SORTS} value={resolveListsEditSort(display)} onPick={(id) => setDisplay((d) => ({ ...d, listsEditSort: id }))} />;
}

/**
 * On/off switches: an icon and a short word each (full names for screen readers
 * and tooltips). A switch that is on shows a check. The colour/icon pairs are
 * grouped under "Map" and "List". `extra` goes at the end.
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
      className="toggle"
      aria-pressed={on(k)}
      aria-label={LABELS[k]}
      title={LABELS[k]}
      onClick={() => setDisplay((d) => ({ ...d, [k]: !(d[k] ?? !offByDefault.includes(k)) }))}
    >
      <Icon name={on(k) ? 'check' : CHIPS[k].icon} />
      <span>{CHIPS[k].word}</span>
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
