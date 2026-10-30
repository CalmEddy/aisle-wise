import { DEPTS } from './clues';
import { buildModel, regenerate, type SectionModel, type StoreModel } from './generate';
import { footprint } from './geometry';
import type { Placement, Product, Rect, StoreLayout, Wall } from './types';

/**
 * Asking where new things go, relative to what's already on the map.
 *
 * Some answers leave the map guessing: "Bakery" (a department, but which
 * wall, and next to what?), or "a table out in the open" (but where?). For
 * each of those the app offers the spots it could go, each with a preview
 * of the whole map with it there, and keeps the shopper's choice as a
 * placement ("after Produce", "by aisle 5") that every rebuild follows.
 */

export interface PlacementSubject {
  /** "sec:<section key>" or "isl:<island key>". */
  ref: string;
  /** What it is, in words ("Bakery", "Freezer case"). */
  name: string;
  /** Its id on the generated map (for a section of shelves: the start of its shelves' ids). */
  placeId: string;
  /** A whole section of shelves: every place whose id starts with `placeId`. */
  group?: boolean;
}

/** The places that make up a subject on a map. */
export const subjectPlaces = (l: StoreLayout, s: PlacementSubject) =>
  l.places.filter((p) => (s.group ? p.id.startsWith(s.placeId) : p.id === s.placeId));

/** The rectangle around a subject's places. */
function subjectRect(l: StoreLayout, s: PlacementSubject): Rect | undefined {
  const rs = subjectPlaces(l, s).map(footprint);
  if (!rs.length) return undefined;
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

export interface PlacementOption {
  placement: Placement;
  /** Where, in words ("Right wall, behind Produce"). */
  label: string;
  /** Where it lands (map squares). */
  ghost: Rect;
  /** The map with it there. */
  preview: StoreLayout;
}

const deptName = (d: string) => DEPTS.find((x) => x.id === d)?.name ?? d;
const sectionId = (sec: SectionModel) => (sec.dept ? `g-dept-${sec.dept}` : `g-wall-${sec.key}`);
const sectionName = (sec: SectionModel) =>
  sec.dept ? deptName(sec.dept) : sec.temp === 'frozen' ? 'Freezers' : sec.temp === 'chilled' ? 'Fridges' : 'Wall shelves';

/** Things the map has only guessed the place of, that the shopper hasn't placed or skipped. */
export function pendingPlacements(layout: StoreLayout, products: Product[], model: StoreModel = buildModel(products, layout.id)): PlacementSubject[] {
  const gen = layout.gen;
  if (!gen?.enabled) return [];
  const done = new Set([...Object.keys(gen.placements ?? {}), ...(gen.placementsSkipped ?? [])]);
  const locked = new Set(gen.locked);
  const onMap = new Set(layout.places.map((p) => p.id));
  const out: PlacementSubject[] = [];
  for (const sec of model.sections) {
    const ref = `sec:${sec.key}`;
    const id = sectionId(sec);
    if (done.has(ref) || locked.has(id) || !onMap.has(id)) continue;
    // Guessed: no wall said, or a wall but not where along it (and something else is on that wall).
    const guessed = !sec.wall || (sec.along === undefined && model.sections.some((o) => o !== sec && o.wall === sec.wall));
    if (guessed) out.push({ ref, name: sectionName(sec), placeId: id });
  }
  // Sections of labelled shelves after the first one heard: where are they from the others?
  // The section with the most answers (where shopping started, usually) is the one the others are placed from.
  const seenBlocks = model.blocks.filter((b) => b.seen);
  const anchor = [...seenBlocks].sort((a, b) => b.count - a.count)[0];
  for (const b of seenBlocks.filter((x) => x !== anchor)) {
    const ref = `block:${b.section}`;
    if (done.has(ref) || !layout.places.some((p) => p.id.startsWith(`g-sec-${b.section}-`))) continue;
    out.push({ ref, name: `Section ${b.section}`, placeId: `g-sec-${b.section}-`, group: true });
  }
  for (const isl of model.islands) {
    const ref = `isl:${isl.key}`;
    const id = `g-open-${isl.key}`;
    if (isl.aisle || done.has(ref) || locked.has(id) || !onMap.has(id)) continue;
    out.push({ ref, name: layout.places.find((p) => p.id === id)!.label, placeId: id });
  }
  return out;
}

/** Which wall a generated wall shelf is on. */
function wallOf(l: StoreLayout, id: string): Wall | undefined {
  const p = l.places.find((x) => x.id === id);
  if (!p || p.kind !== 'shelf') return undefined;
  if (p.orientation === 'horizontal') return 'back';
  const xs = l.places.filter((x) => x.kind === 'shelf').map((x) => x.x);
  return p.x <= Math.min(...xs) ? 'left' : 'right';
}

const WALL_NAME: Record<Wall, string> = { left: 'Left wall', back: 'Back wall', right: 'Right wall' };
/** "behind" / "in front of" on the side walls; "left of" / "right of" along the back. */
const sideWord = (wall: Wall, side: 'before' | 'after') =>
  wall === 'back' ? (side === 'before' ? 'left of' : 'right of') : side === 'before' ? 'in front of' : 'behind';

/** The spots a thing could go, each with its preview (spots that land in the same place are offered once). */
export function placementOptions(layout: StoreLayout, products: Product[], subject: PlacementSubject): PlacementOption[] {
  const gen = layout.gen;
  if (!gen) return [];
  const model = buildModel(products, layout.id);
  const candidates: { placement: Placement; label: string }[] = [];
  if (subject.ref.startsWith('sec:')) {
    const others = model.sections.filter((s) => `sec:${s.key}` !== subject.ref && layout.places.some((p) => p.id === sectionId(s)));
    const used = new Set<Wall>();
    for (const o of others) {
      const wall = wallOf(layout, sectionId(o));
      if (!wall) continue;
      used.add(wall);
      for (const side of ['before', 'after'] as const) {
        candidates.push({ placement: { of: `sec:${o.key}`, side }, label: `${WALL_NAME[wall]}, ${sideWord(wall, side)} ${sectionName(o)}` });
      }
    }
    for (const wall of ['left', 'back', 'right'] as Wall[]) {
      if (!used.has(wall)) candidates.push({ placement: { of: `wall:${wall}` }, label: WALL_NAME[wall] });
    }
  } else if (subject.ref.startsWith('block:')) {
    const me = subject.ref.slice(6);
    const SIDE = { left: 'Left of', right: 'Right of', above: 'Behind', below: 'In front of' } as const;
    for (const b of model.blocks.filter((x) => x.section !== me && (x.seen || layout.places.some((p) => p.id.startsWith(`g-sec-${x.section}-`))))) {
      for (const side of ['left', 'right', 'above', 'below'] as const) {
        candidates.push({ placement: { of: `block:${b.section}`, side }, label: `${SIDE[side]} section ${b.section}` });
      }
    }
  } else {
    for (const a of model.aisles) candidates.push({ placement: { of: `aisle:${a.label}` }, label: `By aisle ${a.label}` });
    candidates.push({ placement: { of: 'wall:left' }, label: 'Left side, in front of the aisles' });
    candidates.push({ placement: { of: 'wall:right' }, label: 'Right side, in front of the aisles' });
  }
  const seen = new Set<string>();
  const out: PlacementOption[] = [];
  for (const c of candidates) {
    const preview = regenerate({ ...layout, gen: { ...gen, placements: { ...gen.placements, [subject.ref]: c.placement } } }, model);
    const ghost = subjectRect(preview, subject);
    if (!ghost) continue;
    const key = `${ghost.x},${ghost.y},${ghost.w},${ghost.h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, ghost, preview });
  }
  return out;
}
