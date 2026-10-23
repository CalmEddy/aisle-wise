import { useMemo, useState } from 'react';
import { StoreMap } from './components/StoreMap';
import { demoStore } from './core/demoStore';
import { findSection, normalize } from './core/locate';
import { groupIntoStops, planRoute } from './core/route';
import type { ListItem, Point, Section } from './core/types';
import { usePersistentState } from './usePersistentState';

const store = demoStore;
const newId = () => Math.random().toString(36).slice(2, 10);

export default function App() {
  const [items, setItems] = usePersistentState<ListItem[]>('aw.items', []);
  const [learned, setLearned] = usePersistentState<Record<string, string>>('aw.learned', {});
  const [position, setPosition] = usePersistentState<Point>('aw.position', store.entrance);
  const [draft, setDraft] = useState('');

  const locate = (item: ListItem): Section | undefined =>
    item.sectionId
      ? store.sections.find((s) => s.id === item.sectionId)
      : findSection(item.name, store, learned);

  // Re-plans every time the list or the shopper's position changes.
  const { route, unplaced } = useMemo(() => {
    const { stops, unplaced } = groupIntoStops(items, locate);
    return { route: planRoute(position, stops, store), unplaced };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, learned, position]);

  const done = items.filter((i) => i.done);
  const nearest = sectionAt(position);

  function addItems(text: string) {
    const names = text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    setItems((prev) => [...prev, ...names.map((name) => ({ id: newId(), name, done: false }))]);
    setDraft('');
  }

  function toggle(item: ListItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    // Picking something up tells us where the shopper is standing.
    const section = locate(item);
    if (!item.done && section) setPosition(section.point);
  }

  function remove(item: ListItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  function place(item: ListItem, sectionId: string) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, sectionId } : i)));
    setLearned((prev) => ({ ...prev, [normalize(item.name)]: sectionId }));
  }

  function newTrip() {
    setItems((prev) => prev.filter((i) => !i.done));
    setPosition(store.entrance);
  }

  const [next, ...later] = route;
  const remaining = items.length - done.length;

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Aisle Wise</h1>
          <p className="muted">{store.name}</p>
        </div>
        <div className="progress" aria-label="Progress">
          <strong>{done.length}</strong>/{items.length}
        </div>
      </header>

      <form
        className="add"
        onSubmit={(e) => {
          e.preventDefault();
          addItems(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add items, e.g. milk, apples, pasta"
          aria-label="Add items"
          enterKeyHint="done"
        />
        <button type="submit" disabled={!draft.trim()}>Add</button>
      </form>

      {items.length > 0 && (
        <>
          <StoreMap store={store} you={position} stops={route} />

          <section className="here">
            <span className="muted">You're near</span>
            <div className="chips" role="list">
              <Chip label="Entrance" active={samePoint(position, store.entrance)} onClick={() => setPosition(store.entrance)} />
              {store.sections.map((s) => (
                <Chip key={s.id} label={chipLabel(s)} active={nearest?.id === s.id && !samePoint(position, store.entrance)} onClick={() => setPosition(s.point)} />
              ))}
            </div>
          </section>
        </>
      )}

      <main>
        {items.length === 0 && (
          <div className="empty">
            <p>Your list is empty.</p>
            <p className="muted">Add what you need. The list sorts itself into the shortest walk through the store and re-sorts as you move.</p>
          </div>
        )}

        {next && (
          <section className="card next-card">
            <div className="stop-head">
              <span className="badge">Next</span>
              <h2>{next.section.name}</h2>
            </div>
            <ItemRows items={next.items} onToggle={toggle} onRemove={remove} big />
          </section>
        )}

        {later.map((stop, i) => (
          <section className="card" key={stop.section.id}>
            <div className="stop-head">
              <span className="num">{i + 2}</span>
              <h3>{stop.section.name}</h3>
            </div>
            <ItemRows items={stop.items} onToggle={toggle} onRemove={remove} />
          </section>
        ))}

        {unplaced.length > 0 && (
          <section className="card unplaced">
            <h3>Where is this?</h3>
            <p className="muted small">Pick a spot once and the app remembers it.</p>
            {unplaced.map((item) => (
              <div className="row" key={item.id}>
                <span className="name">{item.name}</span>
                <select value="" onChange={(e) => place(item, e.target.value)} aria-label={`Location of ${item.name}`}>
                  <option value="" disabled>Choose…</option>
                  {store.sections.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button className="icon" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>×</button>
              </div>
            ))}
          </section>
        )}

        {items.length > 0 && remaining === 0 && (
          <div className="empty">
            <p>All done! Head to checkout.</p>
          </div>
        )}

        {done.length > 0 && (
          <details className="card done">
            <summary>In the cart ({done.length})</summary>
            <ItemRows items={done} onToggle={toggle} onRemove={remove} />
            <button className="link" onClick={newTrip}>Clear cart and start a new trip</button>
          </details>
        )}
      </main>
    </div>
  );
}

function ItemRows({ items, onToggle, onRemove, big }: {
  items: ListItem[];
  onToggle: (i: ListItem) => void;
  onRemove: (i: ListItem) => void;
  big?: boolean;
}) {
  return (
    <ul className={big ? 'items big' : 'items'}>
      {items.map((item) => (
        <li key={item.id} className={item.done ? 'row checked' : 'row'}>
          <label>
            <input type="checkbox" checked={item.done} onChange={() => onToggle(item)} />
            <span className="name">{item.name}</span>
          </label>
          <button className="icon" onClick={() => onRemove(item)} aria-label={`Remove ${item.name}`}>×</button>
        </li>
      ))}
    </ul>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button role="listitem" className={active ? 'chip active' : 'chip'} onClick={onClick}>
      {label}
    </button>
  );
}

function chipLabel(s: Section) {
  return s.short.startsWith('A') && /^A\d/.test(s.short) ? `${s.short} ${s.point.y < 30 ? 'front' : 'back'}` : s.short;
}

function samePoint(a: Point, b: Point) {
  return a.x === b.x && a.y === b.y;
}

function sectionAt(p: Point): Section | undefined {
  return store.sections.find((s) => samePoint(s.point, p));
}
