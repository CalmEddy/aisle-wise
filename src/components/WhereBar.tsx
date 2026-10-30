import { useState } from 'react';
import { aisleNumber, DEPTS, describeClue, guessDept } from '../core/clues';
import type { Clue, Temp, Wall } from '../core/types';

/** Cold or not, as a first guess from the category. */
export function guessTemp(categoryId?: string): Temp | undefined {
  if (categoryId === 'frozen' || categoryId === 'icecream') return 'frozen';
  if (categoryId === 'dairy' || categoryId === 'eggs') return 'chilled';
  return undefined;
}

/**
 * The aisles you're most likely in next: the one you're in, then the next
 * ones in the direction you've been going (3 then 5 → 5, 7, 9), then the
 * one behind you.
 */
export function nextAisles(trail: string[]): string[] {
  const nums = trail.map((a) => Math.floor(aisleNumber(a))).filter((n) => !Number.isNaN(n));
  if (!nums.length) return [];
  const last = nums[nums.length - 1];
  const prev = nums.length > 1 ? nums[nums.length - 2] : undefined;
  const step = prev === undefined || prev === last ? 1 : Math.max(-2, Math.min(2, last - prev));
  const out = [last, last + step, last + 2 * step, last - Math.sign(step)].filter((n) => n > 0);
  return [...new Set(out)].map(String);
}

const WALLS: { wall: Wall; label: string }[] = [
  { wall: 'left', label: '← Left wall' },
  { wall: 'back', label: '↑ Back wall' },
  { wall: 'right', label: 'Right wall →' },
];

/**
 * The quick "Where was it?" asked at check-off: a bar at the bottom that
 * doesn't block the list. The likely answers are one tap: the department,
 * the aisles you're probably in next, a wall; "# Aisle" types a number on
 * buttons right here; "Other…" opens the full panel; ignoring it (checking
 * the next thing off) asks later.
 */
export function WhereBar({ itemName, categoryId, recentAisles, lastClue, trail = [], onSave, onOther, onLater }: {
  itemName: string;
  categoryId?: string;
  recentAisles: string[];
  lastClue?: Clue;
  /** Aisle numbers answered this trip, in order. */
  trail?: string[];
  onSave: (clue: Clue) => void;
  onOther: () => void;
  onLater: () => void;
}) {
  const [temp, setTemp] = useState<Temp | undefined>(guessTemp(categoryId));
  const [typing, setTyping] = useState<string>();
  const dept = guessDept(categoryId);
  const d = dept && DEPTS.find((x) => x.id === dept);
  const cold = temp === 'frozen' ? '❄ ' : temp === 'chilled' ? '🧊 ' : '';
  const withTemp = temp ? { temp } : {};
  const aisleClue = (aisle: string): Clue => ({ kind: 'aisle', aisle, ...withTemp });

  const quick: { key: string; label: string; clue: Clue; primary?: boolean }[] = [];
  const predicted = nextAisles(trail);
  const aisles = [...predicted, ...recentAisles.filter((a) => !predicted.includes(a)).slice(0, Math.max(0, 3 - predicted.length))];
  const aisleChips = aisles.map((a, i) => ({ key: `a-${a}`, label: `${cold}Aisle ${a}`, clue: aisleClue(a), primary: !d && i === 0 }));
  const wallChips = (d || temp) ? WALLS.map((w) => ({ key: `w-${w.wall}`, label: `${cold}${w.label}`, clue: { kind: 'wall', wall: w.wall, ...withTemp } as Clue })) : [];
  if (d) quick.push({ key: `d-${d.id}`, label: `${d.icon} ${d.name}`, clue: { kind: 'dept', dept: d.id }, primary: true });
  if (d) quick.push(...wallChips, ...aisleChips);
  else quick.push(...aisleChips, ...wallChips);
  const lastIsListed = lastClue && quick.some((q) => describeClue(q.clue) === describeClue(lastClue));
  if (lastClue && !lastIsListed) quick.push({ key: 'last', label: `Same as last: ${describeClue(lastClue)}`, clue: lastClue });

  return (
    <div className="where-bar" role="group" aria-label={`Where was ${itemName}?`}>
      <div className="where-bar-head">
        <span>Where was <b>{itemName}</b>?</span>
        <span className="where-bar-temp" role="group" aria-label="Kept">
          {([undefined, 'chilled', 'frozen'] as const).map((t) => (
            <button key={String(t)} className={`chip mini${temp === t ? ' active' : ''}`} aria-pressed={temp === t}
              aria-label={t === undefined ? 'On a shelf' : t === 'chilled' ? 'In a fridge' : 'In a freezer'} onClick={() => setTemp(t)}>
              {t === undefined ? 'Shelf' : t === 'chilled' ? '🧊' : '❄'}
            </button>
          ))}
        </span>
        <button className="link" onClick={onLater}>Later</button>
      </div>
      {typing === undefined ? (
        <div className="where-bar-choices">
          {quick.map((q) => (
            <button key={q.key} className={`btn${q.primary ? ' primary' : ''}`} onClick={() => onSave(q.clue)}>{q.label}</button>
          ))}
          <button className="btn" onClick={() => setTyping('')}># Aisle…</button>
          <button className="btn" onClick={onOther}>Other…</button>
        </div>
      ) : (
        <div className="where-bar-pad" role="group" aria-label="Aisle number">
          <div className="where-bar-pad-head">
            <button className="link" onClick={() => setTyping(undefined)} aria-label="Back">‹</button>
            <span className="where-bar-pad-value" aria-live="polite">{cold}Aisle <b>{typing || '_'}</b></span>
            <button className="btn primary" disabled={!typing} onClick={() => typing && onSave(aisleClue(typing))}>Save</button>
          </div>
          <div className="where-bar-keys">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((k) => (
              <button key={k} className="btn key" onClick={() => setTyping((v) => ((v ?? '') + k).replace(/^0+/, '').slice(0, 3))}>{k}</button>
            ))}
            {['A', 'B'].map((k) => (
              <button key={k} className="btn key" disabled={!typing || /[A-Z]$/.test(typing)} onClick={() => setTyping((v) => `${v}${k}`)}>{k}</button>
            ))}
            <button className="btn key" aria-label="Delete" disabled={!typing} onClick={() => setTyping((v) => (v ?? '').slice(0, -1))}>⌫</button>
          </div>
        </div>
      )}
    </div>
  );
}
