import type { AisleLabel } from '../core/types';
import type { BuildApi } from './ShoppingView';
import type { BuildNote } from './BuildPanel';

/**
 * Editing an aisle label in build mode: its name; remove the label, or
 * renumber every aisle. (Turning, moving and deleting the whole aisle are
 * on the map, next to it.)
 */
export function AisleEditor({ aisle, api, onDone, onNote }: {
  aisle: AisleLabel;
  api: BuildApi['aisles'];
  onDone: () => void;
  onNote: (note: BuildNote) => void;
}) {
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
        <p className="muted small">Turn, move or delete the whole aisle (with its shelves) with the buttons on the map.</p>
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
