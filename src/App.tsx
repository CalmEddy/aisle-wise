import { useMemo } from 'react';
import { LayoutEditor } from './components/LayoutEditor';
import { ShoppingView } from './components/ShoppingView';
import { demoLayout } from './core/demoLayout';
import { Floor } from './core/floor';
import { normalize } from './core/locate';
import type { Learned, ListItem, Point, StoreLayout } from './core/types';
import { usePersistentState } from './usePersistentState';

type View = 'list' | 'layout';

export default function App() {
  const [layouts, setLayouts] = usePersistentState<StoreLayout[]>('aw.layouts', [demoLayout]);
  const [activeId, setActiveId] = usePersistentState('aw.activeLayout', demoLayout.id);
  const [view, setView] = usePersistentState<View>('aw.view', 'list');
  const [items, setItems] = usePersistentState<ListItem[]>('aw.items', []);
  // Item locations the user taught, per layout.
  const [learnedAll, setLearnedAll] = usePersistentState<Record<string, Learned>>('aw.learned.v2', {});
  const [pos, setPos] = usePersistentState<{ layoutId: string; point: Point } | null>('aw.position.v2', null);

  const layout = layouts.find((l) => l.id === activeId) ?? layouts[0] ?? demoLayout;
  const floor = useMemo(() => new Floor(layout), [layout]);
  const learned = learnedAll[layout.id] ?? {};
  const position = pos?.layoutId === layout.id ? pos.point : layout.entrance;
  const done = items.filter((i) => i.done).length;

  const teach = (itemName: string, spotKey: string) =>
    setLearnedAll((prev) => ({ ...prev, [layout.id]: { ...prev[layout.id], [normalize(itemName)]: spotKey } }));

  return (
    <div className="app">
      <header className="top">
        <div className="title">
          <h1>Aisle Wise</h1>
          {view === 'list' && layouts.length > 1 ? (
            <select className="store-pick" value={layout.id} onChange={(e) => setActiveId(e.target.value)} aria-label="Store">
              {layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          ) : (
            <p className="muted">{layout.name}</p>
          )}
        </div>
        {view === 'list' && (
          <div className="progress" aria-label="Progress">
            <strong>{done}</strong>/{items.length}
          </div>
        )}
      </header>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
          Shopping list
        </button>
        <button role="tab" aria-selected={view === 'layout'} className={view === 'layout' ? 'active' : ''} onClick={() => setView('layout')}>
          Store layout
        </button>
      </nav>

      {view === 'list' ? (
        <ShoppingView
          layout={layout}
          floor={floor}
          items={items}
          setItems={setItems}
          learned={learned}
          teach={teach}
          position={position}
          setPosition={(point) => setPos({ layoutId: layout.id, point })}
          onEditLayout={() => setView('layout')}
        />
      ) : (
        <LayoutEditor
          layouts={layouts}
          setLayouts={setLayouts}
          activeId={layout.id}
          setActiveId={setActiveId}
          onDone={() => setView('list')}
        />
      )}
    </div>
  );
}
