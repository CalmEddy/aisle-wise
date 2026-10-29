import { useState } from 'react';
import { DEPTS, describeClue, guessDept } from '../core/clues';
import type { AislePos, AisleSide, Clue, Dept } from '../core/types';

type Tab = 'aisle' | 'dept' | 'freezer' | 'endcap' | 'display' | 'checkout';

const TABS: { id: Tab; label: string }[] = [
  { id: 'aisle', label: 'Aisle' },
  { id: 'dept', label: 'Department' },
  { id: 'freezer', label: '🧊 Freezer' },
  { id: 'endcap', label: 'End-cap' },
  { id: 'display', label: 'Display' },
  { id: 'checkout', label: 'Checkout' },
];

/**
 * "Where was it?" – asked when an item with no known place in this store is
 * checked off. Most answers take one or two taps: a department, or an aisle
 * number (recent ones are chips) with optional side and how far along.
 */
export function WherePanel({ itemName, categoryId, storeName, recentAisles, lastClue, current, onSave, onLater, onSkip, onStopAsking, queued }: {
  itemName: string;
  categoryId?: string;
  storeName: string;
  /** Aisle numbers already used in this store, most used first. */
  recentAisles: string[];
  /** The last answer given, for "Same as last". */
  lastClue?: Clue;
  /** An answer already saved (when changing it). */
  current?: Clue;
  onSave: (clue: Clue) => void;
  onLater?: () => void;
  onSkip: () => void;
  onStopAsking?: () => void;
  /** More items waiting to be placed after this one. */
  queued?: number;
}) {
  const guess = guessDept(categoryId);
  const startTab: Tab = current ? (current.kind === 'aisle' ? 'aisle' : current.kind) : guess ? 'dept' : 'aisle';
  const [tab, setTab] = useState<Tab>(startTab);
  const [aisle, setAisle] = useState(current && 'aisle' in current && current.aisle ? current.aisle : '');
  const [side, setSide] = useState<AisleSide | undefined>(current && 'side' in current ? current.side : undefined);
  const [pos, setPos] = useState<AislePos | undefined>(current && 'pos' in current ? current.pos : undefined);

  const aisleOk = aisle.trim().length > 0;
  const deptChips = (onPick: (d: Dept) => void, highlight?: Dept) => (
    <div className="where-depts">
      {[...DEPTS].sort((a, b) => (a.id === highlight ? -1 : b.id === highlight ? 1 : 0)).map((d) => (
        <button key={d.id} className={`btn where-dept${d.id === highlight ? ' guess' : ''}`} onClick={() => onPick(d.id)}>
          <span aria-hidden="true">{d.icon}</span> {d.name}
        </button>
      ))}
    </div>
  );
  const aislePicker = (optional = false) => (
    <div className="where-aisle">
      <div className="where-row">
        <span className="where-label">Aisle{optional ? ' (if any)' : ''}</span>
        {recentAisles.slice(0, 6).map((a) => (
          <button key={a} className={`chip${aisle === a ? ' active' : ''}`} onClick={() => setAisle(a)}>{a}</button>
        ))}
        <input className="where-num" value={aisle} onChange={(e) => setAisle(e.target.value.slice(0, 5))} inputMode="text"
          placeholder="#" aria-label="Aisle number" />
      </div>
    </div>
  );
  const sidePos = (
    <>
      <div className="where-row">
        <span className="where-label">Side</span>
        {(['L', 'R'] as const).map((s) => (
          <button key={s} className={`chip${side === s ? ' active' : ''}`} aria-pressed={side === s} onClick={() => setSide(side === s ? undefined : s)}>
            {s === 'L' ? '← Left' : 'Right →'}
          </button>
        ))}
      </div>
      <div className="where-row">
        <span className="where-label">Along</span>
        {(['front', 'middle', 'back'] as const).map((p) => (
          <button key={p} className={`chip${pos === p ? ' active' : ''}`} aria-pressed={pos === p} onClick={() => setPos(pos === p ? undefined : p)}>
            {p[0].toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>
      <p className="muted small where-note">Left and right as you walk into the aisle from the front of the store.</p>
    </>
  );

  return (
    <div className="sheet-backdrop" onClick={onLater ?? onSkip}>
      <div className="sheet where-panel" role="dialog" aria-label={`Where was ${itemName}?`} onClick={(e) => e.stopPropagation()}>
        <div className="where-head">
          <h2>Where was <b>{itemName}</b>?</h2>
          {queued ? <span className="muted small">{queued} more after this</span> : null}
        </div>
        <div className="where-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'chip active' : 'chip'} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="where-body">
          {tab === 'aisle' && (
            <>
              {aislePicker()}
              {sidePos}
              <button className="btn primary wide" disabled={!aisleOk} onClick={() => onSave({ kind: 'aisle', aisle: aisle.trim(), ...(side && { side }), ...(pos && { pos }) })}>
                Save{aisleOk ? ` · Aisle ${aisle.trim()}` : ''}
              </button>
            </>
          )}
          {tab === 'dept' && deptChips((dept) => onSave({ kind: 'dept', dept }), guess)}
          {tab === 'freezer' && (
            <>
              {aislePicker(true)}
              {aisleOk && sidePos}
              <div className="where-row">
                <button className="btn primary" disabled={!aisleOk} onClick={() => onSave({ kind: 'freezer', aisle: aisle.trim(), ...(side && { side }), ...(pos && { pos }) })}>
                  Save · Freezer aisle {aisle.trim()}
                </button>
                <button className="btn" onClick={() => onSave({ kind: 'freezer' })}>Freezer along a wall</button>
              </div>
            </>
          )}
          {tab === 'endcap' && (
            <>
              {aislePicker()}
              <div className="where-row">
                <button className="btn primary" disabled={!aisleOk} onClick={() => onSave({ kind: 'endcap', aisle: aisle.trim(), end: 'front' })}>Front end</button>
                <button className="btn primary" disabled={!aisleOk} onClick={() => onSave({ kind: 'endcap', aisle: aisle.trim(), end: 'back' })}>Back end</button>
              </div>
            </>
          )}
          {tab === 'display' && (
            <>
              {aislePicker()}
              <button className="btn primary wide" disabled={!aisleOk} onClick={() => onSave({ kind: 'display', aisle: aisle.trim() })}>Near aisle {aisle.trim()}</button>
              <p className="muted small where-note">…or in a department:</p>
              {deptChips((dept) => onSave({ kind: 'display', dept }), guess)}
            </>
          )}
          {tab === 'checkout' && (
            <button className="btn primary wide" onClick={() => onSave({ kind: 'checkout' })}>At the checkout</button>
          )}
        </div>

        <div className="where-foot">
          {lastClue && <button className="btn" onClick={() => onSave(lastClue)}>Same as last: {describeClue(lastClue)}</button>}
          {onLater && <button className="btn" onClick={onLater}>Ask later</button>}
          <button className="btn" onClick={onSkip}>Don’t know</button>
        </div>
        {onStopAsking && <button className="link where-stop" onClick={onStopAsking}>Stop asking at {storeName}</button>}
      </div>
    </div>
  );
}
