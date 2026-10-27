import { useState } from 'react';
import { blockOrientation, fillBlock } from '../core/rows';
import type { Orientation, Point, Rect, Shelf, StoreLayout } from '../core/types';
import { toGrid } from './StoreMap';

/** Squares from one corner to another, inclusive. */
const rectBetween = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1,
});

/**
 * Dragging out a rectangle on the store map. Pass the returned handlers to
 * the map's <svg>; `rect` is what's been dragged so far.
 */
export function useBlockDrag(layout: StoreLayout) {
  const [start, setStart] = useState<Point>();
  const [rect, setRect] = useState<Rect>();
  const cell = (e: React.PointerEvent<SVGSVGElement>): Point => {
    const p = toGrid(e.currentTarget, e.clientX, e.clientY);
    return {
      x: Math.max(0, Math.min(layout.width - 1, Math.floor(p.x))),
      y: Math.max(0, Math.min(layout.height - 1, Math.floor(p.y))),
    };
  };
  return {
    rect,
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
  };
}

/**
 * Options for a dragged-out block of shelves, with a live count. The shelves
 * themselves are shown as ghosts on the map by the caller (`blockShelves`).
 */
export function ShelfBlockPanel({ rect, shelves, orientation, setOrientation, double, setDouble, lane, setLane, onAdd, onCancel }: {
  rect?: Rect;
  shelves: Shelf[];
  orientation: Orientation;
  setOrientation: (o: Orientation) => void;
  double: boolean;
  setDouble: (d: boolean) => void;
  lane: number;
  setLane: (n: number) => void;
  onAdd: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="card block-panel" aria-label="Shelf block">
      <div className="block-head">
        <b>▤ Shelf block</b>
        <span className="muted small">
          {rect ? `${rect.w} × ${rect.h} squares · ${shelves.length} shel${shelves.length === 1 ? 'f' : 'ves'}` : 'Drag across the map to mark where the shelves go.'}
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

/**
 * Everything a screen needs for the shelf-block tool: the drag, the options
 * (direction follows the drag's longer side until changed), and the shelves
 * that would be added.
 */
export function useShelfBlock(layout: StoreLayout, double: boolean, lane: number) {
  const drag = useBlockDrag(layout);
  const [chosen, setChosen] = useState<Orientation>();
  const orientation = chosen ?? (drag.rect ? blockOrientation(drag.rect) : 'vertical');
  const shelves = drag.rect ? fillBlock(layout, drag.rect, { orientation, double, lane }) : [];
  return {
    drag,
    orientation,
    setOrientation: setChosen,
    shelves,
    reset: () => { drag.clear(); setChosen(undefined); },
    svgHandlers: {
      onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => { setChosen(undefined); drag.down(e); },
      onPointerMove: drag.move,
      onPointerUp: drag.up,
      onPointerCancel: drag.up,
    },
  };
}
