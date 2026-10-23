import { forwardRef, type ReactNode, type SVGProps } from 'react';
import { footprint, shelves, walkway } from '../core/geometry';
import type { Place, Point, Stop, StoreLayout } from '../core/types';

interface Props {
  layout: StoreLayout;
  you?: Point;
  stops?: Stop[];
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

/** Bird's-eye store map in grid units. Drop targets carry `data-drop`. */
export const StoreMap = forwardRef<SVGSVGElement, Props>(function StoreMap(
  { layout, you, stops = [], highlightId, selectedId, showGrid, onPlaceTap, onPlacePointerDown, children, svgProps },
  ref,
) {
  return (
    <svg
      ref={ref}
      className="map"
      viewBox={`-0.5 -0.5 ${layout.width + 1} ${layout.height + 1}`}
      role="img"
      aria-label={`${layout.name} map`}
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
          highlighted={highlightId === place.id}
          selected={selectedId === place.id}
          onTap={onPlaceTap}
          onPointerDown={onPlacePointerDown}
        />
      ))}

      <Marker point={layout.entrance} label="IN" className="map-entrance" />
      <Marker point={layout.checkout} label="$" className="map-checkout" />

      {stops.map((stop, i) => (
        <g key={stop.key} className={i === 0 ? 'map-stop next' : 'map-stop'}>
          <circle cx={c(stop.point.x)} cy={c(stop.point.y)} r={1.3} />
          <text x={c(stop.point.x)} y={c(stop.point.y) + 0.5} textAnchor="middle">{i + 1}</text>
        </g>
      ))}

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

function PlaceShape({ place, highlighted, selected, onTap, onPointerDown }: {
  place: Place;
  highlighted: boolean;
  selected: boolean;
  onTap?: (p: Place) => void;
  onPointerDown?: (p: Place, e: React.PointerEvent) => void;
}) {
  const f = footprint(place);
  const w = walkway(place);
  const vertical = place.kind === 'aisle' ? place.orientation === 'vertical' : f.h > f.w * 1.6;
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const room = vertical ? f.h : f.w;
  const size = Math.min(1.5, Math.max(0.8, (vertical ? w.w : w.h) * 0.75), (room / Math.max(1, place.label.length)) * 1.7);
  const cls = ['place', place.kind, highlighted && 'drop-over', selected && 'selected'].filter(Boolean).join(' ');

  return (
    <g
      className={cls}
      data-drop={place.id}
      onClick={onTap ? () => onTap(place) : undefined}
      onPointerDown={onPointerDown ? (e) => onPointerDown(place, e) : undefined}
    >
      <rect x={f.x} y={f.y} width={f.w} height={f.h} className="place-bg" rx={place.kind === 'area' ? 0.6 : 0.2} />
      {shelves(place).map((s, i) => (
        <rect key={i} x={s.x + 0.1} y={s.y + 0.1} width={s.w - 0.2} height={s.h - 0.2} className="place-shelf" rx={0.2} />
      ))}
      <text
        x={cx}
        y={cy}
        className="place-label"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={size}
        transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
      >
        {place.label}
      </text>
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
