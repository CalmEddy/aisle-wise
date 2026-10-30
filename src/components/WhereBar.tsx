import { useState } from 'react';
import { aisleNumber, DEPTS, describeClue, guessDept } from '../core/clues';
import type { Clue, Temp, Wall } from '../core/types';
import { formatLabel, looksLikeShelfCode, nextShelves, parseLabel, type LabelStyle } from '../core/labels';

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
export function WhereBar({ itemName, categoryId, recentAisles, lastClue, trail = [], labels, shelfTrail = [], sections = [], onNeedLabels, laterLabel = 'Later', onAskAtCheckout, onSave, onOther, onLater }: {
  itemName: string;
  categoryId?: string;
  recentAisles: string[];
  lastClue?: Clue;
  /** Aisle numbers answered this trip, in order. */
  trail?: string[];
  /** How this store labels its shelves ("B12"), if not by aisle number. */
  labels?: LabelStyle;
  /** Shelves answered this trip, in order. */
  shelfTrail?: { section: string; shelf?: number }[];
  /** Sections this store has (for one-tap section keys). */
  sections?: string[];
  /** A shelf label was typed but the store's style isn't set up: set it up from this example. */
  onNeedLabels?: (code: string) => void;
  /** The "not now" link's text. */
  laterLabel?: string;
  /** Offer "ask me at checkout" (stop asking as you go at this store). */
  onAskAtCheckout?: () => void;
  onSave: (clue: Clue) => void;
  onOther: () => void;
  onLater: () => void;
}) {
  const [temp, setTemp] = useState<Temp | undefined>(guessTemp(categoryId));
  const [typing, setTyping] = useState<string>();
  const [letters, setLetters] = useState(false);
  const dept = guessDept(categoryId);
  const d = dept && DEPTS.find((x) => x.id === dept);
  const cold = temp === 'frozen' ? '❄ ' : temp === 'chilled' ? '🧊 ' : '';
  const withTemp = temp ? { temp } : {};
  const aisleClue = (aisle: string): Clue => ({ kind: 'aisle', aisle, ...withTemp });
  const shelfClue = (code: string): Clue | undefined => {
    const r = labels && parseLabel(labels, code);
    return r ? { kind: 'shelf', code: code.trim().toUpperCase(), section: r.section, ...(r.shelf !== undefined && { shelf: r.shelf }), ...withTemp } : undefined;
  };
  /** Saves what was typed on the buttons: a shelf label, an aisle, or (a label in a store not set up for them) set up labels first. */
  function saveTyped(v: string) {
    const shelf = shelfClue(v);
    if (shelf) onSave(shelf);
    else if (looksLikeShelfCode(v) && onNeedLabels) onNeedLabels(v.trim().toUpperCase());
    else onSave(aisleClue(v));
  }
  // Sections to offer as one-tap keys: the ones answered this trip first, then the rest of the store's.
  // Plus the letters either side of them (a new section is usually next door: A or C after B).
  const known = [...new Set([...shelfTrail.map((x) => x.section).reverse(), ...sections])];
  const nextDoor = known.filter((x) => /^[A-Z]$/.test(x)).flatMap((x) => [x.charCodeAt(0) - 1, x.charCodeAt(0) + 1])
    .filter((c) => c >= 65 && c <= 90).map((c) => String.fromCharCode(c));
  const knownSections = [...new Set([...known, ...nextDoor])].sort((a, b) => a.localeCompare(b)).slice(0, 8);
  const shelfChips = labels ? nextShelves(shelfTrail).map((x, i) => {
    const code = formatLabel(labels, x.section, x.shelf);
    return { key: `s-${code}`, label: `${cold}${code}`, clue: shelfClue(code)!, primary: !d && i === 0 };
  }).filter((x) => x.clue) : [];

  const quick: { key: string; label: string; clue: Clue; primary?: boolean }[] = [];
  const predicted = nextAisles(trail);
  const aisles = [...predicted, ...recentAisles.filter((a) => !predicted.includes(a)).slice(0, Math.max(0, 3 - predicted.length))];
  const aisleChips = aisles.map((a, i) => ({ key: `a-${a}`, label: `${cold}Aisle ${a}`, clue: aisleClue(a), primary: !d && i === 0 }));
  const wallChips = (d || temp) ? WALLS.map((w) => ({ key: `w-${w.wall}`, label: `${cold}${w.label}`, clue: { kind: 'wall', wall: w.wall, ...withTemp } as Clue })) : [];
  if (d) quick.push({ key: `d-${d.id}`, label: `${d.icon} ${d.name}`, clue: { kind: 'dept', dept: d.id }, primary: true });
  if (d) quick.push(...wallChips, ...shelfChips, ...aisleChips.map((a) => ({ ...a, primary: false })));
  else quick.push(...shelfChips, ...aisleChips.map((a) => ({ ...a, primary: a.primary && !shelfChips.length })), ...wallChips);
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
        <button className="link" onClick={onLater}>{laterLabel}</button>
      </div>
      {typing === undefined ? (
        <div className="where-bar-choices">
          {quick.map((q) => (
            <button key={q.key} className={`btn${q.primary ? ' primary' : ''}`} onClick={() => onSave(q.clue)}>{q.label}</button>
          ))}
          <button className="btn" onClick={() => {
            // A shelf label: start with the section you're in ("B"), so it's just the number.
            const here = shelfTrail[shelfTrail.length - 1]?.section;
            setTyping(labels && here ? formatLabel(labels, here) : '');
          }}>{labels ? '# Shelf…' : '# Aisle…'}</button>
          <button className="btn" onClick={onOther}>Other…</button>
          {onAskAtCheckout && <button className="link where-bar-checkout" onClick={onAskAtCheckout}>Ask me at checkout</button>}
        </div>
      ) : (
        <div className="where-bar-pad" role="group" aria-label={labels ? 'Shelf label' : 'Aisle number'}>
          <div className="where-bar-pad-head">
            <button className="link" onClick={() => setTyping(undefined)} aria-label="Back">‹</button>
            <span className="where-bar-pad-value" aria-live="polite">{cold}{labels ? 'Shelf' : 'Aisle'} <b>{typing || '_'}</b></span>
            <button className="btn primary" disabled={!typing} onClick={() => typing && saveTyped(typing)}>Save</button>
          </div>
          {labels && knownSections.length > 0 && (
            <div className="where-bar-sections" role="group" aria-label="Section">
              {knownSections.map((sec) => (
                <button key={sec} className={`btn key${typing?.startsWith(formatLabel(labels, sec)) ? ' active' : ''}`} aria-label={`Section ${sec}`}
                  onClick={() => setTyping(formatLabel(labels, sec))}>{sec}</button>
              ))}
            </div>
          )}
          <div className="where-bar-keys">
            {(letters ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-'.split('') : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-']).map((k) => (
              <button key={k} className="btn key" onClick={() => setTyping((v) => {
                // A letter while only the section that was filled in is there: a different section.
                if (/[A-Z]/.test(k) && v && labels && knownSections.some((sec) => formatLabel(labels, sec) === v)) return k;
                return ((v ?? '') + k).replace(/^0+(?=\d)/, '').slice(0, 8);
              })}>{k}</button>
            ))}
            <button className={`btn key${letters ? ' active' : ''}`} aria-pressed={letters} onClick={() => setLetters((x) => !x)}>{letters ? '123' : 'ABC'}</button>
            <button className="btn key" aria-label="Delete" disabled={!typing} onClick={() => setTyping((v) => (v ?? '').slice(0, -1))}>⌫</button>
          </div>
        </div>
      )}
    </div>
  );
}
