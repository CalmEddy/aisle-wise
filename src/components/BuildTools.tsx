import type { Snapshot } from '../App';
import type { Direction } from '../core/build';
import { BRUSH_LENGTH, BRUSH_PRESETS, MAX_AISLE, MIN_AISLE, type Brush, type SideKind } from '../core/brush';
import type { StoreLayout } from '../core/types';
import { NumberField } from './PlacePanel';

/** What tapping or dragging on the map does in build mode. */
export type BuildTool = 'walk' | 'brush' | 'shelf-v' | 'shelf-h' | 'block' | 'area' | 'entrance' | 'checkout';

const TOOLS: { id: BuildTool; label: string; hint: string }[] = [
  { id: 'walk', label: '📍 Walk', hint: 'Tap the map to say where you are, then check items off to build around you. Tap a shelf or area to edit it; once it’s selected, drag it to move it or drag the round handle to resize it.' },
  { id: 'brush', label: '🖌 Aisle brush', hint: 'Walk an aisle 4 squares at a time with the arrows; each step paints what’s on your left and right. The dashed outline shows the next step.' },
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

const SIDE_LABEL: Record<SideKind, string> = { shelf: '▮ Shelf', wall: '▙ Wall', gap: '· Gap' };
const ARROW: Record<Direction, string> = { up: '↑', down: '↓', left: '←', right: '→' };

/**
 * The aisle brush: what's on each side, how wide the walkway is, and arrows
 * that paint and step BRUSH_LENGTH squares. Sides are relative to the way
 * you're walking.
 */
export function BrushPanel({ brush, setBrush, dir, onStep, onNudge, canBack, onBack, lastResult }: {
  brush: Brush;
  setBrush: (b: Brush) => void;
  /** The way you're facing (the preview shows the next step this way). */
  dir: Direction;
  onStep: (d: Direction) => void;
  /** Move one square without painting. */
  onNudge: (d: Direction) => void;
  canBack: boolean;
  onBack: () => void;
  lastResult?: string;
}) {
  const side = (which: 'left' | 'right') => (
    <div className="brush-side">
      <span className="muted small">{which === 'left' ? 'Your left' : 'Your right'}</span>
      <div className="segmented mini-seg" role="group" aria-label={`${which} side`}>
        {(['shelf', 'wall', 'gap'] as const).map((k) => (
          <button key={k} className={brush[which] === k ? 'active' : ''} aria-pressed={brush[which] === k} onClick={() => setBrush({ ...brush, [which]: k })}>
            {SIDE_LABEL[k]}
          </button>
        ))}
      </div>
    </div>
  );
  const arrow = (d: Direction) => (
    <button className={`btn arrow ${d}${d === dir ? ' facing' : ''}`} onClick={() => onStep(d)} aria-label={`Paint and step ${BRUSH_LENGTH} ${d}`}>{ARROW[d]}</button>
  );
  return (
    <section className="card brush-panel" aria-label="Aisle brush">
      <div className="chips wrap brush-presets" role="group" aria-label="Presets">
        {BRUSH_PRESETS.map((p) => {
          const on = brush.left === p.left && brush.right === p.right;
          return (
            <button key={p.name} className={on ? 'chip active' : 'chip'} aria-pressed={on} onClick={() => setBrush({ ...brush, left: p.left, right: p.right })}>
              {p.name}
            </button>
          );
        })}
        <button className="chip" onClick={() => setBrush({ ...brush, left: brush.right, right: brush.left })} aria-label="Swap left and right">⇄ Swap</button>
      </div>
      <div className="brush-sides">
        {side('left')}
        {side('right')}
      </div>
      <label className="lane-field">
        <span>Aisle width</span>
        <span className="stepper">
          <button onClick={() => setBrush({ ...brush, width: Math.max(MIN_AISLE, brush.width - 1) })} aria-label="Narrower aisle">−</button>
          <input type="number" min={MIN_AISLE} max={MAX_AISLE} value={brush.width} aria-label="Aisle width in squares"
            onChange={(e) => setBrush({ ...brush, width: Math.max(MIN_AISLE, Math.min(MAX_AISLE, Number(e.target.value) || MIN_AISLE)) })} />
          <button onClick={() => setBrush({ ...brush, width: Math.min(MAX_AISLE, brush.width + 1) })} aria-label="Wider aisle">+</button>
        </span>
        <span className="muted small">squares</span>
      </label>
      <div className="build-row brush-row">
        <div className="arrows" role="group" aria-label={`Paint and step ${BRUSH_LENGTH} squares`}>
          {arrow('up')}
          {arrow('left')}
          {arrow('right')}
          {arrow('down')}
        </div>
        <div className="brush-tools">
          <button className="btn" disabled={!canBack} onClick={onBack}>↶ Back up</button>
          <span className="muted small">Move 1 square, no painting:</span>
          <div className="nudges">
            {(['left', 'up', 'down', 'right'] as const).map((d) => (
              <button key={d} className="btn nudge" onClick={() => onNudge(d)} aria-label={`Move 1 square ${d}`}>{ARROW[d]}</button>
            ))}
          </div>
        </div>
      </div>
      {lastResult && <p className="muted small brush-result">{lastResult}</p>}
    </section>
  );
}
