import { useEffect, useState } from 'react';
import type { BuildApi } from './ShoppingView';
import type { BuildOutcome, Snapshot } from '../App';
import { extendCandidates, planBuild, type BuildChoice, type BuildTarget, type Direction } from '../core/build';
import type { Catalog } from '../core/catalog';
import { resolveSpot } from '../core/locate';
import type { Point, Shelf, StoreLayout } from '../core/types';

/** The build-mode banner: what just changed, with follow-up buttons. */
export type BuildNote =
  | (BuildOutcome & { turned?: boolean })
  | { kind: 'area'; placeId: string; snapshot: Snapshot }
  /** Shelves added with "next shelf" or the skipped-shelves suggestion; `placeId` is the last one. */
  | { kind: 'shelves'; placeId: string; count: number; filled: boolean; snapshot: Snapshot }
  | { kind: 'message'; text: string; snapshot?: Snapshot };

export const ACTION_TEXT: Record<string, (label: string) => string> = {
  onShelf: (l) => `on “${l || 'this shelf'}”`,
  inArea: (l) => `in “${l || 'this area'}”`,
  extend: (l) => `extends “${l || 'this shelf'}” to here`,
  create: () => 'creates a new shelf here',
  createArea: () => 'creates a new area here',
  extendArea: (l) => `stretches “${l || 'this area'}” to here`,
  blocked: () => 'can’t fit a shelf here',
};

/** Build mode controls: what checking off here will do, walk arrows and tools. */
export function BuildPanel({ layout, position, target, setTarget, build, preview, turnId, nextOptions, onNext, aisleAction, double, setDouble, onNote }: {
  layout: StoreLayout;
  position: Point;
  target: BuildTarget;
  setTarget: (t: BuildTarget) => void;
  build: BuildApi;
  /** What picking up here would do. */
  preview: ReturnType<typeof planBuild>;
  /** The shelf "Turn shelf" turns. */
  turnId?: string;
  /** Where "next shelf" (or pair) can go, either side of the current shelf. */
  nextOptions: { side: -1 | 1; shelves: Shelf[] }[];
  onNext: (shelves: Shelf[]) => void;
  /** Label the aisle you're standing in (or edit its label). */
  aisleAction?: { text: string; run: () => void };
  double: boolean;
  setDouble: (d: boolean) => void;
  onNote: (n: BuildNote) => void;
}) {
  const options = preview.action === 'create' || preview.action === 'createArea' ? extendCandidates(layout, position) : [];
  const arrow = (dir: Direction, label: string, glyph: string) => (
    <button className={`btn arrow ${dir}`} onClick={() => build.stepTo(dir)} aria-label={label}>{glyph}</button>
  );
  return (
    <section className="card build-panel">
      <div className="build-top">
        <div className="segmented build-target" role="group" aria-label="What to build on open floor">
          <span className="muted small">Build:</span>
          {(['shelf', 'area'] as const).map((t) => (
            <button key={t} className={target === t ? 'active' : ''} aria-pressed={target === t} onClick={() => setTarget(t)}>
              {t === 'shelf' ? '▮ Shelves' : '▦ Areas'}
            </button>
          ))}
        </div>
        <label className="double-toggle" title="Double shelves (back to back)">
          <input type="checkbox" checked={double} onChange={(e) => setDouble(e.target.checked)} aria-label="Double shelves (back to back)" />
          <span>Double</span>
        </label>
      </div>
      <p className="build-preview">
        <b>Picking up here</b>{' '}
        {options.length
          ? <>lets you extend {options.map((o) => `“${o.label || 'a shelf'}”`).join(' or ')}, or make a new shelf or area.</>
          : preview.action === 'create' && preview.matched
            ? <>creates a new {preview.pairId ? 'pair of shelves' : 'shelf'} lined up with “{preview.matched}” (shown in blue).</>
            : <>{preview.pairId ? 'creates a new double shelf here' : ACTION_TEXT[preview.action](preview.label)}{preview.action === 'create' || preview.action === 'extend' ? ' (shown in blue)' : ''}.</>}
      </p>
      <div className="build-row">
        <div className="arrows" role="group" aria-label="Move one square">
          {arrow('up', 'Move up', '↑')}
          {arrow('left', 'Move left', '←')}
          {arrow('right', 'Move right', '→')}
          {arrow('down', 'Move down', '↓')}
        </div>
        <div className="build-tools">
          {nextOptions.map(({ side, shelves }) => {
            const what = shelves.length > 1 ? 'Next pair' : 'Next shelf';
            return (
              <button key={side} className="btn primary" onClick={() => onNext(shelves)}>
                {shelves[0].orientation === 'vertical' ? (side < 0 ? `← ${what}` : `${what} →`) : (side < 0 ? `↑ ${what}` : `↓ ${what}`)}
              </button>
            );
          })}
          {aisleAction && <button className="btn" onClick={aisleAction.run}>{aisleAction.text}</button>}
          <button className="btn" onClick={() => {
            const r = build.addAreaHere();
            onNote(r ? { kind: 'area', ...r } : { kind: 'message', text: 'There’s no free floor here for an area.' });
          }}>+ Area here</button>
          <button className="btn" disabled={!turnId} onClick={() => {
            const snapshot = turnId ? build.turnShelfHere(turnId) : undefined;
            onNote(snapshot ? { kind: 'message', text: 'Shelf turned.', snapshot } : { kind: 'message', text: 'That shelf can’t turn here – something’s in the way.' });
          }}>⟳ Turn shelf</button>
          <button className="btn" onClick={() => onNote({ kind: 'message', text: 'Entrance set here.', snapshot: build.markHere('entrance') })} aria-label="I’m at the entrance">Here = IN</button>
          <button className="btn" onClick={() => onNote({ kind: 'message', text: 'Checkout set here.', snapshot: build.markHere('checkout') })} aria-label="I’m at checkout">Here = $</button>
        </div>
      </div>
    </section>
  );
}

/** Banner after a build-mode change: rename, turn, undo, or (for a conflict) keep / move here. */
export function BuildBanner({ note, skipped, onFill, layout, catalog, build, onUndo, onNote, onClose }: {
  note: BuildNote;
  /** Shelves probably walked past to reach a just-made shelf (shown as green ghosts). */
  skipped: Shelf[];
  onFill: () => void;
  layout: StoreLayout;
  catalog: Catalog;
  build: BuildApi;
  onUndo: (s: Snapshot) => void;
  onNote: (n: BuildNote) => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const placeId = 'placeId' in note ? note.placeId : undefined;
  const place = placeId ? layout.places.find((p) => p.id === placeId) : undefined;
  const [name, setName] = useState(place?.label ?? '');
  useEffect(() => setName(place?.label ?? ''), [place?.label]);

  if (note.kind === 'message') {
    return (
      <div className="toast" role="status">
        <span className="toast-text">{note.text}</span>
        {note.snapshot && <button className="toast-btn" onClick={() => onUndo(note.snapshot!)}>Undo</button>}
        <button className="icon" onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    );
  }

  if (note.kind === 'choose') {
    const arrow = { up: '↑', down: '↓', left: '←', right: '→' } as const;
    const choose = (c: BuildChoice) => onNote(build.placeChosen(note.productId, note.at, c, note.snapshot));
    return (
      <div className="toast question" role="alertdialog" aria-label={`Where is ${note.itemName}?`}>
        <span className="toast-text"><b>{note.itemName}</b> is in your cart. Where is it?</span>
        <div className="toast-choices">
          {note.options.map((o) => (
            <button key={o.shelfId} className="btn primary" onClick={() => choose({ extend: o.shelfId })}>
              {arrow[o.direction]} Extend {o.label || 'shelf'} <span className="muted-on-dark">({o.gap} away)</span>
            </button>
          ))}
          <button className="btn" onClick={() => choose('shelf')}>+ New shelf</button>
          <button className="btn" onClick={() => choose('area')}>+ New area</button>
        </div>
        <div className="toast-actions">
          <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Decide later</button>
        </div>
      </div>
    );
  }

  if (note.kind === 'chooseSide') {
    const arrow = { left: '←', right: '→', up: '↑', down: '↓' } as const;
    const choose = (shelfId: string) => onNote(build.placeChosen(note.productId, note.at, { onShelf: shelfId }, note.snapshot));
    return (
      <div className="toast question" role="alertdialog" aria-label={`Which side is ${note.itemName} on?`}>
        <span className="toast-text"><b>{note.itemName}</b> is in your cart. Which side was it on?</span>
        <div className="side-choices">
          {note.options.map((o) => (
            <button key={o.shelfId} className="btn primary big-side" onClick={() => choose(o.shelfId)}>
              {o.side === 'left' || o.side === 'up' ? <>{arrow[o.side]} {o.label || 'This shelf'}</> : <>{o.label || 'This shelf'} {arrow[o.side]}</>}
            </button>
          ))}
        </div>
        <div className="toast-actions">
          <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Decide later</button>
        </div>
      </div>
    );
  }

  if (note.kind === 'conflict') {
    const saved = resolveSpot(note.savedKey, layout, catalog)?.label ?? 'another place';
    return (
      <div className="toast question" role="alertdialog" aria-label={`Move ${note.itemName}?`}>
        <span className="toast-text"><b>{note.itemName}</b> is in your cart. It’s saved at <b>{saved}</b> — is it here instead?</span>
        <div className="toast-actions">
          <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Keep {saved}</button>
          <button className="btn primary" onClick={() => onNote(build.moveHereAndBuild(note.productId))}>Move here</button>
        </div>
      </div>
    );
  }

  if (note.kind === 'blocked') {
    return (
      <div className="toast question" role="status">
        <span className="toast-text"><b>{note.itemName}</b> is in your cart, but there’s no room for a shelf here. Move a square and try again, or set its place from ⋯.</span>
        <div className="toast-actions">
          <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>OK</button>
        </div>
      </div>
    );
  }

  const label = place?.label || (place?.kind === 'area' ? 'this area' : 'this shelf');
  const text =
    note.kind === 'area' ? <>New open area added around you.</>
      : note.kind === 'shelves' ? (note.filled
        ? <>Added the <b>{note.count}</b> shelves you walked past.</>
        : note.count > 1
          ? <>Added <b>{note.count}</b> shelves.</>
          : <>Added <b>“{label}”</b>. Tap the next <b>+</b> on the map for another.</>)
      : note.action === 'create' ? <><b>{note.itemName}</b> is in your cart. New {note.pairId ? 'double shelf' : 'shelf'} <b>“{label}”</b>{note.matched ? <>, lined up with “{note.matched}”</> : null}.</>
        : note.action === 'extend' ? <><b>{note.itemName}</b> is in your cart. Extended <b>“{label}”</b> to here.</>
          : note.action === 'createArea' ? <><b>{note.itemName}</b> is in your cart. New area <b>“{label}”</b> — tap it on the map to resize.</>
            : note.action === 'extendArea' ? <><b>{note.itemName}</b> is in your cart. Stretched <b>“{label}”</b> to here.</>
          : <><b>{note.itemName}</b> is in your cart · saved on <b>“{label}”</b>.</>;
  // A new shelf that didn't copy a neighbour may be the wrong way round: offer to turn it.
  const isNewShelf = note.kind === 'built' && note.action === 'create' && place?.kind === 'shelf' && !note.matched;

  return (
    <div className="toast question" role="status">
      {renaming ? (
        <form className="rename" onSubmit={(e) => {
          e.preventDefault();
          if (place) build.renamePlace(place.id, name.trim());
          setRenaming(false);
        }}>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus placeholder="e.g. Pasta or 5A" />
          <button className="btn primary">Save</button>
        </form>
      ) : (
        <span className="toast-text">{text}</span>
      )}
      {skipped.length > 0 && (
        <div className="toast-fill">
          <span>Walked past {skipped.length === 1 ? 'a shelf' : `${skipped.length} shelves`} to get here? They’re shown in green.</span>
          <button className="btn primary" onClick={onFill}>Add {skipped.length === 1 ? 'it' : `all ${skipped.length}`}</button>
        </div>
      )}
      <div className="toast-actions">
        <button className="toast-btn subtle" onClick={() => onUndo(note.snapshot)}>Undo</button>
        <span style={{ flex: 1 }} />
        {isNewShelf && place?.kind === 'shelf' && (
          <div className="segmented mini" role="group" aria-label="Shelf direction">
            {(['vertical', 'horizontal'] as const).map((o) => (
              <button key={o} className={place.orientation === o ? 'active' : ''} onClick={() => {
                if (place.orientation !== o && !build.turnShelfHere(place.id, note.kind === 'built' ? note.pairId : undefined)) {
                  onNote({ kind: 'message', text: 'It won’t fit that way here.' });
                }
              }}>{o === 'vertical' ? '↕' : '↔'}</button>
            ))}
          </div>
        )}
        {place && !renaming && <button className="btn" onClick={() => setRenaming(true)}>Rename</button>}
        <button className="icon" onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}
