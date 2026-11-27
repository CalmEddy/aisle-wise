import { useEffect, useState } from 'react';
import { type ShoppingList } from '../core/types';
import { Icon } from './Icon';

/** What the Shop tab / Setup → Lists can do with the household's lists. */
export interface ListsApi {
  all: ShoppingList[];
  /** The list being shopped (Shop) or focused for stocking (Setup). */
  current: string;
  /** Things still to buy on each list. */
  counts: Map<string, number>;
  /** Checked-off count per list (for clear affordances). */
  doneCounts: Map<string, number>;
  switchTo: (id: string) => void;
  /** Creates a list without switching to it (shared with the household if asked). Returns its id. */
  create: (name: string, shared?: boolean) => string;
  /** Name of the household when this phone is in one (lists can then be shared). */
  household?: string;
  rename: (id: string, name: string) => void;
  /** Deletes a list and its items (not the main list). Returns what Undo restores. */
  remove: (id: string) => import('../App').Snapshot | undefined;
  /** Copies what's still to buy on `sources` onto the current list. */
  combine: (sources: string[]) => { added: number; skipped: number; snapshot: import('../App').Snapshot };
  /** What combining would do, without doing it. */
  preview: (sources: string[]) => { added: number; skipped: number };
  /** Other list ids also shown on Shop this trip (non-destructive overlay). */
  shopWith: string[];
  setShopWith: (ids: string[]) => void;
}

/**
 * Shop: switch the list being shopped and combine items from other lists.
 */
export function ListsSheet({ lists, onCombined, onClose }: {
  lists: ListsApi;
  onCombined?: (text: string, snapshot: import('../App').Snapshot) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const current = lists.all.find((l) => l.id === lists.current)!;
  const others = lists.all.filter((l) => l.id !== lists.current);
  const preview = lists.preview([...picked]);
  const toBuy = (id: string) => lists.counts.get(id) ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const done = (id: string) => lists.doneCounts.get(id) ?? 0;

  function status(id: string) {
    const n = toBuy(id);
    if (n > 0) return `${n} to buy`;
    if (done(id) > 0) return 'All checked';
    return 'Empty';
  }

  // Trip mode: select which list to shop + combine. Include-other-lists lives on the Shop screen.
  const row = (l: ShoppingList) => {
    const isCurrent = l.id === lists.current;
    return (
      <li key={l.id} className={isCurrent ? 'current' : ''}>
        <button
          className="list-pick"
          onClick={() => { lists.switchTo(l.id); onClose(); }}
          aria-current={isCurrent}
        >
          <span className="radio" aria-hidden="true">{isCurrent ? '●' : '○'}</span>
          <span className="name">{l.name}{l.shared && <Icon name="users" className="shared-mark" title="Shared with household" />}</span>
          <span className="muted small">{isCurrent ? 'Selected' : status(l.id)}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet lists-sheet" role="dialog" aria-label="Choose list" onClick={(e) => e.stopPropagation()}>
        <h2>Choose list</h2>
        <p className="muted small">Select the list for this trip. Include more lists from the List options button (sliders) in the header.</p>

        <section className="lists-section">
          <h3>Lists</h3>
          <ul className="lists">{lists.all.map((l) => row(l))}</ul>
        </section>

        {others.length > 0 && onCombined && (
          <section className="combine">
            <h3>Add from other lists</h3>
            <p className="muted small">
              Copy what’s still to buy onto “{current.name}”. The other lists stay as they are — handy for staples or a recipe.
            </p>
            {others.map((l) => (
              <label key={l.id} className="check">
                <input type="checkbox" checked={picked.has(l.id)} onChange={(e) => setPicked((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(l.id);
                  else next.delete(l.id);
                  return next;
                })} />
                <span>{l.name} <span className="muted small">· {toBuy(l.id)} to buy</span></span>
              </label>
            ))}
            <div className="sheet-actions">
              <span className="muted small">
                {picked.size ? `${preview.added} to add${preview.skipped ? `, ${preview.skipped} already on it` : ''}` : ''}
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn primary" disabled={!preview.added} onClick={() => {
                const names = others.filter((l) => picked.has(l.id)).map((l) => `“${l.name}”`).join(' and ');
                const r = lists.combine([...picked]);
                onCombined(`Added ${r.added} item${r.added === 1 ? '' : 's'} from ${names}${r.skipped ? ` (${r.skipped} already on it)` : ''}.`, r.snapshot);
                onClose();
              }}>
                Add {preview.added || ''} item{preview.added === 1 ? '' : 's'}
              </button>
            </div>
          </section>
        )}
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
