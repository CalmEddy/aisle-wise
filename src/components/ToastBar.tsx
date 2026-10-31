import type { QuickAddResult } from '../App';
import type { Catalog } from '../core/catalog';
import { resolveSpot } from '../core/locate';
import type { StoreLayout } from '../core/types';
import { whereText } from './whereText';

export type Toast = QuickAddResult & {
  mode: 'list' | 'cart';
  /** Plain message instead of an add summary. */
  note?: string;
  /** One more thing to do with it ("Somewhere else?"). */
  action?: { label: string; run: () => void };
};


export function ToastBar({ toast, layout, catalog, onUndo, onChange, onMoveHere, onClose }: {
  toast: Toast;
  layout: StoreLayout;
  catalog: Catalog;
  onUndo: () => void;
  onChange: (a: QuickAddResult['added'][number]) => void;
  onMoveHere: (a: QuickAddResult['added'][number]) => void;
  onClose: () => void;
}) {
  const { added, mode } = toast;
  if (toast.note) {
    return (
      <div className="toast" role="status">
        <span className="toast-text">{toast.note}</span>
        {toast.action && <button className="toast-btn" onClick={toast.action.run}>{toast.action.label}</button>}
        <button className="toast-btn" onClick={onUndo}>Undo</button>
        <button className="icon" onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    );
  }
  if (!added.length) return null;

  // Put in the cart away from where it's saved: ask before moving it.
  const clash = added.find((a) => a.conflict);
  if (clash?.conflict) {
    const label = (key: string) => resolveSpot(key, layout, catalog)?.label ?? 'another place';
    const saved = label(clash.conflict.savedKey);
    const here = label(clash.conflict.hereKey);
    return (
      <div className="toast question over-windows" role="alertdialog" aria-label={`Move ${clash.name}?`}>
        <span className="toast-text">
          <b>{clash.name}</b> is in your cart. It’s saved at <b>{saved}</b> — is it here at <b>{here}</b>?
        </span>
        <div className="toast-actions">
          <button className="toast-btn subtle" onClick={onUndo}>Undo</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Keep {saved}</button>
          <button className="btn primary" onClick={() => onMoveHere(clash)}>Move here</button>
        </div>
      </div>
    );
  }

  const one = added.length === 1 ? added[0] : undefined;
  const where = (a: QuickAddResult['added'][number]) => {
    const p = catalog.productById.get(a.productId);
    return p ? whereText(p, layout, catalog) : '';
  };

  let text: React.ReactNode;
  if (!one) text = <>{added.length} items added to your {mode === 'cart' ? 'cart' : 'list'}</>;
  else if (mode === 'cart') text = <><b>{one.name}</b> is in your cart{one.savedAt && <> · saved at {where(one)}</>}</>;
  else if (one.alreadyOnList) text = <><b>{one.name}</b> is already on your list</>;
  else text = <><b>{one.name}</b> added{one.isNew ? ' as a new item' : ''} · {where(one)}</>;

  return (
    <div className="toast" role="status">
      <span className="toast-text">{text}</span>
      {one && <button className="toast-btn" onClick={() => onChange(one)}>Change place</button>}
      <button className="toast-btn" onClick={onUndo}>Undo</button>
      <button className="icon" onClick={onClose} aria-label="Dismiss">×</button>
    </div>
  );
}
