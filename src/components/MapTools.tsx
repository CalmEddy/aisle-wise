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
 * A small floating bar of controls next to what's selected on the map: one
 * row, above it if there's room, otherwise below, kept inside the visible
 * map and clear of the tool column. The
 * caller wraps the map in a `position: relative` box and passes the map's
 * <svg> and the selection's rectangle in grid squares.
 */
export function MapTools({ svgRef, anchor, title, rows, viewKey = '' }: {
  svgRef: RefObject<SVGSVGElement>;
  /** Changes when the map is zoomed or panned (so the bar follows). */
  viewKey?: string;
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
      // The visible part of the map, leaving the tool column on the left alone.
      const vis = { left: Math.max(map.left, box.left) + 52, right: Math.min(map.right, box.right) - 4, top: Math.max(map.top, box.top) + 4, bottom: Math.min(map.bottom, box.bottom) - 4 };
      // Above the selection if there's room, else below, else along the top or bottom of the view.
      let top: number;
      if (a.y - h - gap >= vis.top) top = a.y - h - gap;
      else if (b.y + gap + h <= vis.bottom) top = b.y + gap;
      else top = a.y - vis.top > vis.bottom - b.y ? vis.top : vis.bottom - h;
      top -= box.top;
      const centre = (a.x + b.x) / 2;
      const left = Math.max(vis.left, Math.min(vis.right - w, centre - w / 2)) - box.left;
      setPos({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [key, svgRef, rows.length, viewKey]);

  return (
    <div ref={bar} className="map-tools" role="toolbar" aria-label={`Change ${title}`}
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}>
      {rows.flat().map((a) => (
        <button key={a.key} type="button" className={`map-tool${a.danger ? ' danger' : ''}`} onClick={a.onClick} disabled={a.disabled}
          aria-label={a.label} title={a.label}>
          {a.icon}
        </button>
      ))}
    </div>
  );
}
