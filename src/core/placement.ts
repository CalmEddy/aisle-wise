import { aisleNumber, DEPTS } from './clues';
import { buildModel, regenerate, type SectionModel, type StoreModel } from './generate';
import { footprint } from './geometry';
import type { Orientation, Placement, Product, Rect, StoreLayout, Wall } from './types';

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
  /** A run of aisles made into a block: its aisles' shelves. */
  aisles?: { from: string; to: string };
}

/** A block that can run either way (a section, or a run of aisles). */
export const isBlock = (s: PlacementSubject) => s.ref.startsWith('block:') || s.ref.startsWith('aisles:');

/** The places that make up a subject on a map. */
export const subjectPlaces = (l: StoreLayout, s: PlacementSubject) => {
  if (s.aisles) {
    const lo = aisleNumber(s.aisles.from);
    const hi = aisleNumber(s.aisles.to);
    return l.places.filter((p) => {
      const m = /^g-shelf-(.+)-[LR]$/.exec(p.id);
      const n = m ? aisleNumber(m[1]) : NaN;
      return n >= lo && n <= hi;
    });
  }
  return l.places.filter((p) => (s.group ? p.id.startsWith(s.placeId) : p.id === s.placeId));
};

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

/** A block of shelving to place on request ("block:C" → Section C, "aisles:7" → that run of aisles). */
export function blockSubject(layout: StoreLayout, ref: string): PlacementSubject | undefined {
  if (ref.startsWith('block:')) {
    const sec = ref.slice(6);
    return layout.places.some((p) => p.id.startsWith(`g-sec-${sec}-`)) ? { ref, name: `Section ${sec}`, placeId: `g-sec-${sec}-`, group: true } : undefined;
  }
  const g = layout.gen?.aisleGroups?.find((x) => `aisles:${x.from}` === ref);
  return g ? { ref, name: `Aisles ${g.from}–${g.to}`, placeId: '', group: true, aisles: g } : undefined;
}

/** Things the map has only guessed the place of, that the shopper hasn't placed or skipped. */
export function pendingPlacements(layout: StoreLayout, products: Product[], model: StoreModel = buildModel(products, layout.id)): PlacementSubject[] {
  const gen = layout.gen;
  if (!gen?.enabled) return [];
  const done = new Set([...Object.keys(gen.placements ?? {}), ...(gen.placementsSkipped ?? [])]);
  const locked = new Set(gen.locked);
  const onMap = new Set(layout.places.map((p) => p.id));
  const out: PlacementSubject[] = [];
  // Departments and other wall sections aren't asked about one by one: the departments screen places them all.
  // Sections of labelled shelves aren't asked about either: they're assumed to run in letter order
  // (A on the right, like aisle 1), and any can be placed from Store settings (blockSubject).
  // Runs of aisles made into their own block: where are they?
  for (const g of gen.aisleGroups ?? []) {
    const ref = `aisles:${g.from}`;
    if (done.has(ref)) continue;
    out.push({ ref, name: `Aisles ${g.from}–${g.to}`, placeId: '', group: true, aisles: g });
  }
  for (const isl of model.islands) {
    const ref = `isl:${isl.key}`;
    const id = `g-open-${isl.key}`;
    if (isl.aisle || isl.across || done.has(ref) || locked.has(id) || !onMap.has(id)) continue;
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
export function placementOptions(layout: StoreLayout, products: Product[], subject: PlacementSubject, dir?: Orientation): PlacementOption[] {
  const base = layout.gen;
  if (!base) return [];
  // Trying it the other way round, if asked.
  const gen = dir ? { ...base, directions: { ...base.directions, [subject.ref]: dir } } : base;
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
  } else if (isBlock(subject)) {
    const SIDE = { left: 'Left of', right: 'Right of', above: 'Behind', below: 'In front of' } as const;
    const grouped = (label: string) => (gen.aisleGroups ?? []).some((g) => aisleNumber(label) >= aisleNumber(g.from) && aisleNumber(label) <= aisleNumber(g.to));
    const targets: { ref: string; name: string }[] = [];
    const main = model.aisles.filter((a) => !grouped(a.label));
    if (main.length) targets.push({ ref: 'aisles:main', name: main.length > 1 ? `aisles ${main[0].label}–${main[main.length - 1].label}` : `aisle ${main[0].label}` });
    for (const g of gen.aisleGroups ?? []) targets.push({ ref: `aisles:${g.from}`, name: `aisles ${g.from}–${g.to}` });
    for (const b of model.blocks) if (b.seen || layout.places.some((p) => p.id.startsWith(`g-sec-${b.section}-`))) targets.push({ ref: `block:${b.section}`, name: `section ${b.section}` });
    for (const t of targets.filter((x) => x.ref !== subject.ref)) {
      for (const side of ['left', 'right', 'above', 'below'] as const) {
        candidates.push({ placement: { of: t.ref, side }, label: `${SIDE[side]} ${t.name}` });
      }
    }
  } else {
    for (const a of model.aisles) candidates.push({ placement: { of: `aisle:${a.label}` }, label: `By aisle ${a.label}` });
    candidates.push({ placement: { of: 'wall:left' }, label: 'Left side, in front of the aisles' });
    candidates.push({ placement: { of: 'wall:right' }, label: 'Right side, in front of the aisles' });
  }
  // Same map, same spot (whatever was asked): offered once, named after what it's really next to.
  const byMap = new Map<string, { option: PlacementOption; touching: boolean }>();
  for (const c of candidates) {
    const preview = regenerate({ ...layout, gen: { ...gen, placements: { ...gen.placements, [subject.ref]: c.placement } } }, model);
    const ghost = subjectRect(preview, subject);
    if (!ghost) continue;
    const key = preview.places.map((p) => `${p.id}:${p.x},${p.y}`).join('|');
    const touching = isBlock(subject) ? nextTo(preview, c.placement, ghost) : true;
    const had = byMap.get(key);
    if (!had || (touching && !had.touching)) byMap.set(key, { option: { ...c, ghost, preview }, touching });
  }
  const out = [...byMap.values()].map((x) => x.option);
  return out;
}

/** The rectangle of a block's shelves on a map ("block:B", "aisles:main", "aisles:7"). */
function blockRect(l: StoreLayout, ref: string): Rect | undefined {
  const grouped = l.gen?.aisleGroups ?? [];
  const shelves = l.places.filter((p) => {
    if (ref.startsWith('block:')) return p.id.startsWith(`g-sec-${ref.slice(6)}-`);
    const m = /^g-shelf-([^-]+)-[LR]/.exec(p.id);
    if (!m) return false;
    const n = aisleNumber(m[1]);
    const g = grouped.find((x) => n >= aisleNumber(x.from) && n <= aisleNumber(x.to));
    return ref === 'aisles:main' ? !g : !!g && `aisles:${g.from}` === ref;
  });
  if (!shelves.length) return undefined;
  const rs = shelves.map(footprint);
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}

/** Whether a block ended up right next to what it was placed by (not pushed further along). */
function nextTo(l: StoreLayout, p: Placement, me: Rect): boolean {
  const t = blockRect(l, p.of);
  if (!t) return false;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  switch (p.side) {
    case 'left': return near(me.x + me.w + 2, t.x);
    case 'right': return near(t.x + t.w + 2, me.x);
    case 'above': return near(me.y + me.h + 2, t.y);
    case 'below': return near(t.y + t.h + 2, me.y);
    default: return true;
  }
}
