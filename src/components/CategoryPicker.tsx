import { useId, useMemo, useRef, useState } from 'react';
import { inWalkingOrder, parentOf } from '../core/taxonomy';
import type { Category } from '../core/types';

/** Categories sorted A–Z by name. */
export function byName<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Type to search, tap to choose. Shows the categories in walking order, each
 * with its subcategories under it (either can be chosen); typing narrows the
 * list (subcategories show their category), and Enter picks the first match.
 */
export function CategoryPicker({ value, categories, onPick, iconOf, noneLabel, placeholder, label, note, clearOnPick, autoFocus }: {
  /** Chosen category id; undefined for none. */
  value?: string;
  categories: readonly Category[];
  onPick: (id: string | undefined) => void;
  iconOf?: (id: string) => string | undefined;
  /** Offer a "no category" choice with this label. */
  noneLabel?: string;
  placeholder?: string;
  /** Accessible name for the search box. */
  label: string;
  /** Extra text after a category's name, e.g. where it's stocked now. */
  note?: (id: string) => string | undefined;
  /** Empty the box after choosing (for "add" pickers). */
  clearOnPick?: boolean;
  /** Focus (and open) straight away. */
  autoFocus?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const current = categories.find((c) => c.id === value);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const parentOfCat = (c: Category) => c.parent ?? parentOf(c.id);
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = inWalkingOrder(categories);
    if (!q) {
      // Each category, then its subcategories.
      const tops = sorted.filter((c) => !parentOfCat(c) || !byId.has(parentOfCat(c)!));
      return tops.flatMap((t) => [t, ...sorted.filter((c) => parentOfCat(c) === t.id)]);
    }
    // Names starting with the text come first, then names containing it (or whose category's name does).
    const hay = (c: Category) => `${c.name} ${byId.get(parentOfCat(c) ?? '')?.name ?? ''}`.toLowerCase();
    const starts = sorted.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = sorted.filter((c) => !starts.includes(c) && hay(c).includes(q));
    return [...starts, ...contains];
  }, [categories, query, byId]);
  const showNone = !!noneLabel && !query.trim();

  function choose(id: string | undefined) {
    onPick(id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  const currentParent = current && byId.get(parentOfCat(current) ?? '');
  const shown = current && !open && !clearOnPick ? `${iconOf?.(current.id) ?? ''} ${current.name}${currentParent ? ` · ${currentParent.name}` : ''}`.trim() : query;

  return (
    <div className={`cat-picker${open ? ' open' : ''}`}>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        autoComplete="off"
        autoFocus={autoFocus}
        value={shown}
        placeholder={open ? 'Type to search…' : current ? current.name : placeholder ?? noneLabel ?? 'Choose a category'}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setOpen(true); setQuery(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (options[0]) choose(options[0].id);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
            inputRef.current?.blur();
          }
        }}
        // Delay so a tap on an option lands before the list closes.
        onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); }, 150)}
      />
      {open && (
        <ul className="cat-options" id={listId} role="listbox" aria-label={label}>
          {showNone && (
            <li role="option" aria-selected={!value} className={!value ? 'active' : ''}
              onPointerDown={(e) => e.preventDefault()} onClick={() => choose(undefined)}>
              <span className="muted">{noneLabel}</span>
            </li>
          )}
          {options.map((c) => {
            const extra = note?.(c.id);
            const parent = parentOfCat(c) && byId.get(parentOfCat(c)!);
            const searching = !!query.trim();
            return (
              <li key={c.id} role="option" aria-selected={c.id === value}
                className={[c.id === value && 'active', parent ? 'cat-sub' : 'cat-top'].filter(Boolean).join(' ')}
                onPointerDown={(e) => e.preventDefault()} onClick={() => choose(c.id)}>
                {iconOf && !parent && <span aria-hidden="true" className="cat-option-icon">{iconOf(c.id)}</span>}
                {c.name}
                {parent && searching && <span className="muted small"> · {parent.name}</span>}
                {extra && <span className="muted small"> ({extra})</span>}
              </li>
            );
          })}
          {options.length === 0 && <li className="muted small empty">No category matches “{query.trim()}”.</li>}
        </ul>
      )}
    </div>
  );
}
