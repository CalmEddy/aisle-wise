import { useState, type ReactNode } from 'react';
import type { Catalog } from '../core/catalog';
import { exactKey, exactSpotAt, footprint, parseExactKey } from '../core/geometry';
import { resolveSpot } from '../core/locate';
import type { Place, StoreLayout } from '../core/types';
import type { SectionLook } from '../display';
import { StoreMap } from './StoreMap';

/**
 * Choose where something is: tap a place on the store map to zoom in, then
 * tap the exact spot. In an aisle, tapping nearer a shelf picks that side.
 */
export function SpotPicker({ title, layout, catalog, current, hereKey, onPick, onCancel, extraActions, look }: {
  title: string;
  look?: SectionLook;
  layout: StoreLayout;
  catalog: Catalog;
  /** Saved spot key, if any. */
  current?: string;
  /** Where the shopper is standing, offered as a shortcut. */
  hereKey?: string;
  onPick: (key: string) => void;
  onCancel: () => void;
  extraActions?: ReactNode;
}) {
  const startPlace = current ? layout.places.find((p) => p.id === current.split(/[:@]/)[0]) : undefined;
  const [focus, setFocus] = useState<Place | undefined>(startPlace);
  const [chosen, setChosen] = useState<string | undefined>(current && resolveSpot(current, layout, catalog) ? current : undefined);
  const spot = chosen ? resolveSpot(chosen, layout, catalog) : undefined;

  function tap(x: number, y: number, place: Place | undefined) {
    if (!place) return;
    if (!focus || place.id !== focus.id) setFocus(place);
    setChosen(exactKey(place.id, exactSpotAt(place, x, y)));
  }

  const label = (key: string) => resolveSpot(key, layout, catalog)?.label ?? key;
  const option = (key: string, text: ReactNode) => (
    <button key={key} className={key === chosen ? 'pick active' : 'pick'} onClick={() => onPick(key)}>{text}</button>
  );
  const isExact = !!(chosen && parseExactKey(chosen));

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet spot-picker" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted small">
          {focus
            ? <>Tap the exact spot in <b>{focus.label || 'this place'}</b>.{focus.kind === 'aisle' && ' Tap nearer a shelf to pick that side.'}</>
            : <>At {layout.name}. Tap the aisle or area on the map.</>}
        </p>

        <StoreMap
          layout={layout}
          focus={focus ? footprint(focus) : undefined}
          highlightId={focus?.id}
          preview={spot?.mark}
          look={look}
          onMapTap={tap}
        />

        <div className="spot-choice">
          {spot ? <span>📍 <b>{spot.label}</b></span> : <span className="muted">Nothing chosen yet</span>}
          {focus && <button className="link" onClick={() => setFocus(undefined)}>Whole store</button>}
        </div>
        <div className="sheet-actions">
          {focus && (
            <button className="btn" onClick={() => onPick(focus.id)}>Anywhere in {focus.label || 'here'}</button>
          )}
          <span style={{ flex: 1 }} />
          <button className="btn primary" disabled={!chosen || !isExact && chosen === current} onClick={() => chosen && onPick(chosen)}>
            Save this spot
          </button>
        </div>

        {hereKey && option(hereKey, <>📍 Where I am · {label(hereKey)}</>)}
        <details className="pick-more">
          <summary>Or choose from a list</summary>
          {layout.places.map((p) => (
            <div key={p.id} className="pick-group">
              {option(p.id, p.label || 'Unnamed')}
              {p.categories.length > 1 && p.categories.map((cid) => option(`${p.id}:${cid}`, (
                <span className="sub">{catalog.categoryById.get(cid)?.name ?? cid}</span>
              )))}
            </div>
          ))}
        </details>

        <div className="sheet-actions">
          {extraActions}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
