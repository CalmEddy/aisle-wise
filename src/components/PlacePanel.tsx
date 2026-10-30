import { footprint } from '../core/geometry';
import type { Area, Category, Place, Point, Shelf } from '../core/types';
import { CategoryPicker } from './CategoryPicker';

/** Editing one shelf or area: label, what's stocked there, which side it's stocked from, fridge or freezer. (Turning, size, position and deleting are on the map.) */
export function PlacePanel({ place, onChange, usedElsewhere, categories, looks }: {
  place: Place;
  onChange: (patch: Partial<Shelf> | Partial<Area>) => void;
  usedElsewhere: (categoryId: string) => string | undefined;
  categories: Category[];
  looks: Map<string, { color: string; icon: string }>;
}) {
  const isShelf = place.kind === 'shelf';
  const order = isShelf
    ? (place.orientation === 'vertical' ? 'top to bottom' : 'left to right')
    : (place.w >= place.h ? 'left to right' : 'top to bottom');

  return (
    <section className="card panel">
      <label className="field">
        <span>{isShelf ? 'Shelf label (shown on the shelf)' : 'Area label'}</span>
        <input value={place.label} onChange={(e) => onChange({ label: e.target.value })} placeholder={isShelf ? 'e.g. Pasta or 5A' : 'e.g. Bakery'} />
      </label>

      <div className="field">
        <span>What’s {isShelf ? 'on this shelf' : 'in this area'} <span className="muted">({order} on the map)</span></span>
        <CategoryList
          ids={place.categories}
          onChange={(ids) => onChange({ categories: ids })}
          categories={categories}
          looks={looks}
          usedElsewhere={usedElsewhere}
          addLabel={isShelf ? '+ Add to this shelf…' : '+ Add to this area…'}
        />
      </div>

      {place.kind === 'shelf' && (
        <>
          <div className="field">
            <span>Stocked from</span>
            <div className="segmented" role="group" aria-label="Stocked from">
              {([undefined, 1, -1] as const).map((back) => {
                const v = place.orientation === 'vertical';
                const label = back === undefined ? 'Both sides'
                  : back === 1 ? (v ? '◧ Left only (wall on right)' : '⬒ Top only (wall below)')
                    : (v ? '◨ Right only (wall on left)' : '⬓ Bottom only (wall above)');
                return (
                  <button key={String(back)} className={place.back === back ? 'active' : ''} onClick={() => onChange({ back } as Partial<Shelf>)}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <div className="field">
        <span>Kept</span>
        <div className="segmented" role="group" aria-label="Kept">
          {([undefined, 'chilled', 'frozen'] as const).map((t) => (
            <button key={String(t)} className={place.temp === t ? 'active' : ''} aria-pressed={place.temp === t} onClick={() => onChange({ temp: t })}>
              {t === undefined ? 'Room temperature' : t === 'chilled' ? '🧊 Fridge' : '❄ Freezer'}
            </button>
          ))}
        </div>
      </div>

      <p className="muted small">Turn, resize, move or delete it with the buttons on the map.</p>
    </section>
  );
}

/** An ordered list of category chips with reorder and remove, plus an add menu. */
function CategoryList({ ids, onChange, categories, looks, usedElsewhere, addLabel }: {
  ids: string[];
  onChange: (ids: string[]) => void;
  categories: Category[];
  looks: Map<string, { color: string; icon: string }>;
  usedElsewhere: (categoryId: string) => string | undefined;
  addLabel: string;
}) {
  const nameOf = (id: string) => categories.find((c) => c.id === id)?.name ?? 'Deleted category';
  const moveBy = (i: number, d: number) => {
    const next = [...ids];
    const [id] = next.splice(i, 1);
    next.splice(i + d, 0, id);
    onChange(next);
  };
  const available = categories.filter((c) => !ids.includes(c.id));
  return (
    <>
      <ol className="stock-list">
        {ids.map((id, i) => {
          const look = looks.get(id);
          return (
            <li key={id} className="row stock">
              <span className="cat-chip" style={{ '--cat': look?.color ?? '#999' } as React.CSSProperties}>
                <span aria-hidden="true">{look?.icon}</span> {nameOf(id)}
              </span>
              <button className="icon" onClick={() => moveBy(i, -1)} disabled={i === 0} aria-label={`Move ${nameOf(id)} earlier`}>↑</button>
              <button className="icon" onClick={() => moveBy(i, 1)} disabled={i === ids.length - 1} aria-label={`Move ${nameOf(id)} later`}>↓</button>
              <button className="icon" onClick={() => onChange(ids.filter((c) => c !== id))} aria-label={`Remove ${nameOf(id)}`}>×</button>
            </li>
          );
        })}
        {ids.length === 0 && <li className="muted small">Nothing yet.</li>}
      </ol>
      <CategoryPicker
        categories={available}
        onPick={(id) => id && onChange([...ids, id])}
        iconOf={(id) => looks.get(id)?.icon}
        note={(id) => { const where = usedElsewhere(id); return where ? `now on ${where}` : undefined; }}
        placeholder={addLabel}
        label={addLabel}
        clearOnPick
      />
    </>
  );
}

export function NumberField({ label, value, onChange, min = 1, max = 150 }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field number">
      <span>{label}</span>
      <div className="stepper">
        <button type="button" onClick={() => onChange(clamp(value - 1, min, max))} aria-label={`Less ${label}`}>−</button>
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isNaN(v)) onChange(clamp(v, min, max));
          }}
        />
        <button type="button" onClick={() => onChange(clamp(value + 1, min, max))} aria-label={`More ${label}`}>+</button>
      </div>
    </label>
  );
}

/** Where the resize handle sits: the far end of a shelf, or an area's bottom-right corner. */
/** Where the resize handle sits on a place (its far corner or end). */
export function handlePoint(p: Place): Point {
  const f = footprint(p);
  if (p.kind === 'area') return { x: f.x + f.w, y: f.y + f.h };
  return p.orientation === 'vertical' ? { x: f.x + 0.5, y: f.y + f.h } : { x: f.x + f.w, y: f.y + 0.5 };
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
