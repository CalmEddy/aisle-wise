import { growStore, type Direction } from './build';
import { footprint } from './geometry';
import type { Place, Point, Rect, Shelf, StoreLayout } from './types';

/**
 * Growing the store for new shelves/areas: make room for footprints, keep
 * outer wall shelves on the perimeter, and push existing places aside when
 * something new needs their squares.
 */

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Grow a rectangle by `gap` squares on every side (for clearance corridors). */
export function inflateRect(r: Rect, gap: number): Rect {
  if (gap <= 0) return r;
  return { x: r.x - gap, y: r.y - gap, w: r.w + 2 * gap, h: r.h + 2 * gap };
}

const shiftPoint = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

/** A wall shelf: backed, or a generated wall/department. */
export function isWallShelf(p: Place): p is Shelf {
  return p.kind === 'shelf' && (p.back !== undefined || /^g-(wall|dept)-/.test(p.id));
}

/** Which outer wall a wall shelf sits on. */
export function wallSide(s: Shelf, layout: Pick<StoreLayout, 'width' | 'height'>): 'left' | 'right' | 'back' | 'front' {
  if (s.orientation === 'horizontal') {
    if (s.back === -1) return 'back';
    if (s.back === 1) return 'front';
    return s.y <= 2 || s.y < layout.height / 2 ? 'back' : 'front';
  }
  if (s.back === -1) return 'left';
  if (s.back === 1) return 'right';
  return s.x <= 2 || s.x < layout.width / 2 ? 'left' : 'right';
}

/**
 * Grows the store so every rectangle fits inside, inserting empty floor on
 * that side. Growing left/up shifts coordinates (same as growStore).
 */
export function makeRoom(l: StoreLayout, rects: Rect[]): { layout: StoreLayout; shift: Point } {
  let layout = l;
  const shift = { x: 0, y: 0 };
  if (!rects.length) return { layout, shift };
  const grow = (dir: Direction, by: number) => {
    if (by <= 0) return;
    const g = growStore(layout, dir, by);
    layout = g.layout;
    shift.x += g.shift.x;
    shift.y += g.shift.y;
  };
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w - 1));
  const maxY = Math.max(...rects.map((r) => r.y + r.h - 1));
  if (minX < 0) grow('left', -minX);
  if (minY < 0) grow('up', -minY);
  // After left/up growth, rects are conceptually shifted with the store origin.
  const sx = shift.x;
  const sy = shift.y;
  if (maxX + sx > layout.width - 1) grow('right', maxX + sx - (layout.width - 1));
  if (maxY + sy > layout.height - 1) grow('down', maxY + sy - (layout.height - 1));
  return { layout, shift };
}

/**
 * Grows the store so `needed` fits, keeping wall shelves on the outer rim:
 * new floor is inserted *inside* the walls (walls move out with the edge).
 * `margin` is walkable squares to leave between content and a wall when
 * content would otherwise sit on/against it.
 */
export function expandKeepingWalls(
  l: StoreLayout,
  needed: Rect[],
  margin = 1,
): { layout: StoreLayout; shift: Point; grown: Partial<Record<Direction, number>> } {
  let layout = l;
  const origin = { x: 0, y: 0 };
  const grown: Partial<Record<Direction, number>> = {};
  if (!needed.length) return { layout, shift: origin, grown };

  const walls = (side: 'left' | 'right' | 'back' | 'front') =>
    layout.places.filter((p): p is Shelf => isWallShelf(p) && wallSide(p, layout) === side);

  const apply = (dir: Direction, by: number) => {
    if (by <= 0) return;
    grown[dir] = (grown[dir] ?? 0) + by;
    const leftWall = new Set(walls('left').map((s) => s.id));
    const rightWall = new Set(walls('right').map((s) => s.id));
    const backWall = new Set(walls('back').map((s) => s.id));
    const frontWall = new Set(walls('front').map((s) => s.id));

    if (dir === 'right') {
      // Interior stays; right wall moves out; width grows.
      layout = {
        ...layout,
        width: layout.width + by,
        places: layout.places.map((p) => (rightWall.has(p.id) ? { ...p, x: p.x + by } : p)),
        aisles: layout.aisles?.map((a) => a), // aisles stay (interior)
      };
      return;
    }
    if (dir === 'down') {
      layout = {
        ...layout,
        height: layout.height + by,
        places: layout.places.map((p) => (frontWall.has(p.id) ? { ...p, y: p.y + by } : p)),
      };
      return;
    }
    if (dir === 'left') {
      // Width grows; everything shifts right except the left wall (stays at the new left).
      origin.x += by;
      layout = {
        ...layout,
        width: layout.width + by,
        entrance: shiftPoint(layout.entrance, by, 0),
        checkout: shiftPoint(layout.checkout, by, 0),
        places: layout.places.map((p) => (leftWall.has(p.id) ? p : { ...p, x: p.x + by })),
        aisles: layout.aisles?.map((a) => ({ ...a, x: a.x + by })),
      };
      return;
    }
    // up
    origin.y += by;
    layout = {
      ...layout,
      height: layout.height + by,
      entrance: shiftPoint(layout.entrance, 0, by),
      checkout: shiftPoint(layout.checkout, 0, by),
      places: layout.places.map((p) => (backWall.has(p.id) ? p : { ...p, y: p.y + by })),
      aisles: layout.aisles?.map((a) => ({ ...a, y: a.y + by })),
    };
  };

  // Shift needed rects as the origin moves during left/up growth.
  const adj = (): Rect[] => needed.map((r) => ({ ...r, x: r.x + origin.x, y: r.y + origin.y }));

  // Repeat a few times: growing one side can change wall positions.
  for (let i = 0; i < 8; i++) {
    const rects = adj();
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));

    const hasLeft = walls('left').length > 0;
    const hasRight = walls('right').length > 0;
    const hasBack = walls('back').length > 0;
    const hasFront = walls('front').length > 0;

    // Interior limit just inside the wall, or the canvas edge.
    const leftLimit = hasLeft ? Math.min(...walls('left').map((s) => s.x + 1)) + margin : 0;
    const topLimit = hasBack ? Math.min(...walls('back').map((s) => s.y + 1)) + margin : 0;

    let did = false;
    if (minX < leftLimit) {
      apply('left', leftLimit - minX);
      did = true;
    }
    if (minY < topLimit) {
      apply('up', topLimit - minY);
      did = true;
    }
    // Recompute after left/up (limits and width change).
    {
      const r2 = adj();
      const maxX2 = Math.max(...r2.map((r) => r.x + r.w));
      const maxY2 = Math.max(...r2.map((r) => r.y + r.h));
      const rightLimit2 = hasRight ? Math.max(...walls('right').map((s) => s.x)) - margin : layout.width;
      const bottomLimit2 = hasFront ? Math.max(...walls('front').map((s) => s.y)) - margin : layout.height;
      if (maxX2 > rightLimit2) {
        apply('right', maxX2 - rightLimit2);
        did = true;
      }
      if (maxY2 > bottomLimit2) {
        apply('down', maxY2 - bottomLimit2);
        did = true;
      }
    }
    // Also ensure absolute canvas contains the rects (no walls case / past edge).
    {
      const r2 = adj();
      const minX2 = Math.min(...r2.map((r) => r.x));
      const minY2 = Math.min(...r2.map((r) => r.y));
      const maxX2 = Math.max(...r2.map((r) => r.x + r.w - 1));
      const maxY2 = Math.max(...r2.map((r) => r.y + r.h - 1));
      if (minX2 < 0) {
        apply('left', -minX2);
        did = true;
      }
      if (minY2 < 0) {
        apply('up', -minY2);
        did = true;
      }
      if (maxX2 > layout.width - 1) {
        apply('right', maxX2 - (layout.width - 1));
        did = true;
      }
      if (maxY2 > layout.height - 1) {
        apply('down', maxY2 - (layout.height - 1));
        did = true;
      }
    }
    if (!did) break;
  }

  return { layout, shift: origin, grown };
}

export interface ClearResult {
  layout: StoreLayout;
  /** How far each moved place was shifted. */
  shiftById: Record<string, Point>;
  /** Origin shift from left/up expansion. */
  shift: Point;
  grown: Partial<Record<Direction, number>>;
}

/**
 * Clears space for `reserved` rectangles: overlapping non-wall places are
 * pushed aside (cascading), then the store expands (walls stay outermost).
 * `preferAcross` biases the push axis (e.g. perpendicular to a shelf block).
 * `gap` keeps that many empty squares around reserved (no butted dead ends).
 */
export function clearFor(
  l: StoreLayout,
  reserved: Rect[],
  opts: { exceptIds?: Iterable<string>; preferAcross?: 'x' | 'y'; gap?: number } = {},
): ClearResult {
  const except = new Set(opts.exceptIds ?? []);
  const gap = Math.max(0, opts.gap ?? 0);
  /** Reserved plus clearance — used for collision, not for final store growth. */
  const keepClear = reserved.map((r) => inflateRect(r, gap));
  const shiftById: Record<string, Point> = {};
  let places = l.places.map((p) => ({ ...p }));
  const aisleBase = l.aisles?.map((a) => ({ ...a })) ?? [];

  const placeRect = (p: Place) => footprint(p);

  const pushPlace = (p: Place, dx: number, dy: number): Place => {
    const next = { ...p, x: p.x + dx, y: p.y + dy };
    const prev = shiftById[p.id] ?? { x: 0, y: 0 };
    shiftById[p.id] = { x: prev.x + dx, y: prev.y + dy };
    return next;
  };

  const clearDist = (mover: Rect, blockers: Rect[], dx: number, dy: number): number => {
    let need = 0;
    for (const r of blockers) {
      if (!overlaps(mover, r)) continue;
      if (dx > 0) need = Math.max(need, r.x + r.w - mover.x);
      if (dx < 0) need = Math.max(need, mover.x + mover.w - r.x);
      if (dy > 0) need = Math.max(need, r.y + r.h - mover.y);
      if (dy < 0) need = Math.max(need, mover.y + mover.h - r.y);
    }
    return need;
  };

  const pickPush = (mover: Rect, blockers: Rect[]): Point => {
    const candidates: { dx: number; dy: number; dist: number }[] = [
      { dx: 1, dy: 0, dist: clearDist(mover, blockers, 1, 0) },
      { dx: -1, dy: 0, dist: clearDist(mover, blockers, -1, 0) },
      { dx: 0, dy: 1, dist: clearDist(mover, blockers, 0, 1) },
      { dx: 0, dy: -1, dist: clearDist(mover, blockers, 0, -1) },
    ].filter((c) => c.dist > 0);

    if (!candidates.length) return { x: 0, y: 0 };

    const after = (c: { dx: number; dy: number; dist: number }): Rect => ({
      ...mover, x: mover.x + c.dx * c.dist, y: mover.y + c.dy * c.dist,
    });
    // Must clear every blocker — short opposite nudges sandwich-oscillate.
    let pool = candidates.filter((c) => !blockers.some((b) => overlaps(after(c), b)));
    if (!pool.length) pool = candidates;

    const axis = opts.preferAcross;
    const onAxis = (c: { dx: number; dy: number }) =>
      (axis === 'x' && c.dx !== 0) || (axis === 'y' && c.dy !== 0) || !axis;
    const preferred = pool.filter(onAxis);
    const list = preferred.length ? preferred : pool;

    const cx = blockers.reduce((s, r) => s + r.x + r.w / 2, 0) / blockers.length;
    const cy = blockers.reduce((s, r) => s + r.y + r.h / 2, 0) / blockers.length;
    const mx = mover.x + mover.w / 2;
    const my = mover.y + mover.h / 2;
    list.sort((a, b) => {
      // Flee the blocker cluster; break ties with shorter distance.
      const aAway = a.dx * a.dist * (mx - cx) + a.dy * a.dist * (my - cy);
      const bAway = b.dx * b.dist * (mx - cx) + b.dy * b.dist * (my - cy);
      if (aAway !== bAway) return bAway - aAway;
      return a.dist - b.dist;
    });
    const best = list[0];
    return { x: best.dx * best.dist, y: best.dy * best.dist };
  };

  const separate = (hit: Place, blockers: Rect[]) => {
    const delta = pickPush(placeRect(hit), blockers);
    const dx = delta.x || (delta.y ? 0 : 1);
    const dy = delta.y;
    places = places.map((p) => (p.id === hit.id ? pushPlace(p, dx, dy) : p));
  };

  /**
   * Rectangles `hit` must respect: always the reserved footprint (so a push
   * that clears a neighbour can't step back onto the incoming block), plus
   * every place it currently overlaps.
   */
  const blockersFor = (hit: Place): Rect[] => {
    const out: Rect[] = [...keepClear];
    for (const p of places) {
      if (p.id === hit.id || except.has(p.id)) continue;
      if (overlaps(placeRect(hit), placeRect(p))) out.push(placeRect(p));
    }
    return out;
  };

  // Cascade: clear reserved (+ gap), then resolve place–place overlaps among non-walls.
  // Prefer pushing places already shifted for the incoming footprint so they
  // don't shove unrelated shelves into each other. Each push clears ALL current
  // blockers at once so a tall aisle jumps past a whole block of horizontals.
  for (let iter = 0; iter < 120; iter++) {
    let hit: Place | undefined;
    for (const p of places) {
      if (except.has(p.id) || isWallShelf(p)) continue;
      if (keepClear.some((r) => overlaps(placeRect(p), r))) {
        hit = p;
        break;
      }
    }
    if (hit) {
      separate(hit, blockersFor(hit));
      continue;
    }
    outer: for (let i = 0; i < places.length; i++) {
      const a = places[i];
      if (except.has(a.id) || isWallShelf(a)) continue;
      for (let j = 0; j < places.length; j++) {
        if (i === j) continue;
        const b = places[j];
        if (except.has(b.id)) continue;
        if (!overlaps(placeRect(a), placeRect(b))) continue;
        if (isWallShelf(b)) {
          hit = a;
          separate(a, blockersFor(a));
          break outer;
        }
        const aMoved = !!shiftById[a.id];
        const bMoved = !!shiftById[b.id];
        hit = aMoved && !bMoved ? a : !aMoved && bMoved ? b : a;
        separate(hit, blockersFor(hit));
        break outer;
      }
    }
    if (!hit) break;
  }

  // Shift aisle labels that sit with moved shelves (same dx/dy as a shelf they touch).
  const aisles = aisleBase.map((a) => {
    let dx = 0;
    let dy = 0;
    let n = 0;
    for (const p of places) {
      const s = shiftById[p.id];
      if (!s || (!s.x && !s.y)) continue;
      const f = placeRect(p);
      // Touching or overlapping the aisle walkway.
      const near = !(f.x > a.x + a.w || f.x + f.w < a.x || f.y > a.y + a.h || f.y + f.h < a.y)
        || Math.abs(f.x + f.w - a.x) <= 1 || Math.abs(a.x + a.w - f.x) <= 1
        || Math.abs(f.y + f.h - a.y) <= 1 || Math.abs(a.y + a.h - f.y) <= 1;
      if (!near) continue;
      dx += s.x;
      dy += s.y;
      n++;
    }
    if (!n) return a;
    return { ...a, x: a.x + Math.round(dx / n), y: a.y + Math.round(dy / n) };
  });

  let layout: StoreLayout = { ...l, places, aisles: aisles.length ? aisles : l.aisles };

  // Expand so reserved + every place fits, walls outermost.
  const allRects = [
    ...reserved,
    ...layout.places.map(placeRect),
    ...(layout.aisles ?? []),
  ];
  const expanded = expandKeepingWalls(layout, allRects, 1);
  // Remap shiftById if origin moved (left/up): place coords already updated in expand.
  return {
    layout: expanded.layout,
    shiftById,
    shift: expanded.shift,
    grown: expanded.grown,
  };
}

/** Union bounding box of rects. */
export function boundsOf(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
}
