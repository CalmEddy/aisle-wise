import type { Catalog } from './catalog';
import { DEPTS } from './clues';
import { Floor, UNREACHABLE } from './floor';
import { BACK_WALL, buildModel, regenerate, type StoreModel } from './generate';
import { locateProduct } from './locate';
import type { Trip } from './trips';
import type { Arrangement, GeneratedMap, LayoutSetting, Point, Product, StoreLayout } from './types';

/**
 * Learning how a store is arranged from the order things were picked up in.
 *
 * Shoppers walk a store sensibly: in through the entrance, along the way,
 * out at the checkout. So for each way the store could be arranged (aisle 1
 * on the right or the left, Produce on the right wall or the left, the back
 * wall one way round or the other), we measure how far the recorded trips
 * would have walked. The arrangement with the shortest walks is most likely
 * right. When it's clearly shorter, the map is updated; when two
 * arrangements are about the same, we ask one question instead.
 *
 * Every map is drawn the same way round (the back of the store at the top,
 * the entrance in the middle of the front), so there's no mirror image to
 * tell apart.
 */

/** How much longer the next-best arrangement's walks must be before we're sure (8%). */
export const CLEAR_MARGIN = 0.08;
/** Picks (with a known place) needed before learning or asking anything. */
export const MIN_PICKS = 6;

export interface LayoutQuestion {
  setting: LayoutSetting;
  text: string;
  options: { label: string; patch: Partial<GeneratedMap> }[];
}

export interface Learned {
  /** Settings the trips show clearly, where they differ from the map now. */
  apply: Arrangement;
  /** One question, for what the trips can't settle. */
  question?: LayoutQuestion;
  /** Picks used (ones the map could place). */
  picks: number;
}

type Choice<K extends keyof Arrangement> = NonNullable<Arrangement[K]>;
const CHOICES: { [K in keyof Arrangement]-?: [Choice<K>, Choice<K>] } = {
  aisleOne: ['near', 'far'],
  produce: ['near', 'far'],
  backWall: ['usual', 'reversed'],
};
const current = <K extends keyof Arrangement>(gen: GeneratedMap, k: K): Choice<K> => (gen[k] ?? CHOICES[k][0]) as Choice<K>;

const deptName = (id: string) => DEPTS.find((d) => d.id === id)?.name ?? id;

/** Settings that make a difference for this store (enough aisles, the departments involved). */
export function relevant(model: StoreModel): (keyof Arrangement)[] {
  const out: (keyof Arrangement)[] = [];
  if (model.aisles.length >= 2) out.push('aisleOne');
  if (unplaced(model, 'produce') || unplaced(model, 'frozen')) out.push('produce');
  if (unplacedBack(model).length >= 2) out.push('backWall');
  return out;
}

/** A department in the store whose wall no answer has said (so it goes where stores usually put it). */
const unplaced = (model: StoreModel, d: string) => model.sections.some((s) => s.dept === d && !s.wall);
/** Back-wall departments placed by the usual order (no wall said). */
export const unplacedBack = (model: StoreModel) => BACK_WALL.filter((d) => unplaced(model, d));

/** The question for a setting, in the shopper's terms. */
export function questionFor(setting: LayoutSetting, model: StoreModel): LayoutQuestion | undefined {
  switch (setting) {
    case 'entrance':
      // The entrance is taken to be in the middle of the front; it's dragged on the map if not.
      return undefined;
    case 'aisleOne':
      return {
        setting,
        text: 'Walking in, is Aisle 1 on the right side of the store or the left?',
        options: [
          { label: 'On the right', patch: { aisleOne: 'near' } },
          { label: 'On the left', patch: { aisleOne: 'far' } },
        ],
      };
    case 'produce': {
      const produce = unplaced(model, 'produce');
      return {
        setting,
        text: produce ? 'Walking in, is Produce along the right wall or the left wall?' : 'Walking in, is the frozen food along the left wall or the right wall?',
        options: [
          { label: produce ? 'Right wall' : 'Left wall', patch: { produce: 'near' } },
          { label: produce ? 'Left wall' : 'Right wall', patch: { produce: 'far' } },
        ],
      };
    }
    case 'backWall': {
      const back = unplacedBack(model);
      if (back.length < 2) return undefined;
      const first = deptName(back[0]);
      const last = deptName(back[back.length - 1]);
      return {
        setting,
        text: `Along the back wall, which is on the left: ${first} or ${last}?`,
        options: [
          { label: first, patch: { backWall: 'usual' } },
          { label: last, patch: { backWall: 'reversed' } },
        ],
      };
    }
  }
}

/** Every combination of the given settings, the rest as they are now. */
function combinations(gen: GeneratedMap, free: (keyof Arrangement)[]): Arrangement[] {
  let out: Arrangement[] = [{ aisleOne: current(gen, 'aisleOne'), produce: current(gen, 'produce'), backWall: current(gen, 'backWall') }];
  for (const k of free) out = out.flatMap((a) => CHOICES[k].map((v) => ({ ...a, [k]: v })));
  return out;
}

const same = (a: Arrangement, b: Arrangement) => a.aisleOne === b.aisleOne && a.produce === b.produce && a.backWall === b.backWall;

/**
 * What the trips at this store say about how it's arranged: settings to
 * change, and at most one question. Only for maps generated from answers.
 */
export function learnArrangement(layout: StoreLayout, products: Product[], trips: Trip[], catalog: Catalog): Learned {
  const gen = layout.gen;
  if (!gen?.enabled) return { apply: {}, picks: 0 };
  const model = buildModel(products, layout.id);
  const sure = new Set(gen.sure ?? []);
  const skipped = new Set(gen.skipped ?? []);
  const free = relevant(model).filter((k) => !sure.has(k));
  const mine = trips.filter((t) => t.layoutId === layout.id && t.picks.length >= 2);

  // Where each pick is in each candidate arrangement.
  const combos = combinations(gen, free);
  const candidates = combos.map((arr) => {
    const l = regenerate({ ...layout, gen: { ...gen, ...arr } }, model);
    const points = mine.map((t) => t.picks.map((p): Point | undefined => {
      const product = (p.productId && catalog.productById.get(p.productId)) || catalog.match(p.name);
      const at = product && locateProduct(product, l, catalog);
      return at?.kind === 'spot' ? at.spot.point : undefined;
    }));
    return { arr, l, floor: new Floor(l), points };
  });
  // Only picks every arrangement can place count (so all are measured on the same walk).
  const counts = mine.map((t, ti) => t.picks.map((_, pi) => candidates.every((c) => c.points[ti][pi])));
  const picks = counts.flat().filter(Boolean).length;
  const asked = (): LayoutQuestion | undefined => undefined;
  if (picks < MIN_PICKS || !free.length) return { apply: {}, question: asked(), picks };

  const scores = candidates.map((c) => {
    let total = 0;
    mine.forEach((_, ti) => {
      const pts = c.points[ti].filter((_, pi) => counts[ti][pi]) as Point[];
      if (pts.length < 2) return;
      let d = c.floor.distance(c.l.entrance, pts[0]);
      for (let i = 1; i < pts.length; i++) d += c.floor.distance(pts[i - 1], pts[i]);
      d += c.floor.distance(pts[pts.length - 1], c.l.checkout);
      total += Math.min(d, UNREACHABLE);
    });
    return total;
  });
  const bestIndex = scores.indexOf(Math.min(...scores));
  const best = combos[bestIndex];
  const bestScore = scores[bestIndex] || 1;

  const apply: Arrangement = {};
  let question: LayoutQuestion | undefined;
  for (const k of free) {
    const flipped = { ...best, [k]: CHOICES[k].find((v) => v !== best[k]) };
    const other = scores[combos.findIndex((c) => same(c, flipped))];
    const margin = (other - bestScore) / bestScore;
    if (margin >= CLEAR_MARGIN) {
      if (best[k] !== current(gen, k)) (apply as Record<string, string>)[k] = best[k]!;
    } else if (other !== bestScore && !skipped.has(k) && !question) {
      // The trips say something about this, but not clearly.
      question = questionFor(k, model);
    }
  }
  return { apply, question: question ?? asked(), picks };
}

/** What changed, in a sentence ("aisle 1 is on the left"). */
export function describeArrangement(a: Arrangement, model?: StoreModel): string {
  const parts: string[] = [];
  if (a.aisleOne) parts.push(a.aisleOne === 'far' ? 'aisle 1 is on the left' : 'aisle 1 is on the right');
  if (a.produce) {
    const produce = !model || model.depts.includes('produce');
    parts.push(produce
      ? (a.produce === 'far' ? 'Produce is along the left wall' : 'Produce is along the right wall')
      : (a.produce === 'far' ? 'frozen food is along the right wall' : 'frozen food is along the left wall'));
  }
  if (a.backWall) parts.push(a.backWall === 'reversed' ? 'the back wall runs the other way' : 'the back wall runs the usual way');
  return parts.join('; ');
}
