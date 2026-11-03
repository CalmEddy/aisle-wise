import type { Category, Product } from './types';
import { liveParent, liveTop } from './taxonomy';

/** Lowercases, strips punctuation and numbers, and singularises each word. */
export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(' ');
}

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (/(ches|shes|xes|oes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('ss')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** The master grocery list and categories, with lookups for matching typed names. */
export class Catalog {
  readonly productById: Map<string, Product>;
  readonly categoryById: Map<string, Category>;
  private byName: Map<string, Product>;
  /** Names exactly as written (lowercased): "peppers" is Bell peppers, "pepper" Black pepper. */
  private bySpelling: Map<string, Product>;
  /** Normalized names, longest first, for "organic whole milk" → Milk. */
  private longestFirst: { key: string; product: Product }[];

  constructor(readonly products: Product[], readonly categories: Category[]) {
    this.productById = new Map(products.map((p) => [p.id, p]));
    this.categoryById = new Map(categories.map((c) => [c.id, c]));
    this.byName = new Map();
    this.bySpelling = new Map();
    for (const p of products) {
      for (const n of [p.name, ...(p.aliases ?? [])]) {
        const k = n.trim().toLowerCase();
        if (k && !this.bySpelling.has(k)) this.bySpelling.set(k, p);
      }
    }
    // Names first (yours win over aliases), then aliases ("Scallions" → Green onions).
    for (const p of products) {
      const key = normalize(p.name);
      if (key && !this.byName.has(key)) this.byName.set(key, p);
    }
    for (const p of products) {
      for (const a of p.aliases ?? []) {
        const key = normalize(a);
        if (key && !this.byName.has(key)) this.byName.set(key, p);
      }
    }
    this.longestFirst = [...this.byName].map(([key, product]) => ({ key, product }))
      .sort((a, b) => b.key.length - a.key.length);
  }

  /** The master-list item a typed name refers to: exact name first, then the longest name inside it. */
  match(name: string): Product | undefined {
    const key = normalize(name);
    if (!key) return undefined;
    const exact = this.bySpelling.get(name.trim().toLowerCase()) ?? this.byName.get(key);
    if (exact) return exact;
    const padded = ` ${key} `;
    return this.longestFirst.find((e) => padded.includes(` ${e.key} `))?.product;
  }

  /** Only an exact (normalized) name match. */
  exact(name: string): Product | undefined {
    return this.bySpelling.get(name.trim().toLowerCase()) ?? this.byName.get(normalize(name));
  }

  /** Master-list items matching what the user is typing, best first. */
  suggest(query: string, limit = 6, exclude: Set<string> = new Set()): Product[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const nq = normalize(q);
    const scored: { p: Product; score: number }[] = [];
    const scoreOf = (text: string) => {
      const name = text.toLowerCase();
      if (name.startsWith(q)) return 0;
      if (name.split(/[\s-]+/).some((w) => w.startsWith(q))) return 1;
      if (name.includes(q) || (nq && normalize(name).includes(nq))) return 2;
      return -1;
    };
    for (const p of this.products) {
      if (exclude.has(p.id)) continue;
      // Its name, or (a little lower) one of its other names: "scallions" finds Green onions.
      const byName = scoreOf(p.name);
      const byAlias = Math.min(...(p.aliases ?? []).map(scoreOf).filter((x) => x >= 0).map((x) => x + 0.5), Infinity);
      const score = byName >= 0 ? byName : byAlias;
      if (score >= 0 && score < Infinity) scored.push({ p, score });
    }
    // Ties: the more common first, then the shorter name.
    return scored
      .sort((a, b) => a.score - b.score || (a.p.rank ?? 9999) - (b.p.rank ?? 9999) || a.p.name.length - b.p.name.length || a.p.name.localeCompare(b.p.name))
      .slice(0, limit)
      .map((s) => s.p);
  }

  /** Parent category id, honouring edits on this household's category list. */
  parentOf(id: string): string | undefined {
    return liveParent(this.categoryById, id);
  }

  /** Top-level category id for grouping (itself when already a top). */
  topOf(id: string): string {
    return liveTop(this.categoryById, id);
  }

  /** Top-level categories only (no parent), in walking order helpers' preferred order. */
  tops(): Category[] {
    return this.categories.filter((c) => !this.parentOf(c.id));
  }
}
