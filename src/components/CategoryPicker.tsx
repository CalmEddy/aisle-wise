import { useId, useMemo, useRef, useState } from 'react';
import type { Category } from '../core/types';

/** Categories sorted A–Z by name. */
export function byName<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Type to search, tap to choose. Shows categories A–Z; typing narrows the list,
 * and Enter picks the first match.
 */
export function CategoryPicker({ value, categories, onPick, iconOf, noneLabel, placeholder, label, note, clearOnPick }: {
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
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const current = categories.find((c) => c.id === value);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = byName(categories);
    if (!q) return sorted;
    // Names starting with the text come first, then names containing it.
    const starts = sorted.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = sorted.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(q));
    return [...starts, ...contains];
  }, [categories, query]);
  const showNone = !!noneLabel && !query.trim();

  function choose(id: string | undefined) {
    onPick(id);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  }

  const shown = current && !open && !clearOnPick ? `${iconOf?.(current.id) ?? ''} ${current.name}`.trim() : query;

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
            return (
              <li key={c.id} role="option" aria-selected={c.id === value} className={c.id === value ? 'active' : ''}
                onPointerDown={(e) => e.preventDefault()} onClick={() => choose(c.id)}>
                {iconOf && <span aria-hidden="true" className="cat-option-icon">{iconOf(c.id)}</span>}
                {c.name}
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
