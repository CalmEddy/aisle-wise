import { useState } from 'react';
import type { ListItem } from '../core/types';
import { CategoryPicker } from './CategoryPicker';

export function ItemMenu({ item, where, storeName, categoryId, categories, looks, onCategory, onChangePlace, onWhere, onNotAvailable, onRemove, onCancel, pinned, onPin, onAmount }: {
  item: ListItem;
  /** Changes how many, or the note. */
  onAmount: (patch: Pick<ListItem, 'qty' | 'note'>) => void;
  where: string;
  storeName: string;
  categoryId?: string;
  categories: { id: string; name: string }[];
  looks: Map<string, { color: string; icon: string }>;
  onCategory: (id: string | undefined) => void;
  onChangePlace: () => void;
  /** Say where it is in plain words (aisle, department…). */
  onWhere: () => void;
  onNotAvailable: () => void;
  onRemove: () => void;
  onCancel: () => void;
  /** Pulsing circle on the map for this item. */
  pinned: boolean;
  onPin: () => void;
}) {
  const qty = item.qty ?? 1;
  const [note, setNote] = useState(item.note ?? '');
  const saveNote = () => {
    const clean = note.trim();
    if (clean !== (item.note ?? '')) onAmount({ note: clean || undefined });
  };
  const close = () => { saveNote(); onCancel(); };
  return (
    <div className="sheet-backdrop" onClick={close}>
      <div className="sheet" role="dialog" aria-label={`Options for ${item.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>{item.name}</h2>
        <p className="muted small">{where}</p>
        <div className="amount-row">
          <div className="qty-stepper" role="group" aria-label="How many">
            <button className="icon" onClick={() => onAmount({ qty: qty - 1 > 1 ? qty - 1 : undefined })} disabled={qty <= 1} aria-label="One fewer">−</button>
            <span className="qty-stepper-value" aria-live="polite">{qty}</span>
            <button className="icon" onClick={() => onAmount({ qty: qty + 1 })} aria-label="One more">＋</button>
          </div>
          <input
            className="note-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            placeholder="Note (brand, size…)"
            aria-label={`Note for ${item.name}`}
          />
        </div>
        <div className="field menu-category">
          <span>Category</span>
          <CategoryPicker
            value={categoryId}
            categories={categories}
            onPick={onCategory}
            iconOf={(id) => looks.get(id)?.icon}
            noneLabel="No category"
            label={`Category of ${item.name}`}
          />
        </div>
        <button className="pick" onClick={onPin}>{pinned ? '◎ Stop showing on the map' : '◎ Show on the map'}</button>
        <button className="pick" onClick={onChangePlace}>📍 Change place on the map</button>
        <button className="pick" onClick={onWhere}>🏷 Aisle / department…</button>
        <button className="pick" onClick={onNotAvailable}>🚫 Not available at {storeName}</button>
        <button className="pick danger" onClick={onRemove}>Remove from list</button>
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
