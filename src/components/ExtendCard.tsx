import type { Extension } from '../core/extend';

/** "3L seems to go further toward the back. Extend it 2 squares?" One tap either way. */
export function ExtendCard({ due, onExtend, onKeep, compact }: {
  due: Extension;
  onExtend: () => void;
  onKeep: () => void;
  compact?: boolean;
}) {
  const squares = `${due.by} square${due.by === 1 ? '' : 's'}`;
  return (
    <div className={`layout-question extend-card${compact ? ' compact' : ''}`} role="group" aria-label={`Is ${due.label} longer?`}>
      <p><span aria-hidden="true">▤ </span>{compact ? 'This shelf' : `“${due.label}”`} seems to go further {due.way}. <span className="muted small">({due.why.join('; ')})</span></p>
      <div className="layout-question-choices">
        <button className="btn primary" onClick={onExtend}>Extend it {squares}</button>
        <button className="link" onClick={onKeep}>Not really</button>
      </div>
    </div>
  );
}
