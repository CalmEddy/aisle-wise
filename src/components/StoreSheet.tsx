import { useMemo, useState } from 'react';
import { DEFAULT_TEMPLATE_ID, STORE_TEMPLATES, templateById } from '../data/storeTemplates';
import { storeFromTemplate } from '../core/templates';
import { NumberField } from './PlacePanel';
import { StoreMap } from './StoreMap';
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
  /** A new store: its name, the default map it starts from ('blank': just the door and checkout) and how many aisles. */
  onNew: (name: string, templateId: string, aisles?: number) => void;
  onSaveHere: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  /** Naming a new store: then choosing what it starts as. */
  const [naming, setNaming] = useState<string>();
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [aisles, setAisles] = useState<number>();
  const t = templateById(templateId);
  const count = aisles ?? t?.aisles;
  const preview = useMemo(() => (naming !== undefined ? storeFromTemplate('Preview', templateId, count || undefined) : undefined), [naming, templateId, count]);
  if (naming !== undefined) {
    return (
      <div className="sheet-backdrop" onClick={onClose}>
        <div className="sheet store-sheet" role="dialog" aria-label="Start the map" onClick={(e) => e.stopPropagation()}>
          <h2>What’s {naming} like?</h2>
          <p className="muted small">A starting guess: dashed parts are guesses, and your answers redraw the map as you shop.</p>
          <div className="template-chips" role="radiogroup" aria-label="Kind of store">
            {[...STORE_TEMPLATES, { id: 'blank', name: 'Blank', icon: '⬜', description: 'Just the entrance and checkout: the map builds as you shop.' }].map((x) => (
              <button key={x.id} role="radio" aria-checked={templateId === x.id} className={`chip${templateId === x.id ? ' active' : ''}`}
                onClick={() => { setTemplateId(x.id); setAisles(undefined); }}>
                <span aria-hidden="true">{x.icon} </span>{x.name}
              </button>
            ))}
          </div>
          <p className="small">{t?.description ?? 'Just the entrance and checkout: the map builds as you shop.'}</p>
          {t && t.aisles > 0 && (
            <NumberField label="Aisles" value={count!} min={t.aisleRange[0]} max={t.aisleRange[1]} onChange={setAisles} />
          )}
          {preview && <div className="placement-map template-preview" aria-label="Preview"><StoreMap layout={preview} /></div>}
          <div className="sheet-actions">
            <button className="btn" onClick={() => setNaming(undefined)}>Back</button>
            <span style={{ flex: 1 }} />
            <button className="btn primary" onClick={() => { onNew(naming, templateId, t && t.aisles > 0 ? count : undefined); onClose(); }}>Create store</button>
          </div>
        </div>
      </div>
    );
  }
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

        <form className="add-row new-store" onSubmit={(e) => { e.preventDefault(); setNaming(name.trim() || 'New store'); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New store, e.g. Kroger Main St" aria-label="New store name" />
          <button type="submit">＋ Here</button>
        </form>
        <p className="muted small">Next, pick what kind of store it is (or start blank): it learns where things are as you shop{here ? ', and remembers where it is' : ''}.</p>

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
