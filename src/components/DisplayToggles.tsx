import type { Display } from '../display';

const LABELS: Record<keyof Display, string> = {
  mapColors: 'Colors on map',
  mapIcons: 'Icons on map',
  mapNumbers: 'Numbers on map',
  listColors: 'Colors in list',
  listIcons: 'Icons in list',
  buildMode: '🛠 Build mode',
  buildArea: 'Build areas',
};

/** On/off switches for category colours and icons. */
export function DisplayToggles({ display, setDisplay, show, offByDefault = ['buildMode', 'buildArea'] }: {
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
  show: (keyof Display)[];
  /** Switches that start off when never set. */
  offByDefault?: (keyof Display)[];
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
