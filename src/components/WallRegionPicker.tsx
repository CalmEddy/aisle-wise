import type { Clue, Temp, Wall, WallPart } from '../core/types';

/** A tappable segment on the store’s wall outline (top = back of store). */
export type WallSegment =
  | { wall: 'back'; part: 'left' | 'middle' | 'right' }
  | { wall: 'left'; part: 'back' | 'middle' | 'front' }
  | { wall: 'right'; part: 'back' | 'middle' | 'front' };

const BACK: { part: 'left' | 'middle' | 'right'; label: string }[] = [
  { part: 'left', label: 'Back wall · left' },
  { part: 'middle', label: 'Back wall · middle' },
  { part: 'right', label: 'Back wall · right' },
];

/** Side walls: top of the picker = back of store (stored as part `back`). */
const SIDE: { part: 'back' | 'middle' | 'front'; label: string; shown: string }[] = [
  { part: 'back', label: 'top · by the back', shown: 'TOP' },
  { part: 'middle', label: 'middle', shown: 'MID' },
  { part: 'front', label: 'bottom · by the front', shown: 'BOT' },
];

export function wallClueFromSegment(seg: WallSegment, temp?: Temp): Clue {
  return { kind: 'wall', wall: seg.wall, part: seg.part, ...(temp && { temp }) };
}

/**
 * Visual U-outline of the store walls. Tap a segment to assign the location.
 * Left/right as you face into the store from the entrance; top = back wall.
 */
export function WallRegionPicker({ temp, onPick, current }: {
  temp?: Temp;
  onPick: (clue: Clue) => void;
  /** Highlight a previously chosen wall segment, if any. */
  current?: { wall: Wall; part?: WallPart };
}) {
  const active = (wall: Wall, part: WallPart) =>
    current?.wall === wall && current.part === part ? ' active' : '';

  const backCell = (part: 'left' | 'middle' | 'right', label: string) => (
    <button
      type="button"
      key={`back-${part}`}
      className={`wall-region wall-region-back${active('back', part)}`}
      aria-label={label}
      onClick={() => onPick(wallClueFromSegment({ wall: 'back', part }, temp))}
    >
      {part === 'left' ? 'LEFT' : part === 'right' ? 'RIGHT' : 'MIDDLE'}
    </button>
  );

  const sideCol = (wall: 'left' | 'right') => (
    <div className={`wall-region-side wall-region-${wall}`} role="group" aria-label={`${wall} wall`}>
      {SIDE.map(({ part, label, shown }) => (
        <button
          type="button"
          key={`${wall}-${part}`}
          className={`wall-region${active(wall, part)}`}
          aria-label={`${wall === 'left' ? 'Left' : 'Right'} wall · ${label}`}
          onClick={() => onPick(wallClueFromSegment({ wall, part }, temp))}
        >
          {shown}
        </button>
      ))}
    </div>
  );

  return (
    <div className="wall-region-picker" role="group" aria-label="Wall regions">
      <div className="wall-region-label">BACK WALL</div>
      <div className="wall-region-back-row">
        {BACK.map((b) => backCell(b.part, b.label))}
      </div>
      <div className="wall-region-body">
        {sideCol('left')}
        <div className="wall-region-floor" aria-hidden="true">
          <span className="muted small">aisles</span>
        </div>
        {sideCol('right')}
      </div>
      <p className="muted small where-note">Back of store ↑ · left / right as you face in from the entrance</p>
    </div>
  );
}
