import { useCallback, useEffect, useRef, useState } from 'react';
import type { HereOption } from '../core/here';
import type { Clue, Place, StoreLayout } from '../core/types';
import type { SectionLook } from '../display';
import { StoreMap } from './StoreMap';
import type { MapSpot } from './WhereBar';

/** Lets ShoppingView drive the main store map while this dock is open. */
export type PlaceMapController = {
  highlightId?: string;
  tapPlace: (place: Place | undefined) => void;
};

/**
 * Map-first "Where was it?": tap a shelf/area to select, tap again to confirm.
 * Non-embedded mode uses the main shopping map (same as 🗺 whole map);
 * embedded mode (review list) keeps its own map.
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
  onMapController,
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
  /** Nested in WhereList: show an in-sheet map. */
  embedded?: boolean;
  /** When set (check-off dock), register taps/highlight on the main StoreMap. */
  onMapController?: (ctl: PlaceMapController | null) => void;
}) {
  const [standing, setStanding] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const spots = mapSpots.slice(0, 3);
  const hasPlaces = layout.places.length > 0;
  const useMainMap = !embedded && !!onMapController;
  const pending = pendingId ? layout.places.find((p) => p.id === pendingId) : undefined;

  const pendingRef = useRef(pendingId);
  pendingRef.current = pendingId;
  const saveRef = useRef(onSavePlace);
  saveRef.current = onSavePlace;

  const tapPlace = useCallback((place: Place | undefined) => {
    if (!place) {
      setPendingId(undefined);
      return;
    }
    if (pendingRef.current === place.id) {
      saveRef.current(place.id);
      setPendingId(undefined);
      return;
    }
    setPendingId(place.id);
  }, []);

  useEffect(() => {
    setPendingId(undefined);
    setStanding(false);
  }, [itemName]);

  useEffect(() => {
    if (!useMainMap || !onMapController) return;
    onMapController({ highlightId: pendingId, tapPlace });
    return () => onMapController(null);
  }, [useMainMap, onMapController, pendingId, tapPlace]);

  const body = (
    <div
      className={`place-on-map${embedded ? ' embedded' : ''}${useMainMap ? ' main-map' : ''}`}
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
          : !hasPlaces
            ? 'No shelves on the map yet — use Describe… or a shortcut below.'
            : pending
              ? <>Selected <b>{pending.label || 'this place'}</b> — tap again to confirm.</>
              : useMainMap
                ? 'Tap a shelf or area on the map above, then tap again to confirm.'
                : 'Tap a shelf or area, then tap again to confirm.'}
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
          {hasPlaces && !useMainMap && (
            <div className="place-on-map-map">
              <StoreMap
                layout={layout}
                look={look}
                highlightId={pendingId}
                onMapTap={(_x, _y, place) => tapPlace(place)}
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
  return (
    <div className="place-on-map-dock" onClick={(e) => e.stopPropagation()}>
      {body}
    </div>
  );
}
