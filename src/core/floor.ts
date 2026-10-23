import { shelves } from './geometry';
import type { Point, StoreLayout } from './types';

/** Distance used when there's no way to walk between two spots. */
export const UNREACHABLE = 1_000_000;

/**
 * The store's floor as a grid. Shelves block walking; everything else
 * (aisle walkways, open areas, the space between them) is walkable.
 * Walking distances are shortest paths around the shelves.
 */
export class Floor {
  readonly width: number;
  readonly height: number;
  private blocked: Uint8Array;
  private fields = new Map<number, Int32Array>();

  constructor(layout: StoreLayout) {
    this.width = layout.width;
    this.height = layout.height;
    this.blocked = new Uint8Array(this.width * this.height);
    for (const place of layout.places) {
      for (const s of shelves(place)) {
        for (let y = s.y; y < s.y + s.h; y++) {
          for (let x = s.x; x < s.x + s.w; x++) {
            if (this.inside({ x, y })) this.blocked[y * this.width + x] = 1;
          }
        }
      }
    }
  }

  inside(p: Point): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  walkable(p: Point): boolean {
    return this.inside(p) && !this.blocked[p.y * this.width + p.x];
  }

  /** The nearest walkable square to `p` (itself if already walkable). */
  snap(p: Point): Point {
    const c = {
      x: Math.max(0, Math.min(this.width - 1, Math.round(p.x))),
      y: Math.max(0, Math.min(this.height - 1, Math.round(p.y))),
    };
    if (this.walkable(c)) return c;
    const max = Math.max(this.width, this.height);
    for (let r = 1; r < max; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const q = { x: c.x + dx, y: c.y + dy };
          if (this.walkable(q)) return q;
        }
      }
    }
    return c;
  }

  /** Walking distance in grid squares. */
  distance = (a: Point, b: Point): number => {
    const from = this.snap(a);
    const to = this.snap(b);
    const d = this.field(from)[to.y * this.width + to.x];
    return d < 0 ? UNREACHABLE : d;
  };

  reachable(a: Point, b: Point): boolean {
    return this.distance(a, b) < UNREACHABLE;
  }

  /** Breadth-first search outward from one square, cached per start square. */
  private field(from: Point): Int32Array {
    const start = from.y * this.width + from.x;
    const cached = this.fields.get(start);
    if (cached) return cached;

    const dist = new Int32Array(this.width * this.height).fill(-1);
    const queue = new Int32Array(this.width * this.height);
    let head = 0;
    let tail = 0;
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      const x = i % this.width;
      const y = (i - x) / this.width;
      const next = [
        x > 0 ? i - 1 : -1,
        x < this.width - 1 ? i + 1 : -1,
        y > 0 ? i - this.width : -1,
        y < this.height - 1 ? i + this.width : -1,
      ];
      for (const n of next) {
        if (n < 0 || this.blocked[n] || dist[n] >= 0) continue;
        dist[n] = dist[i] + 1;
        queue[tail++] = n;
      }
    }
    this.fields.set(start, dist);
    return dist;
  }
}
