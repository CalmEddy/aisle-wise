import { DOOR_NAMES, DOOR_SPOTS } from '../core/door';
import type { StoreLayout } from '../core/types';
import { StoreMap, type MapGhost } from './StoreMap';

/** "Where's the door?": five spots along the front of the mini-map, the likely one marked. One tap. */
export function DoorCard({ layout, guess, onPick, onSkip }: {
  layout: StoreLayout;
  guess: number;
  onPick: (f: number) => void;
  onSkip: () => void;
}) {
  const ghosts: MapGhost[] = DOOR_SPOTS.map((f, i) => ({
    rect: { x: Math.round(f * (layout.width - 1)) - 1, y: layout.height - 2.4, w: 2.2, h: 2.2 },
    kind: 'next', label: String(i + 1), onTap: () => onPick(f),
  }));
  const likely = DOOR_SPOTS.indexOf(guess);
  return (
    <div className="layout-question door-card" role="group" aria-label="Where’s the door?">
      <p><span aria-hidden="true">🚪 </span>Where’s the door? <span className="muted small">Your trips start near {likely + 1}.</span></p>
      <div className="placement-map"><StoreMap layout={layout} ghosts={ghosts} /></div>
      <div className="layout-question-choices">
        {DOOR_SPOTS.map((f, i) => (
          <button key={f} className={`btn${i === likely ? ' primary' : ''}`} onClick={() => onPick(f)} aria-label={`Door: ${DOOR_NAMES[i]}`}>
            {i + 1}{i === likely ? ' · likely' : ''}
          </button>
        ))}
        <button className="link" onClick={onSkip}>Not sure</button>
      </div>
    </div>
  );
}
