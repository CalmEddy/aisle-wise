import { useState } from 'react';
import { AT_STORE_METRES, distanceText, storesByDistance } from '../core/stores';
import type { GeoPoint, StoreLayout } from '../core/types';

/**
 * Picking a store: nearest first (when we know where you are), a new store
 * right where you're standing, or saving where the current store is so it's
 * picked automatically next time.
 */
export function StoreSheet({ layouts, activeId, here, locating, onPick, onNew, onSaveHere, onClose }: {
  layouts: StoreLayout[];
  activeId: string;
  /** Where you are, if known. */
  here?: GeoPoint;
  /** 'finding' while asking the phone; 'off' if location isn't available. */
  locating: 'finding' | 'off' | 'ok';
  onPick: (id: string) => void;
  onNew: (name: string) => void;
  onSaveHere: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const rows = storesByDistance(layouts, here);
  const active = layouts.find((l) => l.id === activeId);
  const activeHere = here && active?.geo && rows.find((r) => r.layout.id === activeId)?.metres;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet store-sheet" role="dialog" aria-label="Stores" onClick={(e) => e.stopPropagation()}>
        <h2>Which store?</h2>
        <p className="muted small">
          {locating === 'finding' ? 'Finding where you are…' : locating === 'off' ? 'Location is off, so stores are in your order.' : 'Nearest first.'}
        </p>
        <ul className="store-list">
          {rows.map(({ layout, metres }) => (
            <li key={layout.id}>
              <button className={`store-row-btn${layout.id === activeId ? ' current' : ''}`} onClick={() => { onPick(layout.id); onClose(); }} aria-current={layout.id === activeId}>
                <span className="radio" aria-hidden="true">{layout.id === activeId ? '●' : '○'}</span>
                <span className="name">{layout.name}</span>
                <span className="muted small">
                  {metres !== undefined ? (metres <= AT_STORE_METRES ? 'You’re here' : distanceText(metres)) : layout.geo ? '' : 'no location'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <form className="add-row new-store" onSubmit={(e) => { e.preventDefault(); onNew(name.trim() || 'New store'); onClose(); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New store, e.g. Kroger Main St" aria-label="New store name" />
          <button type="submit">＋ Here</button>
        </form>
        <p className="muted small">A new store starts empty: shop as usual and it learns where things are{here ? ', and remembers where it is' : ''}.</p>

        {here && active && (activeHere === undefined || activeHere > AT_STORE_METRES) && (
          <button className="btn wide" onClick={() => { onSaveHere(); onClose(); }}>📍 I’m at {active.name} – remember it’s here</button>
        )}
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
