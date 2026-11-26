import { useMemo, useState } from 'react';
import { DEFAULT_TEMPLATE_ID, FEATURED_TEMPLATE_IDS, STORE_TEMPLATES, templateById } from '../data/storeTemplates';
import { storeFromTemplate, type FromTemplateOpts } from '../core/templates';
import { NumberField } from './PlacePanel';
import { StoreMap } from './StoreMap';

const BLANK = { id: 'blank', name: 'Blank', icon: '⬜', description: 'Empty map — category areas appear as you check items off, in walk order.' };

const FEATURED = new Set<string>(FEATURED_TEMPLATE_IDS);

/** What a new store starts as: map gallery first; Blank and Supercenter under More. */
export function TemplatePicker({ name, onCreate, onBack, onClose }: {
  name: string;
  onCreate: (templateId: string, aisles?: number, opts?: FromTemplateOpts) => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [aisles, setAisles] = useState<number>();
  const [mirror, setMirror] = useState(false);
  const [more, setMore] = useState(false);
  const t = templateById(templateId);
  const count = aisles ?? t?.aisles;
  const opts = mirror ? { mirror: true } as const : undefined;
  const preview = useMemo(
    () => storeFromTemplate('Preview', templateId, count || undefined, opts),
    [templateId, count, mirror],
  );
  const featuredPreviews = useMemo(() => {
    const map = new Map<string, ReturnType<typeof storeFromTemplate>>();
    for (const x of STORE_TEMPLATES.filter((s) => FEATURED.has(s.id))) {
      map.set(x.id, storeFromTemplate('Preview', x.id, x.aisles || undefined));
    }
    return map;
  }, []);
  const featured = STORE_TEMPLATES.filter((x) => FEATURED.has(x.id));
  const extra = STORE_TEMPLATES.filter((x) => !FEATURED.has(x.id));
  const pick = (id: string) => { setTemplateId(id); setAisles(undefined); };

  const card = (x: { id: string; name: string; icon: string; aisles: number }, map: ReturnType<typeof storeFromTemplate> | undefined) => {
    const selected = templateId === x.id;
    const layout = selected ? preview : (map ?? storeFromTemplate('Preview', x.id, x.aisles || undefined));
    return (
      <button
        key={x.id}
        type="button"
        role="radio"
        aria-checked={selected}
        className={`template-card${selected ? ' active' : ''}`}
        onClick={() => pick(x.id)}
      >
        <div className="template-card-map" aria-hidden={selected ? undefined : true} {...(selected ? { 'aria-label': 'Preview' } : {})}>
          <StoreMap layout={layout} />
        </div>
        <span className="template-card-label">
          <span aria-hidden="true">{x.icon} </span>{x.name}
          {x.aisles > 0 && selected && <span className="muted small"> · {count} aisles</span>}
        </span>
      </button>
    );
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet store-sheet template-gallery" role="dialog" aria-label="Start the map" onClick={(e) => e.stopPropagation()}>
        <h2>What’s {name} like?</h2>
        <p className="muted small">Tap a map to start. Dashed parts are guesses until you say where things are.</p>
        <div className="template-gallery-grid" role="radiogroup" aria-label="Kind of store">
          {featured.map((x) => card(x, featuredPreviews.get(x.id)))}
          {more && extra.map((x) => card(x, undefined))}
          {more && (
            <button
              type="button"
              role="radio"
              aria-checked={templateId === 'blank'}
              className={`template-card blank${templateId === 'blank' ? ' active' : ''}`}
              onClick={() => pick('blank')}
            >
              <div className="template-card-blank" aria-hidden="true">
                <span>{BLANK.icon}</span>
              </div>
              <span className="template-card-label">{BLANK.name}</span>
            </button>
          )}
        </div>
        {!more && (
          <button type="button" className="link" onClick={() => setMore(true)}>More layouts or blank…</button>
        )}
        <p className="small">{(t ?? BLANK).description}</p>
        {t && t.aisles > 0 && (
          <NumberField label="Aisles" value={count!} min={t.aisleRange[0]} max={t.aisleRange[1]} onChange={setAisles} />
        )}
        {templateId !== 'blank' && (
          <label className="mirror-toggle">
            <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
            <span>Mirror the map (aisle 1 on the other side)</span>
          </label>
        )}
        <div className="sheet-actions">
          {onBack && <button className="btn" onClick={onBack}>Back</button>}
          <span style={{ flex: 1 }} />
          <button
            className="btn primary"
            onClick={() => {
              onCreate(templateId, t && t.aisles > 0 ? count : undefined, opts);
              onClose();
            }}
          >
            {templateId === DEFAULT_TEMPLATE_ID ? 'Create typical store' : 'Create store'}
          </button>
        </div>
      </div>
    </div>
  );
}
