import type { Snapshot } from '../App';
import type { StoreLayout } from '../core/types';
import { NumberField } from './PlacePanel';

/** What tapping or dragging on the map does in build mode. */
export type BuildTool = 'walk' | 'shelf-v' | 'shelf-h' | 'block' | 'area' | 'entrance' | 'checkout';

const TOOLS: { id: BuildTool; label: string; hint: string }[] = [
  { id: 'walk', label: '📍 Walk', hint: 'Tap the map to say where you are, then check items off to build around you. Tap a shelf or area to edit it; once it’s selected, drag it to move it or drag the round handle to resize it.' },
  { id: 'shelf-v', label: '+ Shelf ↕', hint: 'Tap the map to add an up-and-down shelf.' },
  { id: 'shelf-h', label: '+ Shelf ↔', hint: 'Tap the map to add a side-to-side shelf.' },
  { id: 'block', label: '▤ Shelf block', hint: 'Drag across the map to fill that space with shelves.' },
  { id: 'area', label: '+ Open area', hint: 'Tap the map to add an open area, like Produce or the Deli.' },
  { id: 'entrance', label: 'Entrance', hint: 'Tap the map where shoppers come in. (In Walk mode you can also drag the IN marker.)' },
  { id: 'checkout', label: 'Checkout', hint: 'Tap the map where shoppers pay. (In Walk mode you can also drag the $ marker.)' },
];

/** The build-mode tool chips under the map, with a hint for the chosen one. */
export function BuildToolbar({ tool, setTool }: { tool: BuildTool; setTool: (t: BuildTool) => void }) {
  return (
    <div className="build-toolbar">
      <div className="toolbar" role="toolbar" aria-label="Build tools">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? 'chip active' : 'chip'} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted small">{TOOLS.find((t) => t.id === tool)!.hint}</p>
    </div>
  );
}

/** Store-wide settings and actions, from the old Store layout screen. */
export interface StoreApi {
  layouts: StoreLayout[];
  renameStore: (name: string) => void;
  resizeStore: (width: number, height: number) => void;
  copyStore: () => void;
  deleteStore: () => boolean;
  shareStore: () => void;
  resetDemo: () => Snapshot;
  isDemo: boolean;
}

/** The collapsible "Store settings" section of the build panel. */
export function StoreSettings({ layout, store, problems, onNewStore, onPickPlace, onUndoable }: {
  layout: StoreLayout;
  store: StoreApi;
  /** Plain-language problems with the layout. */
  problems: string[];
  onNewStore: () => void;
  /** Open a shelf or area for editing. */
  onPickPlace: (placeId: string) => void;
  /** Something changed that can be undone. */
  onUndoable: (text: string, snapshot: Snapshot) => void;
}) {
  return (
    <>
      {problems.length > 0 && (
        <section className="card problems">
          <h3>Check your layout</h3>
          <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      )}
      <details className="card store-settings">
        <summary><b>Store settings</b> <span className="muted small">· {layout.name}, {layout.width} × {layout.height}</span></summary>
        <label className="field">
          <span>Store name</span>
          <input value={layout.name} onChange={(e) => store.renameStore(e.target.value)} />
        </label>
        <div className="field-row">
          <NumberField label="Width" value={layout.width} min={10} onChange={(v) => store.resizeStore(v, layout.height)} />
          <NumberField label="Depth" value={layout.height} min={10} onChange={(v) => store.resizeStore(layout.width, v)} />
        </div>
        <div className="store-actions">
          <button className="btn" onClick={onNewStore}>New store</button>
          <button className="btn" onClick={store.copyStore}>Copy</button>
          <button className="btn" onClick={store.shareStore}>Share</button>
          <button className="btn danger" onClick={store.deleteStore} disabled={store.layouts.length <= 1}>Delete</button>
          {store.isDemo && (
            <button className="btn" onClick={() => onUndoable('Demo store reset.', store.resetDemo())}>Reset demo</button>
          )}
        </div>
        <div className="field">
          <span>Shelves and areas <span className="muted">(tap one to edit it)</span></span>
          <div className="chips wrap">
            {layout.places.map((p) => (
              <button key={p.id} className="chip" onClick={() => onPickPlace(p.id)}>{p.label || 'Unnamed'}</button>
            ))}
            {layout.places.length === 0 && <span className="muted small">Nothing yet – check items off as you shop, or use the tools above the map.</span>}
          </div>
        </div>
      </details>
    </>
  );
}
