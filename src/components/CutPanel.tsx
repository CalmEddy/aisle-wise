import type { CutNumbers } from '../core/cut';
import type { Rect } from '../core/types';

/** The cut tool's options: how wide the cross aisle is, and how the aisles past it are numbered. */
export function CutPanel({ box, shelves, aisles, nextNumber, width, setWidth, numbers, setNumbers, onCut, onCancel }: {
  box?: Rect;
  /** Shelves the box crosses. */
  shelves: number;
  /** Aisle labels it crosses. */
  aisles: string[];
  /** The first new aisle number (one after the highest). */
  nextNumber: number;
  width: number;
  setWidth: (n: number) => void;
  numbers: CutNumbers;
  setNumbers: (n: CutNumbers) => void;
  onCut: () => void;
  onCancel: () => void;
}) {
  const last = nextNumber + Math.max(0, aisles.length - 1);
  return (
    <section className="card block-panel cut-panel" aria-label="Cut aisles">
      <div className="block-head">
        <b>✂ Cut aisles</b>
        <span className="muted small">
          {box ? `${shelves} shel${shelves === 1 ? 'f' : 'ves'}${aisles.length ? ` · ${aisles.length} aisle${aisles.length === 1 ? '' : 's'}` : ''}` : 'Drag a box across the aisles where the cross aisle goes. Drag again to move it.'}
        </span>
      </div>
      <div className="block-options">
        <label className="lane-field">
          <span>Cross aisle</span>
          <span className="stepper">
            <button onClick={() => setWidth(Math.max(1, width - 1))} disabled={!box} aria-label="Narrower cross aisle">−</button>
            <input type="number" min={1} max={10} value={width} disabled={!box} aria-label="Cross aisle width in squares"
              onChange={(e) => setWidth(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
            <button onClick={() => setWidth(Math.min(10, width + 1))} disabled={!box} aria-label="Wider cross aisle">+</button>
          </span>
          <span className="muted small">squares</span>
        </label>
      </div>
      <div className="field">
        <span>Past the break</span>
        <div className="segmented" role="group" aria-label="Aisle numbers past the break">
          <button className={numbers === 'same' ? 'active' : ''} aria-pressed={numbers === 'same'} onClick={() => setNumbers('same')}>
            Same aisles carry on
          </button>
          <button className={numbers === 'new' ? 'active' : ''} aria-pressed={numbers === 'new'} onClick={() => setNumbers('new')}>
            New numbers{aisles.length ? ` (${nextNumber}${last > nextNumber ? `–${last}` : ''})` : ''}
          </button>
        </div>
        <p className="muted small">
          {numbers === 'same'
            ? 'Each aisle keeps its number on both sides of the cross aisle.'
            : 'The halves nearer the entrance become new aisles, numbered on from the highest.'}
        </p>
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <span style={{ flex: 1 }} />
        <button className="btn primary" disabled={!shelves} onClick={onCut}>Cut {shelves || ''} shel{shelves === 1 ? 'f' : 'ves'}</button>
      </div>
    </section>
  );
}
