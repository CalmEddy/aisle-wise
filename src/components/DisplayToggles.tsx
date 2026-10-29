import type { ReactNode } from 'react';
import type { Display } from '../display';

/** Display settings that are on/off switches. */
type Switch = { [K in keyof Display]-?: NonNullable<Display[K]> extends boolean ? K : never }[keyof Display];

/** Full names, for screen readers and tooltips. */
const LABELS: Record<Switch, string> = {
  mapColors: 'Colors on map',
  mapIcons: 'Icons on map',
  groupList: 'Group by section',
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
  mapColors: '🎨',
  mapIcons: '🍎',
  listColors: '🎨',
  listIcons: '🍎',
  buildArea: 'Areas',
  buildDouble: 'Double',
  mapFull: '🗺',
  buildMoreTools: '⋯',
};

/** Switches shown together under a heading ("Map 🎨 🍎"). */
const GROUPS: { name: string; keys: Switch[] }[] = [
  { name: 'Map', keys: ['mapColors', 'mapIcons'] },
  { name: 'List', keys: ['listColors', 'listIcons'] },
];

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
