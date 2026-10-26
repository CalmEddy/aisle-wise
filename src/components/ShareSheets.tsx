import { useEffect, useState } from 'react';
import { shareUrl, type Share, type StoreShare } from '../core/share';
import type { StoreLayout } from '../core/types';

/** Builds a share link and offers the phone's share menu or copying it. */
export function ShareSheet({ title, summary, share, onClose }: {
  title: string;
  summary: string;
  share: Share;
  onClose: () => void;
}) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  useEffect(() => {
    const base = `${location.origin}${location.pathname}`;
    shareUrl(share, base).then(setUrl).catch(() => setUrl(''));
  }, [share]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked: select the text so it can be copied by hand.
      (document.getElementById('share-url') as HTMLInputElement | null)?.select();
    }
  }

  async function shareNative() {
    try {
      await navigator.share({ title: `Aisle Wise: ${title}`, text: summary, url });
    } catch {
      // Cancelled or unavailable – nothing to do.
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={`Share ${title}`} onClick={(e) => e.stopPropagation()}>
        <h2>Share {title}</h2>
        <p className="muted small">
          {summary} Send this link to anyone who uses Aisle Wise. Opening it adds a copy to their app –
          later changes aren’t synced, so share again to send updates.
        </p>
        <input id="share-url" className="share-url" readOnly value={url || 'Making link…'} onFocus={(e) => e.target.select()} aria-label="Share link" />
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
export function ImportSheet({ share, layouts, onAddList, onAddStore, onCancel }: {
  share: Share | 'error';
  layouts: StoreLayout[];
  onAddList: () => void;
  onAddStore: (replaceId?: string) => void;
  onCancel: () => void;
}) {
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
          <>
            <h2>A shopping list was shared with you</h2>
            <p className="muted small">{share.items.length} item{share.items.length === 1 ? '' : 's'}. Items already on your list are skipped.</p>
            <ul className="preview">
              {share.items.slice(0, 12).map((i) => <li key={i.name}>{i.name}</li>)}
              {share.items.length > 12 && <li className="muted">and {share.items.length - 12} more</li>}
            </ul>
            <div className="sheet-actions">
              <button className="btn" onClick={onCancel}>Not now</button>
              <span style={{ flex: 1 }} />
              <button className="btn primary" onClick={onAddList} disabled={!share.items.length}>Add to my list</button>
            </div>
          </>
        ) : (
          <StoreImport share={share} layouts={layouts} onAddStore={onAddStore} onCancel={onCancel} />
        )}
      </div>
    </div>
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
