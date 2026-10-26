import type { Display } from '../display';

const LABELS: Record<keyof Display, string> = {
  mapColors: 'Colors on map',
  mapIcons: 'Icons on map',
  listColors: 'Colors in list',
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
          aria-pressed={display[k]}
          onClick={() => setDisplay((d) => ({ ...d, [k]: !d[k] }))}
        >
          <span className="knob" aria-hidden="true" />
          {LABELS[k]}
        </button>
      ))}
    </div>
  );
}
