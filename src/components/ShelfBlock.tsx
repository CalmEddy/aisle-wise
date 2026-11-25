import { useRef, useState } from 'react';
import { nextBlockStart, sequenceLabels } from '../core/labels';
import { blockOrientation, fillBlock } from '../core/rows';
import type { Orientation, Point, Rect, Shelf, StoreLayout } from '../core/types';
import { toGrid } from './StoreMap';

/** Squares from one corner to another, inclusive (may extend past the store). */
export const rectBetween = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1,
});

const containsCell = (r: Rect, p: Point) =>
  p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

export type BlockCorner = 'nw' | 'ne' | 'sw' | 'se';

const cornerPoint = (r: Rect, c: BlockCorner): Point => ({
  x: c === 'nw' || c === 'sw' ? r.x : r.x + r.w - 1,
  y: c === 'nw' || c === 'ne' ? r.y : r.y + r.h - 1,
});

const opposite = (c: BlockCorner): BlockCorner =>
  ({ nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' }[c] as BlockCorner);

/**
 * Dragging out a rectangle on the store map (select / cut). Pass handlers to
 * the map's <svg>; `rect` is what's been dragged so far.
 */
export function useBlockDrag(_layout: StoreLayout) {
  const [start, setStart] = useState<Point>();
  const [rect, setRect] = useState<Rect>();
  const cell = (e: React.PointerEvent<SVGSVGElement>): Point => {
    const p = toGrid(e.currentTarget, e.clientX, e.clientY);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  };
  return {
    rect,
    setRect,
    dragging: !!start,
    clear: () => { setStart(undefined); setRect(undefined); },
    down(e: React.PointerEvent<SVGSVGElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const c = cell(e);
      setStart(c);
      setRect(rectBetween(c, c));
    },
    move(e: React.PointerEvent<SVGSVGElement>) {
      if (start) setRect(rectBetween(start, cell(e)));
    },
    up() {
      setStart(undefined);
    },
    cell,
  };
}

/**
 * Options for a dragged-out block of shelves, with a live count. The shelves
 * themselves are shown as ghosts on the map by the caller.
 */
export function ShelfBlockPanel({ rect, shelves, orientation, setOrientation, double, setDouble, lane, setLane, startLabel, setStartLabel, onAdd, onCancel }: {
  rect?: Rect;
  shelves: Shelf[];
  orientation: Orientation;
  setOrientation: (o: Orientation) => void;
  double: boolean;
  setDouble: (d: boolean) => void;
  lane: number;
  setLane: (n: number) => void;
  startLabel: string;
  setStartLabel: (s: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  const preview = shelves.length
    ? `${shelves[0].label}${shelves.length > 1 ? `–${shelves[shelves.length - 1].label}` : ''}`
    : '';
  return (
    <section className="card block-panel" aria-label="Shelf block">
      <div className="block-head">
        <b>▤ Shelf block</b>
        <span className="muted small">
          {rect
            ? `${rect.w} × ${rect.h} squares · ${shelves.length} shel${shelves.length === 1 ? 'f' : 'ves'}${preview ? ` · ${preview}` : ''} · drag to move · corners to resize`
            : 'Drag across the map to mark where the shelves go. Tap a ghost to set which is first.'}
        </span>
      </div>
      <div className="block-options">
        <div className="segmented mini-seg" role="group" aria-label="Shelf direction">
          {(['vertical', 'horizontal'] as const).map((o) => (
            <button key={o} className={orientation === o ? 'active' : ''} aria-pressed={orientation === o} onClick={() => setOrientation(o)}>
              {o === 'vertical' ? '↕ Up/down' : '↔ Across'}
            </button>
          ))}
        </div>
        <div className="segmented mini-seg" role="group" aria-label="Shelf type">
          {[false, true].map((d) => (
            <button key={String(d)} className={double === d ? 'active' : ''} aria-pressed={double === d} onClick={() => setDouble(d)}>
              {d ? '▮▮ Double' : '▮ Single'}
            </button>
          ))}
        </div>
        <label className="lane-field">
          <span>Walkway</span>
          <span className="stepper">
            <button onClick={() => setLane(Math.max(1, lane - 1))} aria-label="Narrower walkway">−</button>
            <input type="number" min={1} max={8} value={lane} aria-label="Walkway width in squares"
              onChange={(e) => setLane(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} />
            <button onClick={() => setLane(Math.min(8, lane + 1))} aria-label="Wider walkway">+</button>
          </span>
          <span className="muted small">squares</span>
        </label>
        <label className="lane-field first-label-field">
          <span>First</span>
          <input value={startLabel} onChange={(e) => setStartLabel(e.target.value)} placeholder="B1"
            aria-label="First shelf label" inputMode="text" autoCapitalize="characters" />
        </label>
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <span style={{ flex: 1 }} />
        <button className="btn primary" disabled={!shelves.length} onClick={onAdd}>
          Add {shelves.length || ''} shel{shelves.length === 1 ? 'f' : 'ves'}
        </button>
      </div>
    </section>
  );
}

type Gesture =
  | { kind: 'draw'; anchor: Point }
  | { kind: 'move'; origin: Point; startRect: Rect }
  | { kind: 'resize'; corner: BlockCorner; fixed: Point };

/**
 * Shared draft rectangle: draw once, then drag inside to move and corners to
 * resize (opposite corner stays fixed). Used by shelf blocks and areas.
 */
export function useRectDraft(onNewDraw?: () => void) {
  const [rect, setRect] = useState<Rect>();
  const gesture = useRef<Gesture>();

  const cell = (e: React.PointerEvent<SVGSVGElement>): Point => {
    const p = toGrid(e.currentTarget, e.clientX, e.clientY);
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  };

  const hitCorner = (r: Rect, p: Point): BlockCorner | undefined => {
    const corners: BlockCorner[] = ['nw', 'ne', 'sw', 'se'];
    let best: BlockCorner | undefined;
    let bestD = 1.6;
    for (const c of corners) {
      const q = cornerPoint(r, c);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  return {
    rect,
    setRect,
    reset: () => { gesture.current = undefined; setRect(undefined); },
    corners: (rect ? (['nw', 'ne', 'sw', 'se'] as BlockCorner[]).map((c) => ({ corner: c, ...cornerPoint(rect, c) })) : []),
    beginCorner(corner: BlockCorner, e: React.PointerEvent) {
      if (!rect) return;
      e.stopPropagation();
      const el = e.currentTarget as SVGElement;
      const svg = el.ownerSVGElement ?? el;
      svg.setPointerCapture?.(e.pointerId);
      gesture.current = { kind: 'resize', corner, fixed: cornerPoint(rect, opposite(corner)) };
    },
    svgHandlers: {
      onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const c = cell(e);
        if (rect) {
          const corner = hitCorner(rect, c);
          if (corner) {
            gesture.current = { kind: 'resize', corner, fixed: cornerPoint(rect, opposite(corner)) };
            return;
          }
          if (containsCell(rect, c)) {
            gesture.current = { kind: 'move', origin: c, startRect: rect };
            return;
          }
        }
        onNewDraw?.();
        gesture.current = { kind: 'draw', anchor: c };
        setRect(rectBetween(c, c));
      },
      onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
        const g = gesture.current;
        if (!g) return;
        const c = cell(e);
        if (g.kind === 'draw') {
          setRect(rectBetween(g.anchor, c));
          return;
        }
        if (g.kind === 'move') {
          const dx = c.x - g.origin.x;
          const dy = c.y - g.origin.y;
          setRect({ ...g.startRect, x: g.startRect.x + dx, y: g.startRect.y + dy });
          return;
        }
        setRect(rectBetween(g.fixed, c));
      },
      onPointerUp: () => { gesture.current = undefined; },
      onPointerCancel: () => { gesture.current = undefined; },
    },
  };
}

/**
 * Shelf-block tool: draw a rect once, then treat it as one object — drag to
 * move, corner handles to resize (along = shelf length, across = how many).
 */
export function useShelfBlock(layout: StoreLayout, double: boolean, lane: number) {
  const [chosen, setChosen] = useState<Orientation>();
  const defaultStart = nextBlockStart(layout.places.map((p) => p.label), layout.labels);
  const [startLabel, setStartLabel] = useState(defaultStart);
  const [startTouched, setStartTouched] = useState(false);
  const [flip, setFlip] = useState(false);
  const [startIndex, setStartIndex] = useState(0);
  const draft = useRectDraft(() => {
    setChosen(undefined);
    setStartIndex(0);
    setFlip(false);
  });
  const rect = draft.rect;
  const effectiveStart = startTouched ? startLabel : defaultStart;
  const orientation = chosen ?? (rect ? blockOrientation(rect) : 'vertical');
  const raw = rect
    ? fillBlock(layout, rect, { orientation, double, lane, open: true, overlap: true })
    : [];
  const ordered = (() => {
    if (!raw.length) return [] as Shelf[];
    const n = raw.length;
    const idx = ((startIndex % n) + n) % n;
    const rotated = [...raw.slice(idx), ...raw.slice(0, idx)];
    return flip ? [...rotated].reverse() : rotated;
  })();
  const labels = sequenceLabels(effectiveStart || 'B1', ordered.length, layout.labels);
  const shelves = ordered.map((s, i) => ({ ...s, label: labels[i] ?? s.label }));

  return {
    rect,
    orientation,
    setOrientation: (o: Orientation) => setChosen(o),
    shelves,
    startLabel: effectiveStart,
    setStartLabel: (s: string) => { setStartTouched(true); setStartLabel(s); setStartIndex(0); },
    flip,
    setFlip,
    setFirstShelf(shelf: Shelf) {
      const i = raw.findIndex((s) => s.x === shelf.x && s.y === shelf.y && s.orientation === shelf.orientation);
      if (i >= 0) {
        setStartIndex(i);
        setFlip(false);
      }
    },
    reset: () => {
      draft.reset();
      setChosen(undefined);
      setFlip(false);
      setStartIndex(0);
    },
    corners: draft.corners,
    beginCorner: draft.beginCorner,
    svgHandlers: draft.svgHandlers,
  };
}

/** Area tool: same draft gestures as a shelf block; the rect is the area. */
export function useAreaDraft() {
  const draft = useRectDraft();
  const [label, setLabel] = useState('');
  return {
    ...draft,
    label,
    setLabel,
    reset: () => { draft.reset(); setLabel(''); },
  };
}

/** Options while dragging out an area on the map. */
export function AreaPanel({ rect, label, setLabel, onAdd, onCancel }: {
  rect?: Rect;
  label: string;
  setLabel: (s: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="card block-panel" aria-label="Area">
      <div className="block-head">
        <b>▦ Area</b>
        <span className="muted small">
          {rect
            ? `${rect.w} × ${rect.h} squares · drag to move · corners to resize`
            : 'Drag across the map to mark a region without shelves (Produce, Bakery…).'}
        </span>
      </div>
      <div className="block-options">
        <label className="lane-field first-label-field">
          <span>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Produce"
            aria-label="Area label" inputMode="text" />
        </label>
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <span style={{ flex: 1 }} />
        <button className="btn primary" disabled={!rect || rect.w < 1 || rect.h < 1} onClick={onAdd}>
          Add area
        </button>
      </div>
    </section>
  );
}
