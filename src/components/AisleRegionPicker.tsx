import type { AislePos, AisleSide, Clue, Temp } from '../core/types';

/** One cell of the bird’s-eye aisle: top = back of store. */
export type AisleRegion = 'TL' | 'TR' | 'ML' | 'MR' | 'BL' | 'BR';

const REGION: Record<AisleRegion, { side: AisleSide; pos: AislePos; label: string }> = {
  TL: { side: 'L', pos: 'back', label: 'Top left · back, left' },
  TR: { side: 'R', pos: 'back', label: 'Top right · back, right' },
  ML: { side: 'L', pos: 'middle', label: 'Middle left' },
  MR: { side: 'R', pos: 'middle', label: 'Middle right' },
  BL: { side: 'L', pos: 'front', label: 'Bottom left · front, left' },
  BR: { side: 'R', pos: 'front', label: 'Bottom right · front, right' },
};

/** Map a region tap to an aisle clue (always includes side and pos). */
export function aisleClueFromRegion(aisle: string, region: AisleRegion, temp?: Temp): Clue {
  const { side, pos } = REGION[region];
  return { kind: 'aisle', aisle: aisle.trim(), side, pos, ...(temp && { temp }) };
}

export function regionOf(side?: AisleSide, pos?: AislePos): AisleRegion | undefined {
  if (!side || !pos) return undefined;
  const entry = (Object.entries(REGION) as [AisleRegion, typeof REGION[AisleRegion]][])
    .find(([, v]) => v.side === side && v.pos === pos);
  return entry?.[0];
}

/**
 * Bird’s-eye aisle: six shelf regions around a selectable aisle number.
 * Top of the grid is the back of the store; left/right as you walk in from the front.
 * Tapping a region assigns the location immediately.
 */
export function AisleRegionPicker({ aisle, recentAisles = [], onAisleChange, temp, onPick, disabled }: {
  aisle: string;
  recentAisles?: string[];
  onAisleChange: (aisle: string) => void;
  temp?: Temp;
  onPick: (clue: Clue) => void;
  /** When true, region taps do nothing (e.g. no aisle number yet). */
  disabled?: boolean;
}) {
  const ok = aisle.trim().length > 0 && !disabled;
  const cell = (region: AisleRegion) => {
    const { label } = REGION[region];
    return (
      <button
        type="button"
        className="aisle-region"
        aria-label={ok ? `Aisle ${aisle.trim()}, ${label}` : label}
        disabled={!ok}
        onClick={() => ok && onPick(aisleClueFromRegion(aisle, region, temp))}
      >
        <span className="aisle-region-code" aria-hidden="true">{region}</span>
      </button>
    );
  };

  return (
    <div className="aisle-region-picker" role="group" aria-label="Aisle regions">
      <div className="aisle-region-grid">
        {cell('TL')}
        <div className="aisle-region-center" aria-hidden="true" />
        {cell('TR')}
        {cell('ML')}
        <div className="aisle-region-number">
          <span className="aisle-region-number-label">Aisle</span>
          <input
            className="where-num aisle-region-input"
            value={aisle}
            onChange={(e) => onAisleChange(e.target.value.slice(0, 8))}
            inputMode="text"
            placeholder="#"
            aria-label="Aisle number"
          />
          {recentAisles.length > 0 && (
            <div className="aisle-region-recents" role="group" aria-label="Recent aisles">
              {recentAisles.slice(0, 6).map((a) => (
                <button key={a} type="button" className={`chip mini${aisle === a ? ' active' : ''}`}
                  onClick={() => onAisleChange(a)}>{a}</button>
              ))}
            </div>
          )}
        </div>
        {cell('MR')}
        {cell('BL')}
        <div className="aisle-region-center" aria-hidden="true" />
        {cell('BR')}
      </div>
      <p className="muted small where-note">Back of store ↑ · tap a region · left/right as you walk in from the front</p>
    </div>
  );
}
