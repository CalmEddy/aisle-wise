import { useMemo, useRef, useState } from 'react';
import { categories, categoryById } from '../core/categories';
import { demoLayout } from '../core/demoLayout';
import { Floor } from '../core/floor';
import { clampPlace, footprint } from '../core/geometry';
import type { Aisle, Area, Place, Point, StoreLayout } from '../core/types';
import { checkLayout } from '../core/validate';
import { StoreMap } from './StoreMap';

interface Props {
  layouts: StoreLayout[];
  setLayouts: (fn: (prev: StoreLayout[]) => StoreLayout[]) => void;
  activeId: string;
  setActiveId: (id: string) => void;
  onDone: () => void;
}

type Tool = 'select' | 'aisle-v' | 'aisle-h' | 'area' | 'entrance' | 'checkout';

type DragState =
  | { mode: 'move'; id: string; start: Point; orig: Place }
  | { mode: 'resize'; id: string; start: Point; orig: Place }
  | { mode: 'entrance' | 'checkout' };

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: 'Tap a shape to edit it. Drag to move; drag the round handle to resize.' },
  { id: 'aisle-v', label: '+ Aisle ↕', hint: 'Tap the map to add an up-and-down aisle.' },
  { id: 'aisle-h', label: '+ Aisle ↔', hint: 'Tap the map to add a side-to-side aisle.' },
  { id: 'area', label: '+ Open area', hint: 'Tap the map to add an open area, like Produce or the Deli.' },
  { id: 'entrance', label: 'Entrance', hint: 'Tap the map where shoppers come in.' },
  { id: 'checkout', label: 'Checkout', hint: 'Tap the map where shoppers pay.' },
];

const newId = () => Math.random().toString(36).slice(2, 10);

export function LayoutEditor({ layouts, setLayouts, activeId, setActiveId, onDone }: Props) {
  const layout = layouts.find((l) => l.id === activeId) ?? layouts[0];
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<string>();
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const floor = useMemo(() => new Floor(layout), [layout]);
  const problems = useMemo(() => checkLayout(layout, floor), [layout, floor]);
  const selected = layout.places.find((p) => p.id === selectedId);

  // --- Layout updates ---
  const update = (fn: (l: StoreLayout) => StoreLayout) =>
    setLayouts((prev) => prev.map((l) => (l.id === layout.id ? fn(l) : l)));

  const updatePlace = (id: string, patch: Partial<Aisle> | Partial<Area>) =>
    update((l) => ({
      ...l,
      places: l.places.map((p) => (p.id === id ? clampPlace({ ...p, ...patch } as Place, l) : p)),
    }));

  const nextAisleNumber = () =>
    layout.places.filter((p) => p.kind === 'aisle').length + 1;

  function addPlace(kind: Tool, at: Point) {
    const id = newId();
    const place: Place =
      kind === 'area'
        ? { kind: 'area', id, label: 'New area', x: at.x - 3, y: at.y - 2, w: 6, h: 4, categories: [] }
        : {
            kind: 'aisle', id, label: `Aisle ${nextAisleNumber()}`,
            orientation: kind === 'aisle-h' ? 'horizontal' : 'vertical',
            x: kind === 'aisle-h' ? at.x - 5 : at.x - 2,
            y: kind === 'aisle-h' ? at.y - 2 : at.y - 5,
            length: 10, width: 2, categories: [],
          };
    update((l) => ({ ...l, places: [...l.places, clampPlace(place, l)] }));
    setSelectedId(id);
    setTool('select');
  }

  // --- Pointer handling on the map ---
  function toCell(e: React.PointerEvent): Point {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return {
      x: Math.max(0, Math.min(layout.width - 1, Math.floor(p.x))),
      y: Math.max(0, Math.min(layout.height - 1, Math.floor(p.y))),
    };
  }

  function beginDrag(state: DragState, e: React.PointerEvent) {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = state;
  }

  function onBackgroundDown(e: React.PointerEvent) {
    const cell = toCell(e);
    if (tool === 'aisle-v' || tool === 'aisle-h' || tool === 'area') addPlace(tool, cell);
    else if (tool === 'entrance' || tool === 'checkout') {
      update((l) => ({ ...l, [tool]: cell }));
      setTool('select');
    } else setSelectedId(undefined);
  }

  function onPlaceDown(place: Place, e: React.PointerEvent) {
    if (tool !== 'select') return; // let the background handler add things on top
    setSelectedId(place.id);
    beginDrag({ mode: 'move', id: place.id, start: toCell(e), orig: place }, e);
  }

  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const cell = toCell(e);
    if (!('start' in d)) {
      const which = d.mode;
      update((l) => ({ ...l, [which]: cell }));
      return;
    }
    const dx = cell.x - d.start.x;
    const dy = cell.y - d.start.y;
    const o = d.orig;
    if (d.mode === 'move') {
      updatePlace(d.id, { x: o.x + dx, y: o.y + dy });
    } else if (o.kind === 'aisle') {
      const max = o.orientation === 'vertical' ? layout.height - o.y : layout.width - o.x;
      const length = clamp(o.length + (o.orientation === 'vertical' ? dy : dx), 2, max);
      updatePlace(d.id, { length });
    } else {
      updatePlace(d.id, { w: clamp(o.w + dx, 1, layout.width - o.x), h: clamp(o.h + dy, 1, layout.height - o.y) });
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  // --- Layout management ---
  function createLayout(from?: StoreLayout) {
    const id = newId();
    const fresh: StoreLayout = from
      ? { ...structuredClone(from), id, name: `${from.name} copy` }
      : { id, name: 'My store', width: 40, height: 30, places: [], entrance: { x: 2, y: 28 }, checkout: { x: 20, y: 28 } };
    setLayouts((prev) => [...prev, fresh]);
    setActiveId(id);
    setSelectedId(undefined);
  }

  function deleteLayout() {
    if (layouts.length <= 1) return;
    if (!confirm(`Delete “${layout.name}”? This can’t be undone.`)) return;
    const rest = layouts.filter((l) => l.id !== layout.id);
    setLayouts(() => rest);
    setActiveId(rest[0].id);
  }

  function resize(width: number, height: number) {
    update((l) => {
      const next = { ...l, width: clamp(width, 10, 150), height: clamp(height, 10, 150) };
      const inside = (p: Point) => ({ x: Math.min(p.x, next.width - 1), y: Math.min(p.y, next.height - 1) });
      return {
        ...next,
        entrance: inside(l.entrance),
        checkout: inside(l.checkout),
        places: l.places.map((p) => clampPlace(p, next)),
      };
    });
  }

  const handle = selected && handlePoint(selected);
  const hint = TOOLS.find((t) => t.id === tool)!.hint;

  return (
    <div className="editor">
      <section className="card">
        <div className="field-row">
          <select value={layout.id} onChange={(e) => { setActiveId(e.target.value); setSelectedId(undefined); }} aria-label="Store layout">
            {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="btn" onClick={() => createLayout()}>New</button>
          <button className="btn" onClick={() => createLayout(layout)}>Copy</button>
          <button className="btn danger" onClick={deleteLayout} disabled={layouts.length <= 1}>Delete</button>
        </div>
        <label className="field">
          <span>Store name</span>
          <input value={layout.name} onChange={(e) => update((l) => ({ ...l, name: e.target.value }))} />
        </label>
        <div className="field-row">
          <NumberField label="Width" value={layout.width} onChange={(v) => resize(v, layout.height)} />
          <NumberField label="Depth" value={layout.height} onChange={(v) => resize(layout.width, v)} />
        </div>
      </section>

      <div className="toolbar" role="toolbar">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? 'chip active' : 'chip'} onClick={() => setTool(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted small">{hint}</p>

      <StoreMap
        ref={svgRef}
        layout={layout}
        selectedId={selectedId}
        showGrid
        onPlacePointerDown={onPlaceDown}
        svgProps={{
          className: `map editing tool-${tool}`,
          onPointerDown: onBackgroundDown,
          onPointerMove: onMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
        }}
      >
        {(['entrance', 'checkout'] as const).map((which) => (
          <rect
            key={which}
            className="marker-hit"
            x={layout[which].x - 1}
            y={layout[which].y - 1}
            width={3}
            height={3}
            onPointerDown={(e) => tool === 'select' && beginDrag({ mode: which }, e)}
          />
        ))}
        {selected && handle && (
          <circle
            className="resize-handle"
            cx={handle.x}
            cy={handle.y}
            r={1.2}
            onPointerDown={(e) => beginDrag({ mode: 'resize', id: selected.id, start: toCell(e), orig: selected }, e)}
          />
        )}
      </StoreMap>

      {selected ? (
        <PlacePanel
          place={selected}
          onChange={(patch) => updatePlace(selected.id, patch)}
          onDelete={() => {
            update((l) => ({ ...l, places: l.places.filter((p) => p.id !== selected.id) }));
            setSelectedId(undefined);
          }}
          usedElsewhere={(catId) => layout.places.find((p) => p.id !== selected.id && p.categories.includes(catId))?.label}
        />
      ) : (
        <section className="card">
          <h3>Places</h3>
          <p className="muted small">Tap one to edit it.</p>
          <div className="chips wrap">
            {layout.places.map((p) => (
              <button key={p.id} className="chip" onClick={() => setSelectedId(p.id)}>{p.label || 'Unnamed'}</button>
            ))}
            {layout.places.length === 0 && <span className="muted small">Nothing yet – pick “+ Aisle” or “+ Open area” and tap the map.</span>}
          </div>
        </section>
      )}

      {problems.length > 0 && (
        <section className="card problems">
          <h3>Check your layout</h3>
          <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </section>
      )}

      <div className="editor-actions">
        {layout.id === demoLayout.id && (
          <button className="btn" onClick={() => update(() => structuredClone(demoLayout))}>Reset demo</button>
        )}
        <button className="btn primary" onClick={onDone}>Done – back to my list</button>
      </div>
    </div>
  );
}

function PlacePanel({ place, onChange, onDelete, usedElsewhere }: {
  place: Place;
  onChange: (patch: Partial<Aisle> | Partial<Area>) => void;
  onDelete: () => void;
  usedElsewhere: (categoryId: string) => string | undefined;
}) {
  const f = footprint(place);
  const available = categories.filter((c) => !place.categories.includes(c.id));
  const move = (dx: number, dy: number) => onChange({ x: place.x + dx, y: place.y + dy });

  return (
    <section className="card panel">
      <label className="field">
        <span>{place.kind === 'aisle' ? 'Aisle label' : 'Area label'}</span>
        <input value={place.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="e.g. Aisle 5 or Bakery" />
      </label>

      {place.kind === 'aisle' ? (
        <>
          <div className="segmented" role="group" aria-label="Direction">
            {(['vertical', 'horizontal'] as const).map((o) => (
              <button key={o} className={place.orientation === o ? 'active' : ''} onClick={() => onChange({ orientation: o })}>
                {o === 'vertical' ? '↕ Up & down' : '↔ Side to side'}
              </button>
            ))}
          </div>
          <div className="field-row">
            <NumberField label="Length" value={place.length} min={2} onChange={(length) => onChange({ length })} />
            <NumberField label="Walkway" value={place.width} min={1} max={6} onChange={(width) => onChange({ width })} />
          </div>
        </>
      ) : (
        <div className="field-row">
          <NumberField label="Width" value={place.w} min={1} onChange={(w) => onChange({ w })} />
          <NumberField label="Depth" value={place.h} min={1} onChange={(h) => onChange({ h })} />
        </div>
      )}

      <div className="field-row nudge">
        <span className="muted small">Position {place.x}, {place.y} · {f.w}×{f.h}</span>
        <button className="btn" onClick={() => move(-1, 0)} aria-label="Move left">←</button>
        <button className="btn" onClick={() => move(0, -1)} aria-label="Move up">↑</button>
        <button className="btn" onClick={() => move(0, 1)} aria-label="Move down">↓</button>
        <button className="btn" onClick={() => move(1, 0)} aria-label="Move right">→</button>
      </div>

      <div className="field">
        <span>What’s here {place.kind === 'aisle' && <span className="muted">(in order, {place.orientation === 'vertical' ? 'top to bottom' : 'left to right'})</span>}</span>
        <div className="chips wrap">
          {place.categories.map((id) => (
            <button key={id} className="chip active" onClick={() => onChange({ categories: place.categories.filter((c) => c !== id) })}>
              {categoryById.get(id)?.name ?? id} ×
            </button>
          ))}
        </div>
        <select
          value=""
          onChange={(e) => onChange({ categories: [...place.categories, e.target.value] })}
          aria-label="Add a category"
        >
          <option value="" disabled>+ Add what’s stocked here…</option>
          {available.map((c) => {
            const other = usedElsewhere(c.id);
            return <option key={c.id} value={c.id}>{c.name}{other ? ` (now in ${other})` : ''}</option>;
          })}
        </select>
      </div>

      <button className="btn danger" onClick={onDelete}>Delete {place.kind === 'aisle' ? 'aisle' : 'area'}</button>
    </section>
  );
}

function NumberField({ label, value, onChange, min = 1, max = 150 }: {
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

/** Where the resize handle sits: the far end of an aisle, or an area's bottom-right corner. */
function handlePoint(p: Place): Point {
  const f = footprint(p);
  if (p.kind === 'area') return { x: f.x + f.w, y: f.y + f.h };
  return p.orientation === 'vertical' ? { x: f.x + f.w / 2, y: f.y + f.h } : { x: f.x + f.w, y: f.y + f.h / 2 };
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
