import type { Display } from '../display';

/** Display settings that are on/off switches. */
type Switch = { [K in keyof Display]-?: NonNullable<Display[K]> extends boolean ? K : never }[keyof Display];

const LABELS: Record<Switch, string> = {
  mapColors: 'Colors on map',
  mapIcons: 'Icons on map',
  groupList: 'Group by section',
  listColors: 'Colors in list',
  listIcons: 'Icons in list',
  buildMode: '🛠 Build mode',
  buildArea: 'Build areas',
  buildDouble: 'Double shelves',
};

/** On/off switches for category colours and icons. */
export function DisplayToggles({ display, setDisplay, show, offByDefault = ['buildMode', 'buildArea', 'buildDouble'] }: {
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
  show: Switch[];
  /** Switches that start off when never set. */
  offByDefault?: Switch[];
}) {
  return (
    <div className="toggles" role="group" aria-label="Display">
      {show.map((k) => (
        <button
          key={k}
          type="button"
          className="toggle"
          aria-pressed={display[k] ?? !offByDefault.includes(k)}
          onClick={() => setDisplay((d) => ({ ...d, [k]: !(d[k] ?? !offByDefault.includes(k)) }))}
        >
          <span className="knob" aria-hidden="true" />
          {LABELS[k]}
        </button>
      ))}
    </div>
  );
}
