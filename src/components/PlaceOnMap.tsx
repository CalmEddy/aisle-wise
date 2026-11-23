import { useState } from 'react';
import type { HereOption } from '../core/here';
import type { Clue, Place, StoreLayout } from '../core/types';
import type { SectionLook } from '../display';
import { StoreMap } from './StoreMap';
import type { MapSpot } from './WhereBar';

/**
 * Map-first "Where was it?": show the whole store and tap a shelf or area.
 * Slim shortcuts for known map spots, standing, and Describe… for rare clues.
 */
export function PlaceOnMap({
  itemName,
  layout,
  look,
  mapSpots = [],
  here,
  onHere,
  laterLabel = 'Later',
  onLater,
  onAskAtCheckout,
  onDescribe,
  onSavePlace,
  onSaveClue,
  queueHint,
  embedded,
}: {
  itemName: string;
  layout: StoreLayout;
  look?: SectionLook;
  mapSpots?: MapSpot[];
  here?: HereOption[];
  onHere?: (o: HereOption) => void;
  laterLabel?: string;
  onLater: () => void;
  onAskAtCheckout?: () => void;
  onDescribe?: () => void;
  onSavePlace: (spotKey: string) => void;
  onSaveClue?: (clue: Clue) => void;
  /** e.g. "2 more" while reviewing a queue */
  queueHint?: string;
  /** Render without the dock (nested in WhereList). */
  embedded?: boolean;
}) {
  const [standing, setStanding] = useState(false);
  const [highlightId, setHighlightId] = useState<string>();
  const spots = mapSpots.slice(0, 3);
  const hasPlaces = layout.places.length > 0;

  function pickPlace(place: Place) {
    setHighlightId(place.id);
    onSavePlace(place.id);
  }

  function tapMap(_x: number, _y: number, place: Place | undefined) {
    if (place) pickPlace(place);
  }

  const body = (
    <div
      className={`place-on-map${embedded ? ' embedded' : ''}`}
      role="dialog"
      aria-label={`Where was ${itemName}?`}
      onClick={embedded ? undefined : (e) => e.stopPropagation()}
    >
      <div className="place-on-map-head">
        <div className="place-on-map-title">
          <h2>Where was <b>{itemName}</b>?</h2>
          {queueHint && <span className="muted small">{queueHint}</span>}
        </div>
        <button type="button" className="link" onClick={onLater}>{laterLabel}</button>
      </div>

      <p className="muted small place-on-map-hint">
        {standing
          ? 'Pick what to build or save where you’re standing.'
          : hasPlaces
            ? 'Tap the shelf or area on the map.'
            : 'No shelves on the map yet — use Describe… or a shortcut below.'}
      </p>

      {standing && here && onHere ? (
        <div className="place-on-map-standing" role="group" aria-label="Where I’m standing">
          <button type="button" className="link" onClick={() => setStanding(false)} aria-label="Back">‹</button>
          {here.map((o, i) => (
            <button key={`${o.kind}-${o.label}`} type="button" className={`btn${i === 0 ? ' primary' : ''}`} onClick={() => onHere(o)}>
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          {hasPlaces && (
            <div className="place-on-map-map">
              <StoreMap
                layout={layout}
                look={look}
                highlightId={highlightId}
                onMapTap={tapMap}
              />
            </div>
          )}

          <div className="place-on-map-shortcuts" role="group" aria-label="Shortcuts">
            {spots.map((x) => (
              <button
                key={x.key}
                type="button"
                className="btn map-spot"
                title="Where the map has this kind of thing"
                onClick={() => {
                  if (x.clue && onSaveClue) onSaveClue(x.clue);
                  else if (x.spot) onSavePlace(x.spot);
                }}
              >
                📍 {x.label}
              </button>
            ))}
            {here && here.length > 0 && onHere && (
              <button type="button" className="btn" onClick={() => setStanding(true)}>
                🧍 Where I’m standing
              </button>
            )}
            {onDescribe && (
              <button type="button" className="btn" onClick={onDescribe}>Describe…</button>
            )}
            {onAskAtCheckout && (
              <button type="button" className="link place-on-map-checkout" onClick={onAskAtCheckout}>
                Ask me at checkout
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  if (embedded) return body;
  // Dock at the bottom without a blocking backdrop so the list stays tappable
  // (checking the next item off queues this one for later, same as the old bar).
  return (
    <div className="place-on-map-dock" onClick={(e) => e.stopPropagation()}>
      {body}
    </div>
  );
}
