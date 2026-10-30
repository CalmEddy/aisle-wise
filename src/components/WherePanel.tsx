import { useState } from 'react';
import { DEPTS, describeClue, guessDept, NEAR_WORD } from '../core/clues';
import { guessTemp } from './WhereBar';
import type { AislePos, AisleSide, Clue, Dept, Fixture, OpenNear, Temp, Wall, WallPart } from '../core/types';

type Tab = 'aisle' | 'wall' | 'open' | 'dept' | 'endcap' | 'checkout';

const TABS: { id: Tab; label: string }[] = [
  { id: 'aisle', label: 'Aisle' },
  { id: 'wall', label: 'Wall' },
  { id: 'open', label: 'Open' },
  { id: 'dept', label: 'Department' },
  { id: 'endcap', label: 'End-cap' },
  { id: 'checkout', label: 'Checkout' },
];

/** Which tab an existing answer opens on. */
function tabFor(c: Clue): Tab {
  switch (c.kind) {
    case 'freezer': return c.aisle ? 'aisle' : 'wall';
    case 'display': return 'open';
    default: return c.kind;
  }
}

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
  const startTab: Tab = current ? tabFor(current) : guess ? 'dept' : 'aisle';
  const [tab, setTab] = useState<Tab>(startTab);
  const [aisle, setAisle] = useState(current && 'aisle' in current && current.aisle ? current.aisle : '');
  const [side, setSide] = useState<AisleSide | undefined>(current && 'side' in current ? current.side : undefined);
  const [pos, setPos] = useState<AislePos | undefined>(current && 'pos' in current ? current.pos : undefined);
  const [temp, setTemp] = useState<Temp | undefined>(
    current ? (current.kind === 'freezer' ? 'frozen' : 'temp' in current ? current.temp : undefined) : guessTemp(categoryId),
  );
  const [wall, setWall] = useState<Wall | undefined>(current?.kind === 'wall' ? current.wall : undefined);
  const [part, setPart] = useState<WallPart | undefined>(current?.kind === 'wall' ? current.part : undefined);
  const [near, setNear] = useState<OpenNear | undefined>(current?.kind === 'open' ? current.near : undefined);
  const [fixture, setFixture] = useState<Fixture | undefined>(current?.kind === 'open' ? current.fixture : undefined);
  const withTemp = temp ? { temp } : {};
  const coldWord = temp === 'frozen' ? 'Freezer' : temp === 'chilled' ? 'Fridge' : '';

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
        <span className="where-label">{optional ? 'Or by aisle' : 'Aisle'}</span>
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

  const tempRow = (
    <div className="where-row">
      <span className="where-label">Kept</span>
      {([undefined, 'chilled', 'frozen'] as const).map((t) => (
        <button key={String(t)} className={`chip${temp === t ? ' active' : ''}`} aria-pressed={temp === t} onClick={() => setTemp(t)}>
          {t === undefined ? 'Shelf' : t === 'chilled' ? '🧊 Fridge' : '❄ Freezer'}
        </button>
      ))}
    </div>
  );
  const choice = <T extends string>(label: string, options: [T, string][], value: T | undefined, set: (v: T | undefined) => void) => (
    <div className="where-row">
      <span className="where-label">{label}</span>
      {options.map(([v, text]) => (
        <button key={v} className={`chip${value === v ? ' active' : ''}`} aria-pressed={value === v} onClick={() => set(value === v ? undefined : v)}>{text}</button>
      ))}
    </div>
  );
  const wallClue: Clue | undefined = wall ? { kind: 'wall', wall, ...(part && { part }), ...withTemp } : undefined;
  const openClue: Clue = { kind: 'open', ...(near && !aisle.trim() && { near }), ...(aisle.trim() && { aisle: aisle.trim() }), ...(fixture && { fixture }), ...withTemp };

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
              {tempRow}
              <button className="btn primary wide" disabled={!aisleOk}
                onClick={() => onSave({ kind: 'aisle', aisle: aisle.trim(), ...(side && { side }), ...(pos && { pos }), ...withTemp })}>
                Save{aisleOk ? ` · ${coldWord ? `${coldWord}, aisle` : 'Aisle'} ${aisle.trim()}` : ''}
              </button>
            </>
          )}
          {tab === 'wall' && (
            <>
              {choice<Wall>('Wall', [['left', '← Left'], ['back', '↑ Back'], ['right', 'Right →']], wall, (w) => { setWall(w); setPart(undefined); })}
              {wall && choice<WallPart>('Along', wall === 'back'
                ? [['left', 'Left end'], ['middle', 'Middle'], ['right', 'Right end']]
                : [['front', 'Front'], ['middle', 'Middle'], ['back', 'Back']], part, setPart)}
              {tempRow}
              <p className="muted small where-note">Left and right as you face into the store from the entrance.</p>
              <button className="btn primary wide" disabled={!wallClue} onClick={() => wallClue && onSave(wallClue)}>
                {wallClue ? `Save · ${describeClue(wallClue)}` : 'Pick a wall'}
              </button>
            </>
          )}
          {tab === 'open' && (
            <>
              {choice<Fixture>('What', [['table', 'Table'], ['case', 'Case'], ['stand', 'Stand / display']], fixture, setFixture)}
              {choice<OpenNear>('Where', (['entrance', 'middle', 'far'] as const).map((n) => [n, NEAR_WORD[n][0].toUpperCase() + NEAR_WORD[n].slice(1)] as [OpenNear, string]), aisle.trim() ? undefined : near, (n) => { setNear(n); setAisle(''); })}
              {aislePicker(true)}
              {tempRow}
              <button className="btn primary wide" onClick={() => onSave(openClue)}>Save · {describeClue(openClue)}</button>
            </>
          )}
          {tab === 'dept' && deptChips((dept) => onSave({ kind: 'dept', dept }), guess)}
          {tab === 'endcap' && (
            <>
              {aislePicker()}
              <div className="where-row">
                <button className="btn primary" disabled={!aisleOk} onClick={() => onSave({ kind: 'endcap', aisle: aisle.trim(), end: 'front' })}>Front end</button>
                <button className="btn primary" disabled={!aisleOk} onClick={() => onSave({ kind: 'endcap', aisle: aisle.trim(), end: 'back' })}>Back end</button>
              </div>
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
