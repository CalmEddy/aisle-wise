import type { Category, Product } from './types';

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
  /** Normalized names, longest first, for "organic whole milk" → Milk. */
  private longestFirst: { key: string; product: Product }[];

  constructor(readonly products: Product[], readonly categories: Category[]) {
    this.productById = new Map(products.map((p) => [p.id, p]));
    this.categoryById = new Map(categories.map((c) => [c.id, c]));
    this.byName = new Map();
    for (const p of products) {
      const key = normalize(p.name);
      if (key && !this.byName.has(key)) this.byName.set(key, p);
    }
    this.longestFirst = [...this.byName].map(([key, product]) => ({ key, product }))
      .sort((a, b) => b.key.length - a.key.length);
  }

  /** The master-list item a typed name refers to: exact name first, then the longest name inside it. */
  match(name: string): Product | undefined {
    const key = normalize(name);
    if (!key) return undefined;
    const exact = this.byName.get(key);
    if (exact) return exact;
    const padded = ` ${key} `;
    return this.longestFirst.find((e) => padded.includes(` ${e.key} `))?.product;
  }

  /** Only an exact (normalized) name match. */
  exact(name: string): Product | undefined {
    return this.byName.get(normalize(name));
  }

  /** Master-list items matching what the user is typing, best first. */
  suggest(query: string, limit = 6, exclude: Set<string> = new Set()): Product[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const nq = normalize(q);
    const scored: { p: Product; score: number }[] = [];
    for (const p of this.products) {
      if (exclude.has(p.id)) continue;
      const name = p.name.toLowerCase();
      let score = -1;
      if (name.startsWith(q)) score = 0;
      else if (name.split(/[\s-]+/).some((w) => w.startsWith(q))) score = 1;
      else if (name.includes(q) || (nq && normalize(name).includes(nq))) score = 2;
      if (score >= 0) scored.push({ p, score });
    }
    return scored
      .sort((a, b) => a.score - b.score || a.p.name.length - b.p.name.length || a.p.name.localeCompare(b.p.name))
      .slice(0, limit)
      .map((s) => s.p);
  }
}
