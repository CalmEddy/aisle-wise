import type { Snapshot } from '../App';
import type { LayoutQuestion } from '../core/learn';
import { PAIRINGS } from '../core/labels';
import { LayoutQuestionCard } from './LayoutQuestionCard';
import type { Direction } from '../core/build';
import { BRUSH_LENGTH, BRUSH_PRESETS, MAX_AISLE, MIN_AISLE, type Brush, type SideKind } from '../core/brush';
import type { StoreLayout } from '../core/types';
import { NumberField } from './PlacePanel';
import { CategoryPicker } from './CategoryPicker';
import type { Category, GeneratedMap } from '../core/types';

/** What tapping or dragging on the map does in build mode. */
export type BuildTool = 'walk' | 'select' | 'brush' | 'shelf-v' | 'shelf-h' | 'block' | 'cut' | 'area' | 'entrance' | 'checkout';

export const TOOLS: { id: BuildTool; icon: string; label: string; hint: string }[] = [
  { id: 'walk', icon: '📍', label: 'Walk', hint: 'Tap where you are, then check items off. Tap a shelf to edit or drag it.' },
  { id: 'select', icon: '⬚', label: 'Select aisles', hint: 'Drag a box over aisles to select them, or tap an aisle to add it or take it out. Then turn, move or delete them together.' },
  { id: 'brush', icon: '🖌', label: 'Aisle brush', hint: 'Arrows paint your left and right side, 4 squares a step.' },
  { id: 'shelf-v', icon: '▮↕', label: 'Shelf ↕', hint: 'Tap the map to add an up-and-down shelf.' },
  { id: 'shelf-h', icon: '▬↔', label: 'Shelf ↔', hint: 'Tap the map to add a side-to-side shelf.' },
  { id: 'block', icon: '▤', label: 'Shelf block', hint: 'Drag across the map to fill it with shelves.' },
  { id: 'cut', icon: '✂', label: 'Cut aisles', hint: 'Drag a box across a block of aisles to make a cross aisle through them.' },
  { id: 'area', icon: '▦', label: 'Open area', hint: 'Tap the map to add an open area, like Produce.' },
  { id: 'entrance', icon: 'IN', label: 'Entrance', hint: 'Tap where shoppers come in (or drag IN in Walk).' },
  { id: 'checkout', icon: '$', label: 'Checkout', hint: 'Tap where shoppers pay (or drag $ in Walk).' },
];

/** The build-mode tools under the map: one row of icons, with the chosen tool's name and a short hint. */
/** The tools shown until "more" is opened: enough to lay out most stores. */
const MAIN_TOOLS: BuildTool[] = ['walk', 'select', 'brush', 'block', 'area'];

export function BuildToolbar({ tool, setTool, more, setMore, rail }: {
  tool: BuildTool;
  /** A slim column of icons on the map (no hint line). */
  rail?: boolean;
  setTool: (t: BuildTool) => void;
  /** Showing every tool. */
  more: boolean;
  setMore: (more: boolean) => void;
}) {
  const current = TOOLS.find((t) => t.id === tool)!;
  // A tool in use stays visible even when the extra ones are hidden.
  const shown = TOOLS.filter((t) => more || MAIN_TOOLS.includes(t.id) || t.id === tool);
  return (
    <div className={`build-toolbar${rail ? ' rail' : ''}`}>
      <div className="toolbar tool-icons" role="toolbar" aria-label="Build tools">
        {shown.map((t) => (
          <button key={t.id} className={tool === t.id ? 'chip active' : 'chip'} aria-pressed={tool === t.id}
            aria-label={t.label} title={t.label} onClick={() => setTool(t.id)}>
            {t.icon}
          </button>
        ))}
        <button className="chip more-tools" aria-expanded={more} aria-label={more ? 'Fewer tools' : 'More tools'}
          title={more ? 'Fewer tools' : 'More tools: single shelves, cut aisles, entrance, checkout'} onClick={() => setMore(!more)}>
          {more ? '‹' : '⋯'}
        </button>
      </div>
      {!rail && <p className="muted small tool-hint"><b>{current.label}:</b> {current.hint}</p>}
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
  /** The map generated from aisle answers ("Where was it?"), if any. */
  gen?: GeneratedMap;
  setGen: (patch: Partial<GeneratedMap>) => Snapshot;
  /** Items with an aisle answer for this store. */
  answers: number;
  /** A question about the layout the trips can't settle. */
  question?: LayoutQuestion;
  answer: (q: LayoutQuestion, option: number | undefined) => void;
  /** Which arrangement settings apply to this store; backWall names its two ends. */
  layoutHas: { aisles: boolean; produce: boolean; backWall?: [string, string] };
  /** Blocks of shelving made from answers: aisle runs made into a block, and sections. */
  blocks: { ref: string; name: string; dir: 'vertical' | 'horizontal'; group: boolean }[];
}

type GenKey = 'entrance' | 'aisleOne' | 'produce' | 'backWall';

/** A row of choices for one generated-map setting. Choosing one means the trips won't change it. */
function GenChoice({ store, setting, label, options, note, onUndoable }: {
  store: StoreApi;
  onUndoable: (text: string, snapshot: Snapshot) => void;
  setting: GenKey;
  label: string;
  options: [string, string][];
  note: (value: string) => string;
}) {
  const gen = store.gen!;
  const value = (gen[setting] as string | undefined) ?? options[0][0];
  const sure = gen.sure?.includes(setting);
  return (
    <div className="gen-choice">
      <span className="gen-choice-label">{label}{!sure && <span className="muted small"> · guess</span>}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} className={value === v ? 'active' : ''} aria-pressed={value === v}
            onClick={() => onUndoable(note(v), store.setGen({ [setting]: v, sure: [...new Set([...(gen.sure ?? []), setting])] }))}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The collapsible "Store settings" section of the build panel. */
export function StoreSettings({ layout, store, problems, onNewStore, onPickPlace, onUndoable, onLabels, onWalls }: {
  layout: StoreLayout;
  store: StoreApi;
  /** Plain-language problems with the layout. */
  problems: string[];
  onNewStore: () => void;
  /** Open a shelf or area for editing. */
  onPickPlace: (placeId: string) => void;
  /** Something changed that can be undone. */
  onUndoable: (text: string, snapshot: Snapshot) => void;
  /** Set up how the store labels its shelves. */
  onLabels?: () => void;
  /** Open the departments screen (what's along each wall). */
  onWalls?: () => void;
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
        {onLabels && (
          <div className="field">
            <span>Shelf labels</span>
            <div className="store-actions">
              <span className="muted small" style={{ flex: 1 }}>
                {layout.labels ? `Like “${layout.labels.example}” · ${PAIRINGS.find((p) => p.id === layout.labels!.pairing)?.name.toLowerCase()}` : 'Aisle numbers'}
              </span>
              <button className="btn" onClick={onLabels}>{layout.labels ? 'Change…' : 'Labels like B12…'}</button>
            </div>
          </div>
        )}
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
        <div className="field gen-field">
          <span>Map from aisle answers</span>
          {store.gen?.enabled ? (
            <>
              <p className="muted small">
                Built from {store.answers} answer{store.answers === 1 ? '' : 's'} and updated as more come in.
                Dashed aisles are guesses no answer has mentioned yet.
              </p>
              {store.question && (
                <LayoutQuestionCard compact question={store.question} onAnswer={(o) => store.answer(store.question!, o)} />
              )}
              {store.layoutHas.aisles && (
                <GenChoice store={store} onUndoable={onUndoable} setting="aisleOne" label="Aisle 1" note={(t) => `Aisle 1 is on the ${t === 'far' ? 'left' : 'right'}.`}
                  options={[['near', 'On the right'], ['far', 'On the left']]} />
              )}
              {store.layoutHas.produce && (
                <GenChoice store={store} onUndoable={onUndoable} setting="produce" label="Produce" note={(t) => `Produce along the ${t === 'far' ? 'left' : 'right'} wall.`}
                  options={[['near', 'Right wall'], ['far', 'Left wall']]} />
              )}
              {store.layoutHas.backWall && (
                <GenChoice store={store} onUndoable={onUndoable} setting="backWall" label="Back wall, left end" note={(t) => `${store.layoutHas.backWall![t === 'reversed' ? 1 : 0]} at the left end of the back wall.`}
                  options={[['usual', store.layoutHas.backWall[0]], ['reversed', store.layoutHas.backWall[1]]]} />
              )}
              <p className="muted small">The back of the store is the top of the map, with the entrance in the middle of the front. Trips teach the map which way round things are; what you pick here stays put.</p>
              {onWalls && (
                <div className="gen-choice">
                  <span className="gen-choice-label">Departments on the walls</span>
                  <button className="btn" onClick={onWalls}>{store.gen.wallOrder ? 'Change…' : 'Set out…'}</button>
                </div>
              )}
              <div className="store-actions">
                {store.gen.locked.length > 0 && (
                  <button className="btn" onClick={() => onUndoable('Edited parts will be rebuilt from the answers.', store.setGen({ locked: [] }))}>
                    Redo my {store.gen.locked.length} edited part{store.gen.locked.length === 1 ? '' : 's'}
                  </button>
                )}
                <button className="btn" onClick={() => onUndoable('The map won’t change by itself now.', store.setGen({ enabled: false }))}>
                  Stop updating automatically
                </button>
              </div>
              {store.blocks.length > 0 && (
                <div className="field">
                  <span>Blocks of shelving</span>
                  {store.blocks.map((b) => (
                    <div key={b.ref} className="gen-choice">
                      <span className="gen-choice-label">{b.name}</span>
                      <div className="segmented mini-seg" role="group" aria-label={`Which way ${b.name} runs`}>
                        {(['vertical', 'horizontal'] as const).map((o) => (
                          <button key={o} className={b.dir === o ? 'active' : ''} aria-pressed={b.dir === o}
                            onClick={() => onUndoable(`${b.name} ${o === 'vertical' ? 'up and down' : 'side to side'}.`, store.setGen({ directions: { ...store.gen!.directions, [b.ref]: o } }))}>
                            {o === 'vertical' ? '↕' : '↔'}
                          </button>
                        ))}
                      </div>
                      {b.group && (
                        <button className="link" onClick={() => {
                          const { [b.ref]: _gone, ...placements } = store.gen!.placements ?? {};
                          void _gone;
                          onUndoable(`${b.name} joined back up with the other aisles.`, store.setGen({
                            aisleGroups: (store.gen!.aisleGroups ?? []).filter((g) => `aisles:${g.from}` !== b.ref), placements,
                          }));
                        }}>Join back</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {store.gen.locked.length > 0 && <p className="muted small">Parts you’ve changed ({store.gen.locked.length}) are kept as you left them.</p>}
            </>
          ) : (
            <>
              <p className="muted small">
                {store.answers
                  ? `${store.answers} item${store.answers === 1 ? ' has' : 's have'} an aisle answer here. Build the map from them, and keep it updated as more come in.`
                  : 'Check items off as you shop and say where they were; the map can then build itself.'}
              </p>
              <button className="btn" disabled={!store.answers} onClick={() => onUndoable('Map built from aisle answers.', store.setGen({ enabled: true }))}>
                Build map from aisle answers
              </button>
            </>
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
export function BrushPanel({ brush, setBrush, dir, onStep, onNudge, canBack, onBack, lastResult, categories, iconOf, nextAisle }: {
  brush: Brush;
  /** Suggested name for a new aisle label ("Aisle 3"). */
  nextAisle: string;
  /** For "stocks" on each side. */
  categories: Category[];
  iconOf: (id: string) => string | undefined;
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
      {brush[which] !== 'gap' && (
        <CategoryPicker
          value={which === 'left' ? brush.leftCategory : brush.rightCategory}
          categories={categories}
          onPick={(id) => setBrush({ ...brush, [which === 'left' ? 'leftCategory' : 'rightCategory']: id })}
          iconOf={iconOf}
          noneLabel="Stocks: nothing yet"
          placeholder="Stocks: nothing yet"
          label={`Category the ${which} side stocks`}
        />
      )}
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
      <div className="aisle-name-field">
        <span>🏷</span>
        <input value={brush.aisleLabel ?? ''} onChange={(e) => setBrush({ ...brush, aisleLabel: e.target.value })}
          placeholder="Aisle name (optional)" aria-label="Aisle name to paint along the walkway" />
        <button className="btn" onClick={() => setBrush({ ...brush, aisleLabel: nextAisle })} title="Next aisle number">{nextAisle}</button>
        {brush.aisleLabel && <button className="icon" onClick={() => setBrush({ ...brush, aisleLabel: '' })} aria-label="Stop naming">×</button>}
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
