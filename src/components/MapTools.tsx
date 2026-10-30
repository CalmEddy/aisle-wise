import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Rect } from '../core/types';

export interface MapAction {
  key: string;
  /** What shows on the button (an icon or a word or two). */
  icon: string;
  /** Full name, for screen readers and tooltips. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/**
 * A small floating bar of controls next to what's selected on the map
 * (above it if there's room, otherwise below), kept inside the map. The
 * caller wraps the map in a `position: relative` box and passes the map's
 * <svg> and the selection's rectangle in grid squares.
 */
export function MapTools({ svgRef, anchor, title, rows }: {
  svgRef: RefObject<SVGSVGElement>;
  anchor: Rect;
  /** A few words on what's selected ("Aisle 3", "3 aisles"). */
  title: string;
  rows: MapAction[][];
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const key = `${anchor.x},${anchor.y},${anchor.w},${anchor.h}`;

  useLayoutEffect(() => {
    const place = () => {
      const svg = svgRef.current;
      const el = bar.current;
      const wrap = el?.offsetParent as HTMLElement | null;
      if (!svg || !el || !wrap) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const pt = (x: number, y: number) => {
        const q = svg.createSVGPoint();
        q.x = x;
        q.y = y;
        return q.matrixTransform(ctm);
      };
      const a = pt(anchor.x, anchor.y);
      const b = pt(anchor.x + anchor.w, anchor.y + anchor.h);
      const box = wrap.getBoundingClientRect();
      const map = svg.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 6;
      // Above the selection if it fits inside the map, else below, else over its top edge.
      let top = a.y - box.top - h - gap;
      if (a.y - h - gap < map.top) top = b.y - box.top + gap;
      if (top + h > map.bottom - box.top) top = Math.max(map.top - box.top, a.y - box.top);
      const centre = (a.x + b.x) / 2 - box.left;
      const left = Math.max(map.left - box.left + 2, Math.min(map.right - box.left - w - 2, centre - w / 2));
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [key, svgRef, rows.length]);

  return (
    <div ref={bar} className="map-tools" role="toolbar" aria-label={`Change ${title}`}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}>
      <span className="map-tools-title">{title}</span>
      {rows.map((row, i) => (
        <div key={i} className="map-tools-row">
          {row.map((a) => (
            <button key={a.key} type="button" className={`map-tool${a.danger ? ' danger' : ''}`} onClick={a.onClick} disabled={a.disabled}
              aria-label={a.label} title={a.label}>
              {a.icon}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
