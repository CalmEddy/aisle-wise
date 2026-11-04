import { useState } from 'react';
import type { ItemUnit, ListItem, ShoppingList } from '../core/types';
import { ITEM_UNITS } from '../core/types';
import { formatPrice, parsePrice } from '../core/items';
import { CategoryPicker } from './CategoryPicker';

export function ItemMenu({ item, where, storeName, categoryId, categories, looks, lists, currentList, onCategory, onChangePlace, onWhere, onNotAvailable, onRemove, onMoveTo, onCopyTo, onCancel, pinned, onPin, onAmount }: {
  item: ListItem;
  /** Changes how many, unit, price, note, or the display name. */
  onAmount: (patch: Partial<Pick<ListItem, 'qty' | 'note' | 'name' | 'unit' | 'price'>>) => void;
  where: string;
  storeName: string;
  categoryId?: string;
  categories: { id: string; name: string }[];
  looks: Map<string, { color: string; icon: string }>;
  /** Other lists to move/copy onto (excludes the item's current list). */
  lists: ShoppingList[];
  currentList: string;
  onCategory: (id: string | undefined) => void;
  onChangePlace: () => void;
  /** Say where it is in plain words (aisle, department…). */
  onWhere: () => void;
  onNotAvailable: () => void;
  onRemove: () => void;
  onMoveTo: (listId: string) => void;
  onCopyTo: (listId: string) => void;
  onCancel: () => void;
  /** Pulsing circle on the map for this item. */
  pinned: boolean;
  onPin: () => void;
}) {
  const qty = item.qty ?? 1;
  const [note, setNote] = useState(item.note ?? '');
  const [priceText, setPriceText] = useState(item.price !== undefined ? String(item.price) : '');
  const [transfer, setTransfer] = useState<'move' | 'copy'>();
  const others = lists.filter((l) => l.id !== currentList);
  const saveNote = () => {
    const clean = note.trim();
    if (clean !== (item.note ?? '')) onAmount({ note: clean || undefined });
  };
  const savePrice = () => {
    const next = parsePrice(priceText);
    if (next !== item.price) onAmount({ price: next });
    setPriceText(next !== undefined ? String(next) : '');
  };
  const close = () => { saveNote(); savePrice(); onCancel(); };
  const setUnit = (unit: ItemUnit | '') => {
    onAmount({ unit: unit || undefined });
  };
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
          <label className="unit-field">
            <span className="muted small">Unit</span>
            <select
              value={item.unit ?? 'each'}
              aria-label={`Unit for ${item.name}`}
              onChange={(e) => setUnit(e.target.value as ItemUnit)}
            >
              {ITEM_UNITS.map((u) => (
                <option key={u.id} value={u.id}>{u.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="amount-row price-row">
          <label className="price-field">
            <span className="muted small">Price{item.unit && item.unit !== 'each' ? ` / ${ITEM_UNITS.find((u) => u.id === item.unit)?.label.toLowerCase()}` : ''}</span>
            <input
              className="price-input"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              onBlur={savePrice}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              placeholder="$0.00"
              aria-label={`Price for ${item.name}`}
            />
          </label>
          {item.price !== undefined && (
            <span className="muted small price-preview" title={qty > 1 ? `${qty} × ${formatPrice(item.price)}` : undefined}>
              {formatPrice(qty > 1 ? item.price * qty : item.price)}
              {qty > 1 ? ' total' : ''}
            </span>
          )}
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
        {others.length > 0 && !transfer && (
          <>
            <button className="pick" onClick={() => setTransfer('move')}>↗ Move to another list…</button>
            <button className="pick" onClick={() => setTransfer('copy')}>⧉ Copy to another list…</button>
          </>
        )}
        {transfer && (
          <div className="transfer-lists" role="group" aria-label={transfer === 'move' ? 'Move to list' : 'Copy to list'}>
            <p className="muted small">{transfer === 'move' ? 'Move to:' : 'Copy to:'}</p>
            {others.map((l) => (
              <button key={l.id} className="pick" onClick={() => (transfer === 'move' ? onMoveTo(l.id) : onCopyTo(l.id))}>
                {l.name}
              </button>
            ))}
            <button className="pick" onClick={() => setTransfer(undefined)}>Cancel</button>
          </div>
        )}
        <button className="pick danger" onClick={onRemove}>Remove from list</button>
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
