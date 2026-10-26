import type { Display } from '../display';

const LABELS: Record<keyof Display, string> = {
  mapColors: 'Colors on map',
  mapIcons: 'Icons on map',
  listColors: 'Colors in list',
  listIcons: 'Icons in list',
  buildMode: '🛠 Build mode',
};

/** On/off switches for category colours and icons. */
export function DisplayToggles({ display, setDisplay, show }: {
  display: Display;
  setDisplay: (fn: (d: Display) => Display) => void;
  show: (keyof Display)[];
}) {
  return (
    <div className="toggles" role="group" aria-label="Display">
      {show.map((k) => (
        <button
          key={k}
          type="button"
          className="toggle"
          aria-pressed={display[k] ?? true}
          onClick={() => setDisplay((d) => ({ ...d, [k]: !(d[k] ?? true) }))}
        >
          <span className="knob" aria-hidden="true" />
          {LABELS[k]}
        </button>
      ))}
    </div>
  );
}
