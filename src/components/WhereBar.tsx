import { DEPTS, describeClue, guessDept } from '../core/clues';
import type { Clue } from '../core/types';

/**
 * The quick "Where was it?" asked at check-off: a bar at the bottom that
 * doesn't block the list. The likely answers are one tap; "Other…" opens
 * the full panel; ignoring it (checking the next thing off) asks later.
 */
export function WhereBar({ itemName, categoryId, recentAisles, lastClue, onSave, onOther, onLater }: {
  itemName: string;
  categoryId?: string;
  recentAisles: string[];
  lastClue?: Clue;
  onSave: (clue: Clue) => void;
  onOther: () => void;
  onLater: () => void;
}) {
  const dept = guessDept(categoryId);
  const d = dept && DEPTS.find((x) => x.id === dept);
  const quick: { key: string; label: string; clue: Clue }[] = [];
  if (d) quick.push({ key: `d-${d.id}`, label: `${d.icon} ${d.name}`, clue: { kind: 'dept', dept: d.id } });
  if (lastClue) quick.push({ key: 'last', label: `Same as last: ${describeClue(lastClue)}`, clue: lastClue });
  for (const a of recentAisles.slice(0, 3)) {
    if (lastClue?.kind === 'aisle' && lastClue.aisle === a && !lastClue.side && !lastClue.pos) continue;
    quick.push({ key: `a-${a}`, label: `Aisle ${a}`, clue: { kind: 'aisle', aisle: a } });
  }
  return (
    <div className="where-bar" role="group" aria-label={`Where was ${itemName}?`}>
      <div className="where-bar-head">
        <span>Where was <b>{itemName}</b>?</span>
        <button className="link" onClick={onLater}>Later</button>
      </div>
      <div className="where-bar-choices">
        {quick.map((q, i) => (
          <button key={q.key} className={`btn${i === 0 && d ? ' primary' : ''}`} onClick={() => onSave(q.clue)}>{q.label}</button>
        ))}
        <button className="btn" onClick={onOther}>{quick.length ? 'Other…' : 'Aisle / department…'}</button>
      </div>
    </div>
  );
}
