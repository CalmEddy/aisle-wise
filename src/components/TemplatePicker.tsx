import { useMemo, useState } from 'react';
import { DEFAULT_TEMPLATE_ID, STORE_TEMPLATES, templateById } from '../data/storeTemplates';
import { storeFromTemplate } from '../core/templates';
import { NumberField } from './PlacePanel';
import { StoreMap } from './StoreMap';

const BLANK = { id: 'blank', name: 'Blank', icon: '⬜', description: 'Just the entrance and checkout: draw the map yourself in Edit map.' };

/** What a new store starts as: typical supermarket by default; other kinds and blank are secondary. */
export function TemplatePicker({ name, onCreate, onBack, onClose }: {
  name: string;
  onCreate: (templateId: string, aisles?: number) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [aisles, setAisles] = useState<number>();
  const [more, setMore] = useState(false);
  const t = templateById(templateId);
  const count = aisles ?? t?.aisles;
  const preview = useMemo(() => storeFromTemplate('Preview', templateId, count || undefined), [templateId, count]);
  const primary = STORE_TEMPLATES.filter((x) => x.id === DEFAULT_TEMPLATE_ID);
  const others = STORE_TEMPLATES.filter((x) => x.id !== DEFAULT_TEMPLATE_ID);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet store-sheet" role="dialog" aria-label="Start the map" onClick={(e) => e.stopPropagation()}>
        <h2>What’s {name} like?</h2>
        <p className="muted small">Start from a typical layout — dashed parts are guesses. Your answers redraw the map as you shop.</p>
        <div className="template-chips" role="radiogroup" aria-label="Kind of store">
          {primary.map((x) => (
            <button key={x.id} role="radio" aria-checked={templateId === x.id} className={`chip${templateId === x.id ? ' active' : ''}`}
              onClick={() => { setTemplateId(x.id); setAisles(undefined); }}>
              <span aria-hidden="true">{x.icon} </span>{x.name}
            </button>
          ))}
          {more && others.map((x) => (
            <button key={x.id} role="radio" aria-checked={templateId === x.id} className={`chip${templateId === x.id ? ' active' : ''}`}
              onClick={() => { setTemplateId(x.id); setAisles(undefined); }}>
              <span aria-hidden="true">{x.icon} </span>{x.name}
            </button>
          ))}
          {more && (
            <button role="radio" aria-checked={templateId === 'blank'} className={`chip${templateId === 'blank' ? ' active' : ''}`}
              onClick={() => { setTemplateId('blank'); setAisles(undefined); }}>
              <span aria-hidden="true">{BLANK.icon} </span>{BLANK.name}
            </button>
          )}
        </div>
        {!more && (
          <button type="button" className="link" onClick={() => setMore(true)}>Other layouts or blank…</button>
        )}
        <p className="small">{(t ?? BLANK).description}</p>
        {t && t.aisles > 0 && <NumberField label="Aisles" value={count!} min={t.aisleRange[0]} max={t.aisleRange[1]} onChange={setAisles} />}
        {templateId !== 'blank' && <div className="placement-map template-preview" aria-label="Preview"><StoreMap layout={preview} /></div>}
        <div className="sheet-actions">
          {onBack && <button className="btn" onClick={onBack}>Back</button>}
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => { onCreate(templateId, t && t.aisles > 0 ? count : undefined); onClose(); }}>
            {templateId === DEFAULT_TEMPLATE_ID ? 'Create typical store' : 'Create store'}
          </button>
        </div>
      </div>
    </div>
  );
}
