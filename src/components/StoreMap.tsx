import { forwardRef, type ReactNode, type SVGProps } from 'react';
import { footprint, placeNear, sectionShapes, shelfBacks, type Segment } from '../core/geometry';
import type { SectionLook } from '../display';
import type { Place, Point, Rect, StoreLayout } from '../core/types';

/**
 * A faint, dashed shape for something that could be built: `preview` is what
 * picking up here would build, `next` a shelf you can stamp at the row's
 * spacing, `fill` the shelves you probably walked past. Tappable if `onTap`.
 */
export interface MapGhost {
  rect: Rect;
  kind: 'preview' | 'next' | 'fill' | 'block' | 'wall' | 'lane';
  onTap?: () => void;
  label?: string;
}

/** A small dot marking where items on the list are; `next` for the next stop. */
export interface MapDot {
  x: number;
  y: number;
  next?: boolean;
}

interface Props {
  layout: StoreLayout;
  you?: Point;
  /** Where the items on the list are. */
  dots?: MapDot[];
  /** Red pulsing circles: items the shopper asked to pinpoint. */
  pins?: { x: number; y: number }[];
  /** A pin showing a spot being chosen. */
  preview?: { x: number; y: number };
  /** Shelves that could be built, drawn faint and dashed. */
  ghosts?: MapGhost[];
  /** Tapping an aisle label (build mode); without it labels can't be tapped. */
  onAisleTap?: (id: string) => void;
  selectedAisleId?: string;
  /** Zoom in on this rectangle (grid units). */
  focus?: Rect;
  /** Colours and icons for category sections. */
  look?: SectionLook;
  /** Tap anywhere: grid coordinates (fractions allowed) and the place there, if any. */
  onMapTap?: (x: number, y: number, place: Place | undefined) => void;
  /** Place to outline, e.g. the current drop target. */
  highlightId?: string;
  selectedId?: string;
  showGrid?: boolean;
  onPlaceTap?: (place: Place) => void;
  onPlacePointerDown?: (place: Place, e: React.PointerEvent) => void;
  /** Extra SVG drawn on top (editor handles). */
  children?: ReactNode;
  svgProps?: SVGProps<SVGSVGElement>;
}

/** Centre of a grid square, for drawing. */
const c = (v: number) => v + 0.5;

/** Converts a screen position to map grid coordinates. */
export function toGrid(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
  return { x: p.x, y: p.y };
}

/** The place under a map position (grid units, fractions allowed). */
export function placeUnder(layout: StoreLayout, x: number, y: number): Place | undefined {
  return placeNear(layout, x, y);
}

/** Bird's-eye store map in grid units. Drop targets carry `data-drop`. */
export const StoreMap = forwardRef<SVGSVGElement, Props>(function StoreMap(
  { layout, you, dots = [], pins = [], ghosts = [], onAisleTap, selectedAisleId, preview, focus, look, onMapTap, highlightId, selectedId, showGrid, onPlaceTap, onPlacePointerDown, children, svgProps },
  ref,
) {
  const pad = focus ? 1.5 : 0.5;
  const box = focus ?? { x: 0, y: 0, w: layout.width, h: layout.height };
  const viewBox = `${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`;
  return (
    <svg
      ref={ref}
      className={`map${focus ? ' zoomed' : ''}${onMapTap ? ' tappable' : ''}`}
      viewBox={viewBox}
      role="img"
      aria-label={`${layout.name} map`}
      onClick={onMapTap ? (e) => {
        const p = toGrid(e.currentTarget, e.clientX, e.clientY);
        onMapTap(p.x, p.y, placeUnder(layout, p.x, p.y));
      } : undefined}
      {...svgProps}
    >
      <defs>
        <pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" className="map-gridline" />
        </pattern>
      </defs>
      <rect width={layout.width} height={layout.height} className="map-floor" rx={0.6} />
      {showGrid && <rect width={layout.width} height={layout.height} fill="url(#grid)" />}

      {layout.places.map((place) => (
        <PlaceShape
          key={place.id}
          place={place}
          backs={place.kind === 'shelf' ? shelfBacks(layout, place) : []}
          highlighted={highlightId === place.id}
          selected={selectedId === place.id}
          look={look}
          onTap={onPlaceTap}
          onPointerDown={onPlacePointerDown}
        />
      ))}

      {(layout.aisles ?? []).map((a) => {
        const vertical = a.h > a.w;
        const thick = vertical ? a.w : a.h;
        const run = vertical ? a.h : a.w;
        const size = Math.max(0.45, Math.min(1, thick * 0.6, (run / Math.max(4, a.label.length)) * 1.4));
        const cx = a.x + a.w / 2;
        const cy = a.y + a.h / 2;
        return (
          <g key={a.id} className={`aisle-label${a.id === selectedAisleId ? ' selected' : ''}${onAisleTap ? ' tappable' : ''}`}
            onClick={onAisleTap ? () => onAisleTap(a.id) : undefined}>
            <rect className="aisle-area" x={a.x + 0.1} y={a.y + 0.1} width={a.w - 0.2} height={a.h - 0.2} rx={0.35} />
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={size}
              transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}>{a.label}</text>
          </g>
        );
      })}

      {ghosts.map((g, i) => {
        const r = g.rect;
        const vertical = r.h > r.w;
        return (
          <g key={`g${i}-${r.x}-${r.y}`} className={`map-ghost ${g.kind}${g.onTap ? ' tappable' : ''}`}
            onClick={g.onTap ? (e) => { e.stopPropagation(); g.onTap!(); } : undefined}>
            {g.onTap && <rect className="hit" x={r.x - 0.6} y={r.y - 0.6} width={r.w + 1.2} height={r.h + 1.2} />}
            <rect x={r.x + 0.08} y={r.y + 0.08} width={r.w - 0.16} height={r.h - 0.16} rx={0.25} />
            {g.label && (
              <text x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={0.8}
                transform={vertical ? `rotate(-90 ${r.x + r.w / 2} ${r.y + r.h / 2})` : undefined}>{g.label}</text>
            )}
          </g>
        );
      })}

      <Marker point={layout.entrance} label="IN" className="map-entrance" />
      <Marker point={layout.checkout} label="$" className="map-checkout" />

      {dots.map((d, i) => <circle key={`d${i}`} className={d.next ? 'map-dot next' : 'map-dot'} cx={d.x} cy={d.y} r={0.42} />)}

      {pins.map((p, i) => (
        <g key={`p${i}-${p.x}-${p.y}`} className="map-pin">
          <circle cx={p.x} cy={p.y} r={1.6} className="ring" />
          <circle cx={p.x} cy={p.y} r={0.7} />
        </g>
      ))}

      {preview && (
        <g className="map-preview">
          <circle cx={preview.x} cy={preview.y} r={1.1} />
          <circle cx={preview.x} cy={preview.y} r={0.35} className="core" />
        </g>
      )}

      {you && (
        <g className="map-you">
          <circle cx={c(you.x)} cy={c(you.y)} r={1.8} className="pulse" />
          <circle cx={c(you.x)} cy={c(you.y)} r={1} />
        </g>
      )}
      {children}
    </svg>
  );
});

function PlaceShape({ place, backs, highlighted, selected, look, onTap, onPointerDown }: {
  place: Place;
  /** Edges backed by another shelf (drawn just inside this shelf). */
  backs: Segment[];
  highlighted: boolean;
  selected: boolean;
  look?: SectionLook;
  onTap?: (p: Place) => void;
  onPointerDown?: (p: Place, e: React.PointerEvent) => void;
}) {
  const f = footprint(place);
  const isShelf = place.kind === 'shelf';
  const vertical = isShelf ? place.orientation === 'vertical' : f.h > f.w * 1.6;
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const run = vertical ? f.h : f.w;
  const thick = vertical ? f.w : f.h;
  const chars = Math.max(1, place.label.length);
  // Shelf labels sit on the shelf itself, so they're as tall as the shelf allows.
  const size = isShelf
    ? Math.min(0.78, (run / chars) * 1.6)
    : Math.min(1.5, Math.max(0.8, thick * 0.4), (run / chars) * 1.7);
  const cls = ['place', place.kind, isShelf && place.back && 'wall', highlighted && 'drop-over', selected && 'selected'].filter(Boolean).join(' ');
  const sections = look?.colorOf || look?.iconOf ? sectionShapes(place) : [];
  const pad = 0.6; // easier to tap a thin shelf

  return (
    <g
      className={cls}
      data-drop={place.id}
      onClick={onTap ? () => onTap(place) : undefined}
      onPointerDown={onPointerDown ? (e) => onPointerDown(place, e) : undefined}
    >
      {isShelf && <rect className="hit" x={f.x - pad} y={f.y - pad} width={f.w + pad * 2} height={f.h + pad * 2} />}
      <rect x={f.x} y={f.y} width={f.w} height={f.h} className="place-bg" rx={isShelf ? 0.25 : 0.6} />
      {look?.colorOf && sections.map((sec, i) => {
        const color = look.colorOf!(sec.categoryId);
        if (!color) return null;
        const r = sec.rect;
        const inset = isShelf ? 0.06 : 0.15;
        return (
          <rect key={`c${i}`} className={isShelf ? 'section-shelf' : 'section-band'} x={r.x + inset} y={r.y + inset}
            width={Math.max(0, r.w - inset * 2)} height={Math.max(0, r.h - inset * 2)} rx={0.2} fill={color} />
        );
      })}
      {backs.map((b, i) => {
        // Pull the line just inside this shelf, so back-to-back shelves each show their back.
        const inX = b.x1 === b.x2 ? (b.x1 === f.x ? 0.12 : -0.12) : 0;
        const inY = b.y1 === b.y2 ? (b.y1 === f.y ? 0.12 : -0.12) : 0;
        return <line key={`b${i}`} className="shelf-back" x1={b.x1 + inX} y1={b.y1 + inY} x2={b.x2 + inX} y2={b.y2 + inY} />;
      })}
      {place.label && (
        <text
          x={cx}
          y={cy}
          className={isShelf ? 'place-label shelf-label' : 'place-label'}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size}
          transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
        >
          {place.label}
        </text>
      )}
      {look?.iconOf && sections.map((sec, i) => {
        const icon = look.iconOf!(sec.categoryId);
        if (!icon) return null;
        const r = sec.rect;
        const fit = isShelf ? 0.85 : Math.min(1.8, Math.min(r.w, r.h) * 0.55);
        if (fit < 0.6) return null;
        // Icons go at the start of each section, or its end if the start would cover the shelf's label.
        let along = 0;
        if (isShelf) {
          const start = (vertical ? r.y : r.x) + fit * 0.7;
          const end = (vertical ? r.y + r.h : r.x + r.w) - fit * 0.7;
          const half = place.label ? (place.label.length * size * 0.55) / 2 + fit * 0.6 : 0;
          const mid = vertical ? cy : cx;
          along = Math.abs(start - mid) >= half || Math.abs(end - mid) < half ? start : end;
        }
        const x = isShelf ? (vertical ? r.x + r.w / 2 : along) : r.x + fit * 0.75;
        const y = isShelf ? (vertical ? along : r.y + r.h / 2) : r.y + fit * 0.75;
        return (
          <text key={`i${i}`} className="section-icon" x={x} y={y}
            textAnchor="middle" dominantBaseline="central" fontSize={fit}>{icon}</text>
        );
      })}
    </g>
  );
}

function Marker({ point, label, className }: { point: Point; label: string; className: string }) {
  return (
    <g className={`map-marker ${className}`}>
      <rect x={point.x - 0.4} y={point.y - 0.4} width={1.8} height={1.8} rx={0.4} />
      <text x={c(point.x)} y={c(point.y) + 0.38} textAnchor="middle">{label}</text>
    </g>
  );
}
