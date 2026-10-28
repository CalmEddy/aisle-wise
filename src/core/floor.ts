import { blocks } from './geometry';
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
  /** For shelf squares, which way the shelf runs: 1 vertical, 2 horizontal. */
  private dir: Uint8Array;
  /** For wall-shelf squares, the closed side: -1 or 1 (0: open both sides). */
  private back: Int8Array;
  private fields = new Map<number, Int32Array>();

  constructor(layout: StoreLayout) {
    this.width = layout.width;
    this.height = layout.height;
    this.blocked = new Uint8Array(this.width * this.height);
    this.dir = new Uint8Array(this.width * this.height);
    this.back = new Int8Array(this.width * this.height);
    for (const place of layout.places) {
      const d = place.kind === 'shelf' ? (place.orientation === 'vertical' ? 1 : 2) : 0;
      const b = place.kind === 'shelf' ? place.back ?? 0 : 0;
      for (const s of blocks(place)) {
        for (let y = s.y; y < s.y + s.h; y++) {
          for (let x = s.x; x < s.x + s.w; x++) {
            if (!this.inside({ x, y })) continue;
            this.blocked[y * this.width + x] = 1;
            this.dir[y * this.width + x] = d;
            this.back[y * this.width + x] = b;
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

  /**
   * Where you can stand to reach a square, and how far you have to reach.
   * Floor: the square itself. Shelf: the floor on either side of it. A shelf
   * has a back wherever another shelf (or the wall) is on that side, so you
   * can't reach through to it. A shelf boxed in on both sides is reached from
   * its open ends, counting the squares in from the end.
   */
  private standing(p: Point): { at: Point; extra: number }[] {
    const c = { x: Math.round(p.x), y: Math.round(p.y) };
    if (this.walkable(c)) return [{ at: c, extra: 0 }];
    const d = this.inside(c) ? this.dir[c.y * this.width + c.x] : 0;
    if (d) {
      const vertical = d === 1;
      const sides = this.openSides(c).filter((q) => this.walkable(q));
      if (sides.length) return sides.map((at) => ({ at, extra: 0 }));
      const ends: { at: Point; extra: number }[] = [];
      for (const step of [-1, 1]) {
        for (let k = 1; ; k++) {
          const q = vertical ? { x: c.x, y: c.y + step * k } : { x: c.x + step * k, y: c.y };
          if (!this.inside(q)) break;
          if (this.walkable(q)) {
            ends.push({ at: q, extra: k - 1 });
            break;
          }
        }
      }
      if (ends.length) return ends;
    }
    const beside = [
      { x: c.x - 1, y: c.y }, { x: c.x + 1, y: c.y }, { x: c.x, y: c.y - 1 }, { x: c.x, y: c.y + 1 },
    ].filter((q) => this.walkable(q));
    return (beside.length ? beside : [this.snap(c)]).map((at) => ({ at, extra: 0 }));
  }

  /** The squares beside a shelf square that it's stocked from: both sides, or just the front of a wall shelf. */
  private openSides(p: Point): Point[] {
    const i = p.y * this.width + p.x;
    const vertical = this.dir[i] === 1;
    const back = this.back[i];
    return ([-1, 1] as const)
      .filter((side) => side !== back)
      .map((side) => (vertical ? { x: p.x + side, y: p.y } : { x: p.x, y: p.y + side }));
  }

  /** A shelf square with no open side to stand at (shelves, walls or its own back in the way). */
  boxedIn(p: Point): boolean {
    if (!this.inside(p) || !this.dir[p.y * this.width + p.x]) return false;
    return !this.openSides(p).some((q) => this.walkable(q));
  }

  /** Walking distance in grid squares. Shelf spots are reached from whichever open side is shorter. */
  distance = (a: Point, b: Point): number => {
    let best = UNREACHABLE;
    for (const from of this.standing(a)) {
      const field = this.field(from.at);
      for (const to of this.standing(b)) {
        const d = field[to.at.y * this.width + to.at.x];
        if (d >= 0 && d + from.extra + to.extra < best) best = d + from.extra + to.extra;
      }
    }
    return best;
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
