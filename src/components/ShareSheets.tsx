import { useEffect, useMemo, useState } from 'react';
import { buildShare, shareUrl, type BothShare, type Share, type StoreShare } from '../core/share';
import type { Catalog } from '../core/catalog';
import type { ListItem, StoreLayout } from '../core/types';

function listSummary(n: number) {
  if (n === 0) return 'Nothing left to buy on this list.';
  return `${n} item${n === 1 ? '' : 's'} still to get.`;
}

function storeSummary(share: StoreShare) {
  const located = share.items.filter((i) => i.at).length;
  const unavailable = share.items.filter((i) => i.notAvailable).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `The store layout and ${plural(located, 'item location')}`
    + (unavailable ? `, plus ${plural(unavailable, 'item')} not available there.` : '.');
}

function shareTitle(share: Share, listName: string, storeName: string) {
  if (share.kind === 'list') return listName;
  if (share.kind === 'store') return storeName;
  return `${listName} and ${storeName}`;
}

function shareSummary(share: Share) {
  if (share.kind === 'list') return listSummary(share.items.length);
  if (share.kind === 'store') return storeSummary(share);
  return `${listSummary(share.list.items.length)} ${storeSummary(share.store)}`;
}

/** Chooser + link: shopping list, this store’s map, or both. */
export function ShareSheet({ listName, items, layout, catalog, initial, onClose }: {
  listName: string;
  items: ListItem[];
  layout: StoreLayout;
  catalog: Catalog;
  /** Which boxes start checked (Shop → list; Edit map → map). */
  initial: { list: boolean; map: boolean };
  onClose: () => void;
}) {
  const [includeList, setIncludeList] = useState(initial.list);
  const [includeMap, setIncludeMap] = useState(initial.map);
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  const canBuild = includeList || includeMap;

  const share = useMemo(() => {
    if (!canBuild) return null;
    return buildShare({ includeList, includeMap, items, layout, catalog });
  }, [canBuild, includeList, includeMap, items, layout, catalog]);

  const title = share ? shareTitle(share, listName, layout.name) : 'something';
  const summary = share ? shareSummary(share) : 'Pick a shopping list, a store map, or both.';

  useEffect(() => {
    setCopied(false);
    if (!share) { setUrl(''); return; }
    let cancelled = false;
    const base = `${location.origin}${location.pathname}`;
    shareUrl(share, base).then((u) => { if (!cancelled) setUrl(u); }).catch(() => { if (!cancelled) setUrl(''); });
    return () => { cancelled = true; };
  }, [share]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      (document.getElementById('share-url') as HTMLInputElement | null)?.select();
    }
  }

  async function shareNative() {
    try {
      await navigator.share({ title: `Aisle Wise: ${title}`, text: summary, url });
    } catch {
      // Cancelled or unavailable.
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="Share" onClick={(e) => e.stopPropagation()}>
        <h2>Share</h2>
        <p className="muted small">
          Send a link to anyone who uses Aisle Wise. Opening it adds a copy to their app —
          later changes aren’t synced, so share again to send updates.
        </p>

        <div className="share-options" role="group" aria-label="What to share">
          <label className="check share-option">
            <input
              type="checkbox"
              checked={includeList}
              onChange={(e) => setIncludeList(e.target.checked)}
            />
            <span>
              <span className="share-option-title">Shopping list</span>
              <span className="muted small"> “{listName}” · {items.filter((i) => !i.done).length} to buy</span>
            </span>
          </label>
          <label className="check share-option">
            <input
              type="checkbox"
              checked={includeMap}
              onChange={(e) => setIncludeMap(e.target.checked)}
            />
            <span>
              <span className="share-option-title">This store’s map</span>
              <span className="muted small"> “{layout.name}” · layout and item locations</span>
            </span>
          </label>
        </div>

        {canBuild && (
          <>
            <p className="muted small share-summary">{summary}</p>
            <input
              id="share-url"
              className="share-url"
              readOnly
              value={url || 'Making link…'}
              onFocus={(e) => e.target.select()}
              aria-label="Share link"
            />
          </>
        )}
        {!canBuild && (
          <p className="muted small share-summary">Tick at least one option above.</p>
        )}

        <div className="sheet-actions">
          <button className="btn" onClick={onClose}>Close</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={copy} disabled={!url}>{copied ? 'Copied ✓' : 'Copy link'}</button>
          {canShare && <button className="btn primary" onClick={shareNative} disabled={!url}>Share…</button>}
        </div>
      </div>
    </div>
  );
}

/** Shown when the app is opened from a share link. */
export function ImportSheet({ share, layouts, currentListName, onAddList, onAddStore, onAddBoth, onCancel }: {
  share: Share | 'error';
  layouts: StoreLayout[];
  /** Name of the list currently being shopped (for “add to current”). */
  currentListName: string;
  onAddList: (target: 'current' | { newName: string }) => void;
  onAddStore: (replaceId?: string) => void;
  onAddBoth: (opts: { listTarget: 'current' | { newName: string }; replaceStoreId?: string }) => void;
  onCancel: () => void;
}) {
  const [asNew, setAsNew] = useState(false);
  const [newName, setNewName] = useState('Shared list');

  return (
    <div className="sheet-backdrop" onClick={onCancel}>
      <div className="sheet" role="dialog" aria-label="Shared with you" onClick={(e) => e.stopPropagation()}>
        {share === 'error' ? (
          <>
            <h2>This link didn’t work</h2>
            <p className="muted small">It may have been cut off when it was sent. Ask for it to be shared again.</p>
            <div className="sheet-actions"><span style={{ flex: 1 }} /><button className="btn" onClick={onCancel}>OK</button></div>
          </>
        ) : share.kind === 'list' ? (
          <ListImport
            items={share.items}
            currentListName={currentListName}
            asNew={asNew}
            setAsNew={setAsNew}
            newName={newName}
            setNewName={setNewName}
            onAddList={onAddList}
            onCancel={onCancel}
          />
        ) : share.kind === 'store' ? (
          <StoreImport share={share} layouts={layouts} onAddStore={onAddStore} onCancel={onCancel} />
        ) : (
          <BothImport
            share={share}
            layouts={layouts}
            currentListName={currentListName}
            asNew={asNew}
            setAsNew={setAsNew}
            newName={newName}
            setNewName={setNewName}
            onAddBoth={onAddBoth}
            onCancel={onCancel}
          />
        )}
      </div>
    </div>
  );
}

function ListImport({ items, currentListName, asNew, setAsNew, newName, setNewName, onAddList, onCancel }: {
  items: { name: string }[];
  currentListName: string;
  asNew: boolean;
  setAsNew: (v: boolean) => void;
  newName: string;
  setNewName: (v: string) => void;
  onAddList: (target: 'current' | { newName: string }) => void;
  onCancel: () => void;
}) {
  return (
    <>
      <h2>A shopping list was shared with you</h2>
      <p className="muted small">{items.length} item{items.length === 1 ? '' : 's'}. Items already on the chosen list are skipped.</p>
      <ul className="preview">
        {items.slice(0, 12).map((i) => <li key={i.name}>{i.name}</li>)}
        {items.length > 12 && <li className="muted">and {items.length - 12} more</li>}
      </ul>
      {asNew ? (
        <form className="add-row" onSubmit={(e) => {
          e.preventDefault();
          onAddList({ newName: newName.trim() || 'Shared list' });
        }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New list name" autoFocus />
          <button type="submit" className="btn primary" disabled={!items.length}>Create list</button>
        </form>
      ) : (
        <div className="sheet-actions wrap">
          <button className="btn" onClick={onCancel}>Not now</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setAsNew(true)} disabled={!items.length}>New list…</button>
          <button className="btn primary" onClick={() => onAddList('current')} disabled={!items.length}>
            Add to “{currentListName}”
          </button>
        </div>
      )}
      {asNew && (
        <div className="sheet-actions">
          <button className="btn" onClick={() => setAsNew(false)}>Back</button>
        </div>
      )}
    </>
  );
}

function StoreImport({ share, layouts, onAddStore, onCancel }: {
  share: StoreShare;
  layouts: StoreLayout[];
  onAddStore: (replaceId?: string) => void;
  onCancel: () => void;
}) {
  const mine = layouts.find((l) => l.id === share.layout.id);
  const located = share.items.filter((i) => i.at).length;
  const unavailable = share.items.filter((i) => i.notAvailable).length;
  return (
    <>
      <h2>A store was shared with you</h2>
      <p><b>{share.layout.name}</b></p>
      <p className="muted small">
        {share.layout.places.length} shelves and areas · {located} item location{located === 1 ? '' : 's'}
        {unavailable > 0 && <> · {unavailable} item{unavailable === 1 ? '' : 's'} not available there</>}
      </p>
      {mine && (
        <p className="muted small">
          You already have this store as “{mine.name}”. Updating replaces its layout and item locations with the shared ones.
        </p>
      )}
      <div className="sheet-actions wrap">
        <button className="btn" onClick={onCancel}>Not now</button>
        <span style={{ flex: 1 }} />
        {mine && <button className="btn" onClick={() => onAddStore()}>Add as new store</button>}
        <button className="btn primary" onClick={() => onAddStore(mine?.id)}>{mine ? `Update “${mine.name}”` : 'Add store'}</button>
      </div>
    </>
  );
}

function BothImport({ share, layouts, currentListName, asNew, setAsNew, newName, setNewName, onAddBoth, onCancel }: {
  share: BothShare;
  layouts: StoreLayout[];
  currentListName: string;
  asNew: boolean;
  setAsNew: (v: boolean) => void;
  newName: string;
  setNewName: (v: string) => void;
  onAddBoth: (opts: { listTarget: 'current' | { newName: string }; replaceStoreId?: string }) => void;
  onCancel: () => void;
}) {
  const mine = layouts.find((l) => l.id === share.store.layout.id);
  const [replaceExisting, setReplaceExisting] = useState(!!mine);
  const listItems = share.list.items;
  const store = share.store;
  const located = store.items.filter((i) => i.at).length;

  function commit(listTarget: 'current' | { newName: string }) {
    onAddBoth({
      listTarget,
      replaceStoreId: mine && replaceExisting ? mine.id : undefined,
    });
  }

  return (
    <>
      <h2>A list and a store were shared with you</h2>
      <p className="muted small">
        <b>{store.layout.name}</b>
        {' · '}
        {store.layout.places.length} shelves and areas · {located} item location{located === 1 ? '' : 's'}
        {' · '}
        {listItems.length} list item{listItems.length === 1 ? '' : 's'}
      </p>
      <ul className="preview">
        {listItems.slice(0, 8).map((i) => <li key={i.name}>{i.name}</li>)}
        {listItems.length > 8 && <li className="muted">and {listItems.length - 8} more</li>}
      </ul>
      {mine && (
        <label className="check share-option">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
          />
          <span className="muted small">
            Update your existing “{mine.name}” (otherwise add as a new store)
          </span>
        </label>
      )}
      {asNew ? (
        <form className="add-row" onSubmit={(e) => {
          e.preventDefault();
          commit({ newName: newName.trim() || 'Shared list' });
        }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New list name" autoFocus />
          <button type="submit" className="btn primary">Add store and create list</button>
        </form>
      ) : (
        <div className="sheet-actions wrap">
          <button className="btn" onClick={onCancel}>Not now</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => setAsNew(true)}>New list…</button>
          <button className="btn primary" onClick={() => commit('current')}>
            Add{mine && replaceExisting ? ` · update “${mine.name}”` : ' store'} · onto “{currentListName}”
          </button>
        </div>
      )}
      {asNew && (
        <div className="sheet-actions">
          <button className="btn" onClick={() => setAsNew(false)}>Back</button>
        </div>
      )}
    </>
  );
}
