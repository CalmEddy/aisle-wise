import { useState } from 'react';
import { acrossRect, DEPTS, describeClue, guessDept, NEAR_WORD } from '../core/clues';
import { StoreMap } from './StoreMap';
import { AisleRegionPicker } from './AisleRegionPicker';
import { WallRegionPicker } from './WallRegionPicker';
import { guessTemp, nextAisles, type PlaceStart } from './WhereBar';
import { looksLikeShelfCode, parseLabel, type LabelStyle } from '../core/labels';
import type { AislePos, Clue, Dept, Fixture, OpenNear, StoreLayout, Temp, Wall, WallPart } from '../core/types';

export type { PlaceStart };

type Tab = 'place' | 'dept' | 'more';

const TABS: { id: Tab; label: string }[] = [
  { id: 'place', label: 'Place' },
  { id: 'dept', label: 'Department' },
  { id: 'more', label: 'More…' },
];

/** Which top-level tab an existing answer opens on. */
function tabFor(c: Clue): Tab {
  switch (c.kind) {
    case 'aisle':
    case 'wall':
    case 'freezer':
      return 'place';
    case 'dept':
      return 'dept';
    default:
      return 'more';
  }
}

/**
 * "Where was it?" – visual Place sheet (aisle regions + wall outline), plus
 * Department and a More… catch-all for open floor, end-caps, checkout, front wall.
 */
export function WherePanel({ itemName, categoryId, storeName, labels, onNeedLabels, layout, recentAisles, trail = [], lastClue, current, start, onSave, onLater, onSkip, onStopAsking, queued }: {
  itemName: string;
  categoryId?: string;
  storeName: string;
  /** How this store labels its shelves ("B12"), if not by aisle number. */
  labels?: LabelStyle;
  /** The store's map (to pick aisles on for "across"). */
  layout?: StoreLayout;
  /** A shelf label was typed in a store not set up for them. */
  onNeedLabels?: (code: string) => void;
  /** Aisle numbers already used in this store, most used first. */
  recentAisles: string[];
  /** Aisle numbers answered this trip, for the best-guess default. */
  trail?: string[];
  /** The last answer given, for "Same as last". */
  lastClue?: Clue;
  /** An answer already saved (when changing it). */
  current?: Clue;
  /** How the Place sheet was opened from the quick bar. */
  start?: PlaceStart;
  onSave: (clue: Clue) => void;
  onLater?: () => void;
  onSkip: () => void;
  onStopAsking?: () => void;
  /** More items waiting to be placed after this one. */
  queued?: number;
}) {
  const guess = guessDept(categoryId);
  const startTab: Tab = start?.aisle || start?.wall ? 'place' : current ? tabFor(current) : guess ? 'dept' : 'place';
  const defaultAisle = () => {
    if (start?.aisle) return start.aisle;
    if (current && 'aisle' in current && current.aisle) return current.aisle;
    const predicted = nextAisles(trail)[0];
    if (predicted) return predicted;
    return recentAisles[0] ?? '';
  };
  const [tab, setTab] = useState<Tab>(startTab);
  const [aisle, setAisle] = useState(defaultAisle);
  const [temp, setTemp] = useState<Temp | undefined>(
    start?.temp !== undefined
      ? start.temp
      : current
        ? (current.kind === 'freezer' ? 'frozen' : 'temp' in current ? current.temp : undefined)
        : guessTemp(categoryId),
  );
  const [wallCurrent, setWallCurrent] = useState<{ wall: Wall; part?: WallPart } | undefined>(
    start?.wall ? { wall: start.wall } : current?.kind === 'wall' ? { wall: current.wall, part: current.part } : undefined,
  );
  const [near, setNear] = useState<OpenNear | undefined>(current?.kind === 'open' ? current.near : undefined);
  const [fixture, setFixture] = useState<Fixture | undefined>(current?.kind === 'open' ? current.fixture : undefined);
  const [endcapAisle, setEndcapAisle] = useState(current?.kind === 'endcap' ? current.aisle : defaultAisle());
  const [frontPart, setFrontPart] = useState<WallPart | undefined>(current?.kind === 'wall' && current.wall === 'front' ? current.part : undefined);
  const withTemp = temp ? { temp } : {};
  const coldWord = temp === 'frozen' ? 'Freezer' : temp === 'chilled' ? 'Fridge' : '';

  const aisleOk = aisle.trim().length > 0;
  const shelf = labels && aisleOk ? parseLabel(labels, aisle) : undefined;
  const deptChips = (onPick: (d: Dept) => void, highlight?: Dept) => (
    <div className="where-depts">
      {[...DEPTS].sort((a, b) => (a.id === highlight ? -1 : b.id === highlight ? 1 : 0)).map((d) => (
        <button key={d.id} className={`btn where-dept${d.id === highlight ? ' guess' : ''}`} onClick={() => onPick(d.id)}>
          <span aria-hidden="true">{d.icon}</span> {d.name}
        </button>
      ))}
    </div>
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
  // "Across aisles 3–5, front": out in the middle of a block, where the shelves make way.
  const [acrossOn, setAcrossOn] = useState(current?.kind === 'open' && !!current.across);
  const [from, setFrom] = useState(current?.kind === 'open' && current.across ? current.across.from : recentAisles[0] ?? '');
  const [to, setTo] = useState(current?.kind === 'open' && current.across ? current.across.to : recentAisles[0] ?? '');
  const [acrossPart, setAcrossPart] = useState<AislePos | undefined>(current?.kind === 'open' && current.across ? current.across.part : 'middle');
  const [openAisle, setOpenAisle] = useState(current?.kind === 'open' && current.aisle ? current.aisle : '');
  const acrossOk = acrossOn && from.trim() && (to.trim() || from.trim());
  const [tapsAcross, setTapsAcross] = useState(0);
  const tapAcross = (x: string) => {
    if (tapsAcross % 2 === 0) { setFrom(x); setTo(x); } else setTo(x);
    setTapsAcross((n) => n + 1);
  };
  const acrossPreview = acrossOn && layout && from.trim()
    ? acrossRect(layout, { from: from.trim().toUpperCase(), to: (to.trim() || from.trim()).toUpperCase(), ...(acrossPart && { part: acrossPart }) })
    : undefined;
  const openClue: Clue = acrossOn
    ? { kind: 'open', across: { from: from.trim().toUpperCase(), to: (to.trim() || from.trim()).toUpperCase(), ...(acrossPart && { part: acrossPart }) }, ...(fixture && { fixture }), ...withTemp }
    : { kind: 'open', ...(near && !openAisle.trim() && { near }), ...(openAisle.trim() && { aisle: openAisle.trim() }), ...(fixture && { fixture }), ...withTemp };

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
          {tab === 'place' && (
            <>
              {tempRow}
              {labels && (
                <div className="where-row">
                  <span className="where-label">Shelf</span>
                  <input className="where-num" value={aisle} onChange={(e) => setAisle(e.target.value.slice(0, 8))} inputMode="text"
                    placeholder="B12" aria-label="Shelf label" />
                  {shelf ? (
                    <button className="btn primary" onClick={() => onSave({ kind: 'shelf', code: aisle.trim().toUpperCase(), section: shelf.section, ...(shelf.shelf !== undefined && { shelf: shelf.shelf }), ...withTemp })}>
                      Save · {coldWord ? `${coldWord}, shelf` : 'Shelf'} {aisle.trim().toUpperCase()}
                    </button>
                  ) : aisleOk && looksLikeShelfCode(aisle) && onNeedLabels ? (
                    <button className="btn" onClick={() => onNeedLabels(aisle.trim().toUpperCase())}>Set up labels…</button>
                  ) : null}
                </div>
              )}
              <div className="where-place-block">
                <p className="where-place-title">Aisle</p>
                <AisleRegionPicker
                  aisle={aisle}
                  recentAisles={recentAisles}
                  onAisleChange={setAisle}
                  temp={temp}
                  onPick={onSave}
                />
              </div>
              <div className="where-place-block">
                <p className="where-place-title">Walls</p>
                <WallRegionPicker
                  temp={temp}
                  current={wallCurrent}
                  onPick={(clue) => {
                    if (clue.kind === 'wall') setWallCurrent({ wall: clue.wall, part: clue.part });
                    onSave(clue);
                  }}
                />
              </div>
            </>
          )}
          {tab === 'dept' && deptChips((dept) => onSave({ kind: 'dept', dept }), guess)}
          {tab === 'more' && (
            <>
              <details className="where-more-section" open={current?.kind === 'open' || undefined}>
                <summary>Open floor</summary>
                {choice<Fixture>('What', [['table', 'Table'], ['case', 'Case'], ['stand', 'Stand / display']], fixture, setFixture)}
                {choice<OpenNear | 'across'>('Where', [...(['entrance', 'middle', 'far', 'back'] as const).map((n) => [n, NEAR_WORD[n][0].toUpperCase() + NEAR_WORD[n].slice(1)] as [OpenNear, string]), ['across', 'Across aisles…']],
                  acrossOn ? 'across' : openAisle.trim() ? undefined : near,
                  (n) => { if (n === 'across') { setAcrossOn(true); setOpenAisle(''); } else { setAcrossOn(false); setNear(n); setOpenAisle(''); } })}
                {acrossOn ? (
                  <>
                    {layout && layout.places.some((p) => /^g-(shelf|sec)-/.test(p.id)) && (
                      <div className="placement-map across-map">
                        <p className="muted small where-note">Tap the first and last aisle it goes across.</p>
                        <StoreMap
                          layout={layout}
                          ghosts={acrossPreview ? [{ rect: acrossPreview, kind: 'preview' }] : []}
                          onAisleTap={(id) => {
                            const a = layout.aisles?.find((x) => x.id === id);
                            const n = a && /(\d+[A-Z]?)\s*$/i.exec(a.label)?.[1];
                            if (n) tapAcross(n.toUpperCase());
                          }}
                          onPlaceTap={(p) => {
                            const m = /^g-sec-(.+)-\d+/.exec(p.id) ?? /^g-shelf-([^-~]+)-[LR]/.exec(p.id);
                            if (m) tapAcross(m[1].toUpperCase());
                          }}
                        />
                      </div>
                    )}
                    <div className="where-row">
                      <span className="where-label">Across</span>
                      <input className="where-num" value={from} onChange={(e) => setFrom(e.target.value.slice(0, 6))} placeholder="#" aria-label="From aisle or section" />
                      <span className="muted">to</span>
                      <input className="where-num" value={to} onChange={(e) => setTo(e.target.value.slice(0, 6))} placeholder="#" aria-label="To aisle or section" />
                    </div>
                    {choice<AislePos>('Part', [['front', 'Front'], ['middle', 'Middle'], ['back', 'Back']], acrossPart, setAcrossPart)}
                    <p className="muted small where-note">Aisle numbers, or section letters. The shelves there make way for it on the map.</p>
                  </>
                ) : (
                  <div className="where-row">
                    <span className="where-label">Or by aisle</span>
                    {recentAisles.slice(0, 6).map((a) => (
                      <button key={a} className={`chip${openAisle === a ? ' active' : ''}`} onClick={() => setOpenAisle(a)}>{a}</button>
                    ))}
                    <input className="where-num" value={openAisle} onChange={(e) => setOpenAisle(e.target.value.slice(0, 8))} inputMode="text"
                      placeholder="#" aria-label="Aisle number" />
                  </div>
                )}
                {tempRow}
                <button className="btn primary wide" disabled={acrossOn && !acrossOk} onClick={() => onSave(openClue)}>Save · {describeClue(openClue)}</button>
              </details>

              <details className="where-more-section" open={current?.kind === 'endcap' || undefined}>
                <summary>End-cap</summary>
                <div className="where-row">
                  <span className="where-label">Aisle</span>
                  {recentAisles.slice(0, 6).map((a) => (
                    <button key={a} className={`chip${endcapAisle === a ? ' active' : ''}`} onClick={() => setEndcapAisle(a)}>{a}</button>
                  ))}
                  <input className="where-num" value={endcapAisle} onChange={(e) => setEndcapAisle(e.target.value.slice(0, 8))} inputMode="text"
                    placeholder="#" aria-label="Aisle number" />
                </div>
                <div className="where-row">
                  <button className="btn primary" disabled={!endcapAisle.trim()} onClick={() => onSave({ kind: 'endcap', aisle: endcapAisle.trim(), end: 'front' })}>Front end</button>
                  <button className="btn primary" disabled={!endcapAisle.trim()} onClick={() => onSave({ kind: 'endcap', aisle: endcapAisle.trim(), end: 'back' })}>Back end</button>
                </div>
              </details>

              <details className="where-more-section" open={(current?.kind === 'wall' && current.wall === 'front') || undefined}>
                <summary>Front wall</summary>
                {choice<WallPart>('Along', [['left', 'Left of the door'], ['right', 'Right of the door']], frontPart, setFrontPart)}
                {tempRow}
                <button className="btn primary wide" disabled={!frontPart || (frontPart !== 'left' && frontPart !== 'right')}
                  onClick={() => frontPart && (frontPart === 'left' || frontPart === 'right') && onSave({ kind: 'wall', wall: 'front', part: frontPart, ...withTemp })}>
                  {frontPart ? `Save · Front wall · ${frontPart} of the door` : 'Pick a side of the door'}
                </button>
              </details>

              <details className="where-more-section" open={current?.kind === 'checkout' || undefined}>
                <summary>Checkout</summary>
                <button className="btn primary wide" onClick={() => onSave({ kind: 'checkout' })}>At the checkout</button>
              </details>
            </>
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
