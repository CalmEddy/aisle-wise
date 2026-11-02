import { useMemo, useState } from 'react';
import { DEFAULT_TEMPLATE_ID, STORE_TEMPLATES, templateById } from '../data/storeTemplates';
import { storeFromTemplate } from '../core/templates';
import { NumberField } from './PlacePanel';
import { StoreMap } from './StoreMap';

const BLANK = { id: 'blank', name: 'Blank', icon: '⬜', description: 'Just the entrance and checkout: the map builds as you shop.' };

/** What a new store starts as: a default map (with a preview and how many aisles), or blank. */
export function TemplatePicker({ name, onCreate, onBack, onClose }: {
  name: string;
  onCreate: (templateId: string, aisles?: number) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [aisles, setAisles] = useState<number>();
  const t = templateById(templateId);
  const count = aisles ?? t?.aisles;
  const preview = useMemo(() => storeFromTemplate('Preview', templateId, count || undefined), [templateId, count]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet store-sheet" role="dialog" aria-label="Start the map" onClick={(e) => e.stopPropagation()}>
        <h2>What’s {name} like?</h2>
        <p className="muted small">A starting guess: dashed parts are guesses, and your answers redraw the map as you shop.</p>
        <div className="template-chips" role="radiogroup" aria-label="Kind of store">
          {[...STORE_TEMPLATES, BLANK].map((x) => (
            <button key={x.id} role="radio" aria-checked={templateId === x.id} className={`chip${templateId === x.id ? ' active' : ''}`}
              onClick={() => { setTemplateId(x.id); setAisles(undefined); }}>
              <span aria-hidden="true">{x.icon} </span>{x.name}
            </button>
          ))}
        </div>
        <p className="small">{(t ?? BLANK).description}</p>
        {t && t.aisles > 0 && <NumberField label="Aisles" value={count!} min={t.aisleRange[0]} max={t.aisleRange[1]} onChange={setAisles} />}
        <div className="placement-map template-preview" aria-label="Preview"><StoreMap layout={preview} /></div>
        <div className="sheet-actions">
          {onBack && <button className="btn" onClick={onBack}>Back</button>}
          <span style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => { onCreate(templateId, t && t.aisles > 0 ? count : undefined); onClose(); }}>Create store</button>
        </div>
      </div>
    </div>
  );
}
