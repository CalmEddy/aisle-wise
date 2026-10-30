import { useRef, useState } from 'react';
import type { StoreLayout, Wall } from '../core/types';
import { currentWalls, moveSection, sectionTitle, trayFor, WALL_KEYS, type WallOrder } from '../core/walls';

/** Each wall's sections as shown: the back wall left to right; side walls with the back at the top. */
const shown = (walls: WallOrder, w: Wall) => (w === 'back' ? walls.back : [...walls[w]].reverse());

/** Puts `key` at a shown position on a wall (undefined wall: back in the tray). */
function placeAt(walls: WallOrder, key: string, wall: Wall | undefined, index: number): WallOrder {
  if (!wall) return moveSection(walls, key, undefined);
  const list = shown(walls, wall).filter((k) => k !== key);
  list.splice(Math.max(0, Math.min(index, list.length)), 0, key);
  const stored = wall === 'back' ? list : list.reverse();
  return { ...moveSection(walls, key, undefined), [wall]: stored };
}

/**
 * The departments screen: the store as a box, with what's on its left, back
 * and right walls. Drag a department to where it is (or tap it, then tap
 * where it goes); the ones not seen here yet wait in the tray below.
 */
export function DeptWallsSheet({ layout, onSave, onClose }: {
  layout: StoreLayout;
  onSave: (walls: WallOrder) => void;
  onClose: () => void;
}) {
  const [walls, setWalls] = useState<WallOrder>(() => currentWalls(layout));
  const [picked, setPicked] = useState<string>();
  const [drag, setDrag] = useState<{ key: string; x: number; y: number }>();
  const start = useRef<{ key: string; x: number; y: number; id: number } | null>(null);
  const tray = trayFor(walls);

  /** Where a screen point lands: a wall and a shown position, the tray, or nowhere. */
  function dropAt(x: number, y: number): { wall?: Wall; index: number } | undefined {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-chip],[data-wall],[data-tray]');
    if (!el) return undefined;
    if (el.dataset.tray !== undefined) return { index: 0 };
    if (el.dataset.chip !== undefined) {
      const wall = el.dataset.wallOf as Wall | undefined;
      if (!wall) return { index: 0 };
      const r = el.getBoundingClientRect();
      const i = Number(el.dataset.index);
      // Past the middle of a chip: after it.
      const after = wall === 'back' ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
      return { wall, index: i + (after ? 1 : 0) };
    }
    const wall = el.dataset.wall as Wall;
    return { wall, index: shown(walls, wall).length };
  }
  const put = (key: string, to: { wall?: Wall; index: number }) => { setWalls((w) => placeAt(w, key, to.wall, to.index)); setPicked(undefined); };

  const chip = (key: string, wall: Wall | undefined, index: number) => {
    const t = sectionTitle(key);
    return (
      <button key={key} className={`chip dept-chip${picked === key ? ' active' : ''}${drag?.key === key ? ' dragging' : ''}`}
        data-chip="" data-wall-of={wall} data-index={index} aria-pressed={picked === key} aria-label={t.name}
        onPointerDown={(e) => { start.current = { key, x: e.clientX, y: e.clientY, id: e.pointerId }; }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          if (!drag && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) return;
          if (!drag) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          setDrag({ key, x: e.clientX, y: e.clientY });
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (drag) {
            const to = dropAt(e.clientX, e.clientY);
            setDrag(undefined);
            if (to) put(key, to);
            return;
          }
          if (!s) return;
          // A tap: pick it up, or drop what's picked up just before it.
          if (picked && picked !== key) put(picked, wall ? { wall, index } : { index: 0 });
          else setPicked(picked === key ? undefined : key);
        }}
        onPointerCancel={() => { start.current = null; setDrag(undefined); }}>
        {t.icon} {t.name}
      </button>
    );
  };
  const wallBox = (w: Wall) => (
    <div className={`dept-wall dept-wall-${w}`} data-wall={w} role="group" aria-label={`${w === 'back' ? 'Back' : w === 'left' ? 'Left' : 'Right'} wall`}
      onClick={(e) => { if (picked && e.target === e.currentTarget) put(picked, { wall: w, index: shown(walls, w).length }); }}>
      {shown(walls, w).map((k, i) => chip(k, w, i))}
      {!shown(walls, w).length && <span className="muted small dept-wall-empty">{picked ? 'Tap to put it here' : 'Nothing yet'}</span>}
    </div>
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet dept-walls-sheet" role="dialog" aria-label="Departments on the walls" onClick={(e) => e.stopPropagation()}>
        <h2>What’s along the walls?</h2>
        <p className="muted small">Drag each department to where it is, or tap one and then tap where it goes. The top is the back of the store.</p>
        <div className="dept-store">
          {wallBox('back')}
          <div className="dept-sides">
            {wallBox('left')}
            <div className="dept-floor muted small">Aisles</div>
            {wallBox('right')}
          </div>
          <div className="dept-front muted small">Front · door</div>
        </div>
        <div className="field">
          <span>Not on a wall {picked && WALL_KEYS.some((w) => walls[w].includes(picked)) && <button className="link" onClick={() => put(picked, { index: 0 })}>Take it off the wall</button>}</span>
          <div className="dept-tray chips wrap" data-tray="" role="group" aria-label="Not on a wall"
            onClick={(e) => { if (picked && e.target === e.currentTarget) put(picked, { index: 0 }); }}>
            {tray.map((k) => chip(k, undefined, 0))}
            {!tray.length && <span className="muted small">Every department is placed.</span>}
          </div>
        </div>
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(walls)}>Save</button>
        </div>
        {drag && (
          <div className="dept-ghost chip" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
            {sectionTitle(drag.key).icon} {sectionTitle(drag.key).name}
          </div>
        )}
      </div>
    </div>
  );
}
