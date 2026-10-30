import type { Clue, ListItem } from '../core/types';
import { WhereBar } from './WhereBar';

/**
 * "Where were these?": everything waiting to be placed, in one list, each
 * with the quick bar's one-tap answers. Used at checkout (or whenever the
 * shopper reviews what they left for later).
 */
export function WhereList({ items, categoryOf, recentAisles, lastClue, trail, askAtCheckout, onSave, onOther, onSkip, onAskAtCheckout, onClose }: {
  items: ListItem[];
  categoryOf: (item: ListItem) => string | undefined;
  recentAisles: string[];
  lastClue?: Clue;
  trail: string[];
  /** This store asks at checkout instead of at each check-off. */
  askAtCheckout: boolean;
  onSave: (item: ListItem, clue: Clue) => void;
  onOther: (item: ListItem) => void;
  /** Not now: drop it from the list. */
  onSkip: (item: ListItem) => void;
  onAskAtCheckout: (on: boolean) => void;
  onClose: () => void;
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet where-list" role="dialog" aria-label="Where were these?" onClick={(e) => e.stopPropagation()}>
        <div className="add-sheet-head">
          <h2>Where were these?</h2>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
        <p className="muted small">One tap each. It builds the map, so next time they’re in walking order.</p>
        {items.length === 0 && <p className="muted">All placed. Thanks!</p>}
        {items.map((item) => (
          <WhereBar
            key={item.id}
            itemName={item.name}
            categoryId={categoryOf(item)}
            recentAisles={recentAisles}
            lastClue={lastClue}
            trail={trail}
            laterLabel="Skip"
            onSave={(clue) => onSave(item, clue)}
            onOther={() => onOther(item)}
            onLater={() => onSkip(item)}
          />
        ))}
        <label className="check where-list-mode">
          <input type="checkbox" checked={askAtCheckout} onChange={(e) => onAskAtCheckout(e.target.checked)} />
          <span>At this store, ask me here at checkout instead of as I go</span>
        </label>
      </div>
    </div>
  );
}
