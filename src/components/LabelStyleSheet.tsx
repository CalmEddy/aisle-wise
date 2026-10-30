import { useState } from 'react';
import { formatLabel, guessRoles, PAIRINGS, parseLabel, shelfOffsets, tokenize, type LabelRole, type LabelStyle, type Pairing } from '../core/labels';

const ROLE_NAME: Record<LabelRole, string> = { section: 'Section', shelf: 'Shelf', ignore: 'Ignore' };

/** Six numbered shelves stood the way a pairing says (shelf 1 on the right, like on the map). */
function PairingPicture({ pairing }: { pairing: Pairing }) {
  const n = 6;
  if (pairing === 'row') {
    return (
      <svg viewBox="0 0 30 12" className="pairing-pic" aria-hidden="true">
        {Array.from({ length: n }, (_, k) => (
          <g key={k}>
            <rect x={k * 5 + 0.3} y={3} width={4.4} height={6} rx={0.6} className="pic-shelf" />
            <text x={k * 5 + 2.5} y={6.2} textAnchor="middle" dominantBaseline="central" fontSize={2.6} className="pic-num">{k + 1}</text>
          </g>
        ))}
      </svg>
    );
  }
  const offs = shelfOffsets(pairing, n);
  const w = Math.max(...offs) + 1;
  return (
    <svg viewBox={`-0.6 0 ${w + 1.2} 9.4`} className="pairing-pic" aria-hidden="true">
      {offs.map((o, k) => {
        const x = w - 1 - o;
        return (
          <g key={k}>
            <rect x={x + 0.06} y={0.4} width={0.88} height={6.2} rx={0.2} className="pic-shelf" />
            <text x={x + 0.5} y={8.2} textAnchor="middle" dominantBaseline="central" fontSize={1.05} className="pic-num under">{k + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Setting up how a store labels its shelves, by example: type a real label
 * ("B12"), say what each part is, and how neighbouring shelves stand.
 */
export function LabelStyleSheet({ initial, current, onSave, onAisles, onClose }: {
  /** A label just typed, to start from. */
  initial?: string;
  current?: LabelStyle;
  onSave: (style: LabelStyle) => void;
  /** This store numbers its aisles after all (no label style). */
  onAisles?: () => void;
  onClose: () => void;
}) {
  const [example, setExample] = useState(initial ?? current?.example ?? 'B12');
  const tokens = tokenize(example);
  const [roles, setRoles] = useState<LabelRole[]>(current && current.example === example ? current.roles : guessRoles(example));
  const [pairing, setPairing] = useState<Pairing>(current?.pairing ?? 'backToBack');
  const fitted = tokens.map((_, i) => roles[i] ?? 'ignore');
  const style: LabelStyle = { example: example.trim().toUpperCase(), roles: fitted, pairing };
  const read = tokens.length ? parseLabel(style, example) : undefined;
  const changeExample = (v: string) => { setExample(v); setRoles(guessRoles(v)); };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet label-sheet" role="dialog" aria-label="Shelf labels" onClick={(e) => e.stopPropagation()}>
        <h2>How does this store label shelves?</h2>
        <label className="field">
          <span>A label from the store</span>
          <input value={example} onChange={(e) => changeExample(e.target.value)} placeholder="e.g. B12 or 12-3" aria-label="Example label" autoCapitalize="characters" />
        </label>
        {tokens.length > 0 && (
          <div className="label-parts">
            {tokens.map((t, i) => (
              <div key={i} className="label-part">
                <span className="label-token">{t.text}</span>
                <div className="segmented mini-seg" role="group" aria-label={`What “${t.text}” means`}>
                  {(['section', 'shelf', 'ignore'] as const).map((r) => (
                    <button key={r} className={fitted[i] === r ? 'active' : ''} aria-pressed={fitted[i] === r}
                      onClick={() => setRoles(fitted.map((x, j) => (j === i ? r : x)))}>{ROLE_NAME[r]}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="muted small">
          {read ? <>Read as <b>section {read.section}{read.shelf !== undefined ? <>, shelf {read.shelf}</> : null}</b>. Next shelf: {formatLabel(style, read.section, (read.shelf ?? 0) + 1)}.</>
            : 'Say which part is the section.'}
        </p>
        <div className="field">
          <span>How do neighbouring shelves stand?</span>
          <div className="pairing-options" role="radiogroup" aria-label="How neighbouring shelves stand">
            {PAIRINGS.map((p) => (
              <button key={p.id} role="radio" aria-checked={pairing === p.id} className={`pairing-option${pairing === p.id ? ' active' : ''}`} onClick={() => setPairing(p.id)}>
                <PairingPicture pairing={p.id} />
                <b>{p.name}</b>
                <span className="muted small">{p.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="sheet-actions">
          {onAisles && <button className="link" onClick={onAisles}>It uses aisle numbers</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!read} onClick={() => onSave(style)}>Save</button>
        </div>
      </div>
    </div>
  );
}
