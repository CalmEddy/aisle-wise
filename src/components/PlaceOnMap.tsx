import { useCallback, useEffect, useRef, useState } from 'react';
import { isAisleFloor } from '../core/aisles';
import { exactKey, exactSpotAt } from '../core/geometry';
import type { HereOption } from '../core/here';
import type { Clue, Place, Point, StoreLayout } from '../core/types';
import type { SectionLook } from '../display';
import { StoreMap } from './StoreMap';
import type { MapSpot } from './WhereBar';

/** Lets ShoppingView drive the main store map while this dock is open. */
export type PlaceMapController = {
  /** Place outlined with the pulsing red selection. */
  pendingId?: string;
  /** Open-floor cell selected for two-tap confirm (pulsing red). */
  pendingAt?: Point;
  /** `at` may be fractional grid coords so the confirm saves the exact tap. */
  tapPlace: (place: Place | undefined, at: Point) => void;
};

/**
 * Map-first "Where was it?": first tap selects (pulsing red), second confirms.
 * Check-off uses the main shopping map (large 🗺 view); review list keeps its own map.
 * Open floor works the same: tap once to select that square, again to save the item there.
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
  onSaveFloor,
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
  /** Confirm open-floor placement at this grid cell. */
  onSaveFloor?: (at: Point) => void;
  /** e.g. "2 more" while reviewing a queue */
  queueHint?: string;
  /** Nested in WhereList: show an in-sheet map. */
  embedded?: boolean;
  /** When set (check-off dock), register taps/selection on the main StoreMap. */
  onMapController?: (ctl: PlaceMapController | null) => void;
}) {
  const [standing, setStanding] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const [pendingAt, setPendingAt] = useState<Point>();
  const spots = mapSpots.slice(0, 3);
  const hasPlaces = layout.places.length > 0;
  const useMainMap = !embedded && !!onMapController;
  const pending = pendingId ? layout.places.find((p) => p.id === pendingId) : undefined;

  const pendingIdRef = useRef(pendingId);
  pendingIdRef.current = pendingId;
  const pendingAtRef = useRef(pendingAt);
  pendingAtRef.current = pendingAt;
  const saveRef = useRef(onSavePlace);
  saveRef.current = onSavePlace;
  const saveFloorRef = useRef(onSaveFloor);
  saveFloorRef.current = onSaveFloor;

  const sameCell = (a: Point | undefined, b: Point) => !!a && a.x === b.x && a.y === b.y;

  const tapPlace = useCallback((place: Place | undefined, at: Point) => {
    const cell = { x: Math.floor(at.x), y: Math.floor(at.y) };
    if (place) {
      setPendingAt(undefined);
      if (pendingIdRef.current === place.id) {
        // Exact spot under the tap (fractions allowed) so the pin matches where they tapped.
        saveRef.current(exactKey(place.id, exactSpotAt(place, at.x, at.y)));
        setPendingId(undefined);
        return;
      }
      setPendingId(place.id);
      return;
    }
    // Aisle / walkway: caller moves you there; do not treat as open floor.
    if (isAisleFloor(layout, cell)) {
      setPendingId(undefined);
      setPendingAt(undefined);
      return;
    }
    // Open floor: first tap selects the square; second confirms and saves there.
    setPendingId(undefined);
    if (sameCell(pendingAtRef.current, cell)) {
      saveFloorRef.current?.(cell);
      setPendingAt(undefined);
      return;
    }
    setPendingAt(cell);
  }, [layout]);

  useEffect(() => {
    setPendingId(undefined);
    setPendingAt(undefined);
    setStanding(false);
  }, [itemName]);

  useEffect(() => {
    if (!useMainMap || !onMapController) return;
    onMapController({ pendingId, pendingAt, tapPlace });
    return () => onMapController(null);
  }, [useMainMap, onMapController, pendingId, pendingAt, tapPlace]);

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
            ? 'No shelves on the map yet — tap the floor twice to place here, or use Describe…'
            : pending
              ? <>Selected <b>{pending.label || 'this place'}</b> — tap again to confirm.</>
              : pendingAt
                ? 'Selected this spot — tap again to save it here.'
                : useMainMap
                  ? 'Tap a shelf, area, or open floor on the map above, then tap again to confirm.'
                  : 'Tap a shelf, area, or open floor, then tap again to confirm.'}
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
                pendingId={pendingId}
                pendingAt={pendingAt}
                onMapTap={(x, y, place) => tapPlace(place, { x, y })}
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
