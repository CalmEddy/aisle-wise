/**
 * Shelf labels that aren't aisle numbers: "B12" (section B, shelf 12),
 * "12-3", "3B" or whatever a store uses. A store's label style is taught
 * by example: the shopper types a real label and says what each part is.
 */

/** What a part of a label means. */
export type LabelRole = 'section' | 'shelf' | 'ignore';

/** How neighbouring shelves in a section stand. */
export type Pairing =
  /** Each shelf on its own, a walkway between every one: 1 · 2 · 3 · 4 */
  | 'single'
  /** Back to back in pairs: 1|2 · 3|4 · 5|6 */
  | 'backToBack'
  /** Facing across walkways, the middle ones back to back: 1 · 2|3 · 4|5 */
  | 'facing'
  /** One after another along a single row */
  | 'row';

export interface LabelStyle {
  /** The label the shopper taught it with ("B12"). */
  example: string;
  /** What each run of letters or digits in a label means, in order. */
  roles: LabelRole[];
  pairing: Pairing;
}

export interface Token { text: string; kind: 'letters' | 'digits' }

/** "B-12" → [B, 12]; separators are dropped. */
export function tokenize(label: string): Token[] {
  return [...label.trim().toUpperCase().matchAll(/[A-Z]+|\d+/g)].map((m) => ({ text: m[0], kind: /\d/.test(m[0]) ? 'digits' : 'letters' }));
}

/** A first guess at what the parts of an example mean: letters are the section, the last number the shelf. */
export function guessRoles(example: string): LabelRole[] {
  const t = tokenize(example);
  const lastDigits = t.map((x) => x.kind).lastIndexOf('digits');
  const firstLetters = t.findIndex((x) => x.kind === 'letters');
  return t.map((x, i) => {
    if (i === lastDigits) return 'shelf';
    if (i === firstLetters || (firstLetters < 0 && x.kind === 'digits')) return 'section';
    return 'ignore';
  });
}

/** Whether something typed as an aisle is really a shelf label (letters, or more than one part). */
export function looksLikeShelfCode(text: string): boolean {
  const t = tokenize(text);
  if (t.length < 2) return false;
  // "12B" is an aisle with a letter (aisle 12, side B); "B12" or "12-3" are shelf codes.
  return !(t.length === 2 && t[0].kind === 'digits' && t[1].kind === 'letters' && t[1].text.length === 1);
}

/** Reads a label in a store's style: its section and shelf number. Undefined if it doesn't fit the style. */
export function parseLabel(style: LabelStyle, label: string): { section: string; shelf?: number } | undefined {
  const t = tokenize(label);
  const pattern = tokenize(style.example);
  if (t.length !== pattern.length || t.some((x, i) => x.kind !== pattern[i].kind)) return undefined;
  const section = t.filter((_, i) => style.roles[i] === 'section').map((x) => x.text).join('-');
  const shelfTok = t.find((_, i) => style.roles[i] === 'shelf');
  if (!section) return undefined;
  return { section, ...(shelfTok && /^\d+$/.test(shelfTok.text) && { shelf: Number(shelfTok.text) }) };
}

/** A label in the store's style for a section and shelf ("B12", "12-3"), keeping the example's separators. */
export function formatLabel(style: LabelStyle | undefined, section: string, shelf?: number): string {
  if (!style) return `${section}${shelf ?? ''}`;
  const parts = section.split('-');
  const ex = style.example.trim().toUpperCase();
  let out = '';
  let last = 0;
  let si = 0;
  [...ex.matchAll(/[A-Z]+|\d+/g)].forEach((m, i) => {
    out += ex.slice(last, m.index);
    const role = style.roles[i];
    out += role === 'section' ? (parts[si++] ?? '') : role === 'shelf' ? String(shelf ?? '') : m[0];
    last = m.index! + m[0].length;
  });
  return out + ex.slice(last);
}

/** The shelves you're most likely at next: this one, the next ones the way you've been going, the one behind. */
export function nextShelves(trail: { section: string; shelf?: number }[]): { section: string; shelf: number }[] {
  const last = trail[trail.length - 1];
  if (!last?.shelf) return [];
  const prev = trail.length > 1 ? trail[trail.length - 2] : undefined;
  const step = prev && prev.section === last.section && prev.shelf && prev.shelf !== last.shelf
    ? Math.max(-2, Math.min(2, last.shelf - prev.shelf)) : 1;
  const nums = [last.shelf, last.shelf + step, last.shelf + 2 * step, last.shelf - Math.sign(step)].filter((n) => n > 0);
  return [...new Set(nums)].map((shelf) => ({ section: last.section, shelf }));
}

/**
 * Where each shelf of a section stands, across the section (squares from
 * one side), for a pairing. Shelf 1 is first; walkways are 2 squares.
 */
export function shelfOffsets(pairing: Pairing, count: number): number[] {
  return Array.from({ length: count }, (_, k) => {
    switch (pairing) {
      case 'single': return k * 3;
      case 'backToBack': return Math.floor(k / 2) * 4 + (k % 2);
      case 'facing': return k === 0 ? 0 : 3 + Math.floor((k - 1) / 2) * 4 + ((k - 1) % 2);
      case 'row': return 0;
    }
  });
}

export const PAIRINGS: { id: Pairing; name: string; hint: string }[] = [
  { id: 'single', name: 'Each on its own', hint: 'A walkway between every shelf' },
  { id: 'backToBack', name: 'Back to back in pairs', hint: '1|2, walkway, 3|4' },
  { id: 'facing', name: 'Facing pairs', hint: '1, walkway, 2|3, walkway, 4' },
  { id: 'row', name: 'Along one row', hint: 'One after another in a line' },
];
