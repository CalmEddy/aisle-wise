import { useMemo, useState } from 'react';
import { placementOptions, subjectPlaces, type PlacementSubject } from '../core/placement';
import type { Placement, Product, StoreLayout } from '../core/types';
import type { SectionLook } from '../display';
import { StoreMap, type MapGhost } from './StoreMap';

/**
 * "Where's the Bakery?": a mini-map with the spots it could go, numbered.
 * Tapping one shows the whole map with it there (outlined); "Place here"
 * keeps it. Shown at the bottom like the quick "Where was it?" bar.
 */
export function PlacementCard({ layout, products, subject, look, onPlace, onNotSure, onLater }: {
  layout: StoreLayout;
  products: Product[];
  subject: PlacementSubject;
  look?: SectionLook;
  onPlace: (placement: Placement, label: string) => void;
  onNotSure: () => void;
  onLater: () => void;
}) {
  const options = useMemo(() => placementOptions(layout, products, subject), [layout, products, subject]);
  const [chosen, setChosen] = useState<number>();
  const pick = chosen !== undefined ? options[chosen] : undefined;
  // The map as it is, without the thing being placed, and a numbered marker on each spot.
  const without = useMemo(() => {
    const mine = new Set(subjectPlaces(layout, subject).map((p) => p.id));
    return { ...layout, places: layout.places.filter((p) => !mine.has(p.id)) };
  }, [layout, subject]);
  const ghosts: MapGhost[] = options.map((o, i) => ({
    rect: { x: o.ghost.x + o.ghost.w / 2 - 1.1, y: o.ghost.y + o.ghost.h / 2 - 1.1, w: 2.2, h: 2.2 },
    kind: 'next', label: String(i + 1), onTap: () => setChosen(i),
  }));

  return (
    <div className="placement-card" role="group" aria-label={`Where’s ${subject.name}?`}>
      <div className="where-bar-head">
        <span>{pick ? <>Like this? <b>{subject.name}</b>: {pick.label}</> : <>Where’s <b>{subject.name}</b>? Tap a spot.</>}</span>
        <button className="link" onClick={onLater}>Later</button>
      </div>
      <div className="placement-map">
        {pick
          ? <StoreMap layout={pick.preview} look={look} changedIds={subjectPlaces(pick.preview, subject).map((p) => p.id)} />
          : <StoreMap layout={without} look={look} ghosts={ghosts} />}
      </div>
      {pick ? (
        <div className="where-bar-choices">
          <button className="btn primary" onClick={() => onPlace(pick.placement, pick.label)}>Place here</button>
          <button className="btn" onClick={() => setChosen(undefined)}>‹ Back</button>
        </div>
      ) : (
        <>
          <div className="placement-options">
            {options.map((o, i) => (
              <button key={o.label} className="chip" onClick={() => setChosen(i)}><b>{i + 1}</b> {o.label}</button>
            ))}
          </div>
          <button className="link" onClick={onNotSure}>Not sure – leave it where the map guessed</button>
        </>
      )}
    </div>
  );
}
