import type { AisleLabel } from '../core/types';
import type { BuildApi } from './ShoppingView';
import type { BuildNote } from './BuildPanel';

/**
 * Editing an aisle in build mode: its name, and the whole aisle (label and
 * the shelves on both sides) turned or moved together; remove the label, or
 * renumber every aisle.
 */
export function AisleEditor({ aisle, api, onDone, onNote }: {
  aisle: AisleLabel;
  api: BuildApi['aisles'];
  onDone: () => void;
  onNote: (note: BuildNote) => void;
}) {
  const now = aisle.h >= aisle.w ? 'vertical' : 'horizontal';
  return (
    <div className="build-edit aisle-edit">
      <div className="build-edit-head">
        <h3>Aisle label</h3>
        <button className="btn primary" onClick={onDone}>Done</button>
      </div>
      <div className="card panel">
        <label className="field">
          <span>Name (shown along the walkway)</span>
          <input value={aisle.label} onChange={(e) => api.rename(aisle.id, e.target.value)} placeholder="e.g. Aisle 5" autoFocus />
        </label>
        <div className="field">
          <span>Whole aisle (label and the shelves on both sides)</span>
          <div className="segmented" role="group" aria-label="Aisle direction">
            {(['vertical', 'horizontal'] as const).map((o) => (
              <button key={o} className={now === o ? 'active' : ''} aria-pressed={now === o} onClick={() => {
                if (now === o) return;
                const snapshot = api.turn(aisle.id);
                onNote(snapshot
                  ? { kind: 'message', text: `Turned ${aisle.label}.`, snapshot }
                  : { kind: 'message', text: 'No room to turn it here: something’s in the way, or it would go past the walls.' });
              }}>
                {o === 'vertical' ? '↕ Up & down' : '↔ Side to side'}
              </button>
            ))}
          </div>
        </div>
        <div className="field-row nudge">
          <span className="muted small">Move the aisle</span>
          {([['←', -1, 0, 'left'], ['↑', 0, -1, 'up'], ['↓', 0, 1, 'down'], ['→', 1, 0, 'right']] as const).map(([icon, dx, dy, word]) => (
            <button key={word} className="btn" aria-label={`Move aisle ${word}`} onClick={() => {
              if (!api.move(aisle.id, dx, dy)) onNote({ kind: 'message', text: 'Can’t move it that way: something’s in the way, or it’s at the wall.' });
            }}>{icon}</button>
          ))}
        </div>
        <button className="btn danger" onClick={() => {
          const snapshot = api.remove(aisle.id);
          onDone();
          onNote({ kind: 'message', text: `Removed “${aisle.label}”.`, snapshot });
        }}>Remove label</button>
        <button className="btn" onClick={() => {
          const snapshot = api.renumber();
          onNote({ kind: 'message', text: 'Aisles renumbered 1, 2, 3… from the back, door side first.', snapshot });
        }}>Renumber all aisles</button>
      </div>
    </div>
  );
}
