import { useRef, useState, type RefObject } from 'react';
import type { Rect } from '../core/types';

export const MAX_ZOOM = 8;

interface View { scale: number; cx: number; cy: number }

/**
 * Zooming and panning the map in the editor: pinch and two-finger pan, the
 * mouse wheel, + / − / fit buttons, and (when `canPan` says so, e.g. the Walk
 * tool with nothing being dragged) a one-finger drag once zoomed in. The
 * spot under your fingers stays under them while zooming.
 *
 * Put `handlers` on a box around the map's <svg>; pass `rect` to the map as
 * the part to show (undefined: the whole store).
 */
export function useMapZoom(svgRef: RefObject<SVGSVGElement>, width: number, height: number, opts: {
  /** One-finger drags may pan (no tool is using them). */
  canPan: () => boolean;
  /** A two-finger gesture started: tools should drop what they were dragging. */
  onGesture: () => void;
  /** A one-finger pan happened: the tap that follows shouldn't count. */
  onPanned: () => void;
}) {
  const [view, setView] = useState<View>({ scale: 1, cx: width / 2, cy: height / 2 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ scale: number; anchor: { x: number; y: number }; dist: number } | null>(null);
  const pan = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  const clampView = (v: View): View => {
    const scale = Math.max(1, Math.min(MAX_ZOOM, v.scale));
    const w = width / scale;
    const h = height / scale;
    return { scale, cx: Math.max(w / 2, Math.min(width - w / 2, v.cx)), cy: Math.max(h / 2, Math.min(height - h / 2, v.cy)) };
  };
  /** Grid squares per screen pixel at a zoom level (the map fits its box, keeping its shape). */
  const perPx = (scale: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return 0;
    return Math.max(width / scale / box.width, height / scale / box.height);
  };
  /** The grid point under a screen point, in the current view. */
  const gridAt = (sx: number, sy: number, v: View) => {
    const box = svgRef.current!.getBoundingClientRect();
    const k = perPx(v.scale);
    return { x: v.cx + (sx - (box.left + box.width / 2)) * k, y: v.cy + (sy - (box.top + box.height / 2)) * k };
  };
  /** The view at `scale` that keeps grid point `anchor` under screen point (sx, sy). */
  const anchored = (anchor: { x: number; y: number }, sx: number, sy: number, scale: number): View => {
    const box = svgRef.current!.getBoundingClientRect();
    const k = perPx(scale);
    return clampView({ scale, cx: anchor.x - (sx - (box.left + box.width / 2)) * k, cy: anchor.y - (sy - (box.top + box.height / 2)) * k });
  };
  const two = () => {
    const [a, b] = [...pointers.current.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };

  /** Zoom by a factor, centred on a grid point if given (e.g. what's selected). */
  const zoomBy = (factor: number, at?: { x: number; y: number }) =>
    setView((v) => clampView({ scale: v.scale * factor, cx: at?.x ?? v.cx, cy: at?.y ?? v.cy }));
  const rect: Rect | undefined = view.scale <= 1.001 ? undefined : {
    x: view.cx - width / view.scale / 2, y: view.cy - height / view.scale / 2, w: width / view.scale, h: height / view.scale,
  };

  return {
    rect,
    scale: view.scale,
    zoomIn: (at?: { x: number; y: number }) => zoomBy(1.5, at),
    zoomOut: () => zoomBy(1 / 1.5),
    fit: () => setView({ scale: 1, cx: width / 2, cy: height / 2 }),
    /** Zooms in on a grid point (e.g. a selection). */
    focusOn: (x: number, y: number, scale = 2.5) => setView(clampView({ scale, cx: x, cy: y })),
    handlers: {
      onPointerDownCapture(e: React.PointerEvent) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          pan.current = null;
          opts.onGesture();
          const { mid, dist } = two();
          gesture.current = { scale: view.scale, anchor: gridAt(mid.x, mid.y, view), dist };
          e.stopPropagation();
        } else if (pointers.current.size === 1 && view.scale > 1.001) {
          pan.current = { x: e.clientX, y: e.clientY, view, moved: false };
        }
      },
      onPointerMoveCapture(e: React.PointerEvent) {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (gesture.current && pointers.current.size >= 2) {
          const { mid, dist } = two();
          setView(anchored(gesture.current.anchor, mid.x, mid.y, gesture.current.scale * (dist / gesture.current.dist)));
          e.stopPropagation();
          return;
        }
        const p = pan.current;
        if (p && opts.canPan()) {
          const dx = e.clientX - p.x;
          const dy = e.clientY - p.y;
          if (!p.moved && Math.hypot(dx, dy) < 8) return;
          p.moved = true;
          const k = perPx(p.view.scale);
          setView(clampView({ ...p.view, cx: p.view.cx - dx * k, cy: p.view.cy - dy * k }));
          e.stopPropagation();
        }
      },
      onPointerUpCapture(e: React.PointerEvent) {
        pointers.current.delete(e.pointerId);
        if (gesture.current) {
          if (pointers.current.size === 0) gesture.current = null;
          opts.onPanned();
          e.stopPropagation();
          return;
        }
        if (pan.current?.moved) opts.onPanned();
        pan.current = null;
      },
      onPointerCancelCapture(e: React.PointerEvent) {
        pointers.current.delete(e.pointerId);
        if (!pointers.current.size) { gesture.current = null; pan.current = null; }
      },
      onWheel(e: React.WheelEvent) {
        if (!svgRef.current) return;
        const v = view;
        const anchor = gridAt(e.clientX, e.clientY, v);
        setView(anchored(anchor, e.clientX, e.clientY, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      },
    },
  };
}
