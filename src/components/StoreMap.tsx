import type { Point, Stop, StoreLayout } from '../core/types';

interface Props {
  store: StoreLayout;
  you: Point;
  stops: Stop[];
}

const PAD = 6;

/** Bird's-eye store map. Front of the store is at the bottom. */
export function StoreMap({ store, you, stops }: Props) {
  const w = store.width + PAD * 2;
  const h = store.depth + PAD * 2;
  const sx = (x: number) => x + PAD;
  const sy = (y: number) => store.depth - y + PAD;

  // Shelves sit between neighbouring aisles, leaving the cross-aisles clear.
  const shelves = store.aisleXs.slice(0, -1).map((x, i) => {
    const next = store.aisleXs[i + 1];
    return { x: x + 3, w: next - x - 6 };
  });

  return (
    <svg className="map" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Store map">
      <rect x={PAD} y={PAD} width={store.width} height={store.depth} className="map-floor" rx={2} />
      {shelves.map((s, i) => (
        <rect key={i} x={sx(s.x)} y={sy(store.depth - 8)} width={s.w} height={store.depth - 16} className="map-shelf" rx={1} />
      ))}
      <text x={sx(store.entrance.x)} y={h - 1} className="map-label">Entrance</text>
      <text x={sx(store.checkout.x)} y={h - 1} className="map-label" textAnchor="middle">Checkout</text>

      {stops.map((stop, i) => (
        <g key={stop.section.id} className={i === 0 ? 'map-stop next' : 'map-stop'}>
          <circle cx={sx(stop.section.point.x)} cy={sy(stop.section.point.y)} r={3.6} />
          <text x={sx(stop.section.point.x)} y={sy(stop.section.point.y) + 1.4} textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}

      <g className="map-you">
        <circle cx={sx(you.x)} cy={sy(you.y)} r={5} className="pulse" />
        <circle cx={sx(you.x)} cy={sy(you.y)} r={2.6} />
      </g>
    </svg>
  );
}
