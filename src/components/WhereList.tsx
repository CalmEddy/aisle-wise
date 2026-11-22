import type { Clue, ListItem, StoreLayout } from '../core/types';
import type { SectionLook } from '../display';
import { PlaceOnMap } from './PlaceOnMap';
import type { MapSpot } from './WhereBar';

/**
 * "Where were these?": place deferred items one at a time on the map.
 * Used at checkout (or whenever the shopper reviews what they left for later).
 */
export function WhereList({
  items,
  layout,
  look,
  mapSpotsOf,
  askAtCheckout,
  onSavePlace,
  onSaveClue,
  onDescribe,
  onSkip,
  onAskAtCheckout,
  onClose,
}: {
  items: ListItem[];
  layout: StoreLayout;
  look?: SectionLook;
  mapSpotsOf?: (item: ListItem) => MapSpot[];
  askAtCheckout: boolean;
  onSavePlace: (item: ListItem, spotKey: string) => void;
  onSaveClue: (item: ListItem, clue: Clue) => void;
  onDescribe: (item: ListItem) => void;
  onSkip: (item: ListItem) => void;
  onAskAtCheckout: (on: boolean) => void;
  onClose: () => void;
}) {
  const current = items[0];
  const rest = items.slice(1);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet where-list" role="dialog" aria-label="Where were these?" onClick={(e) => e.stopPropagation()}>
        <div className="add-sheet-head">
          <h2>Where were these?</h2>
          <button type="button" className="btn primary" onClick={onClose}>Done</button>
        </div>
        <p className="muted small">Tap the shelf or area. It builds the map so next time they’re in walking order.</p>
        {items.length === 0 && <p className="muted">All placed. Thanks!</p>}
        {current && (
          <PlaceOnMap
            key={current.id}
            embedded
            itemName={current.name}
            layout={layout}
            look={look}
            mapSpots={mapSpotsOf?.(current)}
            laterLabel="Skip"
            queueHint={rest.length ? `${rest.length} more` : undefined}
            onLater={() => onSkip(current)}
            onDescribe={() => onDescribe(current)}
            onSavePlace={(key) => onSavePlace(current, key)}
            onSaveClue={(clue) => onSaveClue(current, clue)}
          />
        )}
        {rest.length > 0 && (
          <ul className="where-list-queue" aria-label="Still to place">
            {rest.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        )}
        <label className="check where-list-mode">
          <input type="checkbox" checked={askAtCheckout} onChange={(e) => onAskAtCheckout(e.target.checked)} />
          <span>At this store, ask me here at checkout instead of as I go</span>
        </label>
      </div>
    </div>
  );
}
