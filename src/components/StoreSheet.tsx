import { useState } from 'react';
import { TemplatePicker } from './TemplatePicker';
import { formatPrice } from '../core/items';
import { cheapestStoreTotal, type StoreListTotal } from '../core/prices';
import { AT_STORE_METRES, distanceText, storesByDistance } from '../core/stores';
import type { GeoPoint, StoreLayout } from '../core/types';

/**
 * Picking a store: nearest first (when we know where you are), a new store
 * right where you're standing, or saving where the current store is so it's
 * picked automatically next time. Optional list-price estimates per store.
 */
export function StoreSheet({ layouts, activeId, here, locating, listTotals, onPick, onNew, onSaveHere, onClose }: {
  layouts: StoreLayout[];
  activeId: string;
  /** Where you are, if known. */
  here?: GeoPoint;
  /** 'finding' while asking the phone; 'off' if location isn't available. */
  locating: 'finding' | 'off' | 'ok';
  /** Estimated list cost per store (from remembered product prices). */
  listTotals?: StoreListTotal[];
  onPick: (id: string) => void;
  /** A new store: its name, the default map it starts from ('blank': just the door and checkout) and how many aisles. */
  onNew: (name: string, templateId: string, aisles?: number) => void;
  onSaveHere: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  /** Naming a new store: then choosing what it starts as. */
  const [naming, setNaming] = useState<string>();
  if (naming !== undefined) {
    return <TemplatePicker name={naming} onCreate={(id, aisles) => onNew(naming, id, aisles)} onBack={() => setNaming(undefined)} onClose={onClose} />;
  }
  const rows = storesByDistance(layouts, here);
  const active = layouts.find((l) => l.id === activeId);
  const activeHere = here && active?.geo && rows.find((r) => r.layout.id === activeId)?.metres;
  const byId = new Map((listTotals ?? []).map((t) => [t.layoutId, t]));
  const best = listTotals ? cheapestStoreTotal(listTotals) : undefined;
  const showPrices = !!listTotals && listTotals.some((t) => t.itemCount > 0 && t.missingCount < t.itemCount);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet store-sheet" role="dialog" aria-label="Stores" onClick={(e) => e.stopPropagation()}>
        <h2>Which store?</h2>
        <p className="muted small">
          {locating === 'finding' ? 'Finding where you are…' : locating === 'off' ? 'Location is off, so stores are in your order.' : 'Nearest first.'}
          {showPrices ? ' List totals use remembered prices.' : ''}
        </p>
        <ul className="store-list">
          {rows.map(({ layout, metres }) => {
            const total = byId.get(layout.id);
            const isCheapest = best && total && best.layoutId === layout.id;
            return (
              <li key={layout.id}>
                <button className={`store-row-btn${layout.id === activeId ? ' current' : ''}${isCheapest ? ' cheapest' : ''}`} onClick={() => { onPick(layout.id); onClose(); }} aria-current={layout.id === activeId}>
                  <span className="radio" aria-hidden="true">{layout.id === activeId ? '●' : '○'}</span>
                  <span className="store-row-main">
                    <span className="name">{layout.name}{isCheapest ? ' · best price' : ''}</span>
                    <span className="muted small">
                      {metres !== undefined ? (metres <= AT_STORE_METRES ? 'You’re here' : distanceText(metres)) : layout.geo ? '' : 'no location'}
                      {total && total.itemCount > 0 && (
                        <>
                          {(metres !== undefined || layout.geo) ? ' · ' : ''}
                          {total.missingCount < total.itemCount
                            ? `${formatPrice(total.knownTotal) ?? `$${total.knownTotal}`}${total.missingCount ? ` · ${total.missingCount} no price` : ''}`
                            : 'no prices yet'}
                        </>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <form className="add-row new-store" onSubmit={(e) => { e.preventDefault(); setNaming(name.trim() || 'New store'); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New store, e.g. Kroger Main St" aria-label="New store name" />
          <button type="submit">＋ Here</button>
        </form>
        <p className="muted small">Next, start from a typical supermarket layout (you can change that). It learns where things are as you shop{here ? ', and remembers where it is' : ''}.</p>

        {here && active && (activeHere === undefined || activeHere > AT_STORE_METRES) && (
          <button className="btn wide" onClick={() => { onSaveHere(); onClose(); }}>📍 I’m at {active.name} – remember it’s here</button>
        )}
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
