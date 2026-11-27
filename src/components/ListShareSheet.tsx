import { useEffect, useState } from 'react';
import type { Catalog } from '../core/catalog';
import type { ListItem, ShoppingList, StoreLayout } from '../core/types';
import type { Member } from '../sync/members';
import { sortMembers } from '../sync/members';
import type { HouseholdApi } from '../sync/useHousehold';
import { HouseholdAccount, InviteButton, STATUS_TEXT } from './HouseholdSheet';
import { Icon } from './Icon';
import { CopyPanel } from './ShareSheets';

/**
 * Sharing for one list: keep it in sync with the household, or (quietly, at the
 * bottom) send a one-time copy. Setting up an account only comes up when the
 * person actually asks to share live.
 */
export function ListShareSheet({ list, items, layout, catalog, api, onSetShared, onManageHousehold, onClose }: {
  list: ShoppingList;
  /** This list’s items (for a copy). */
  items: ListItem[];
  layout: StoreLayout;
  catalog: Catalog;
  api: HouseholdApi;
  onSetShared: (shared: boolean) => void;
  /** Opens the household screen (members, invite code, sign out…). */
  onManageHousehold: () => void;
  onClose: () => void;
}) {
  const shared = list.shared === true;
  const household = api.household;
  const live = api.configured && !!household;
  const [settingUp, setSettingUp] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  // Without live sharing there’s nothing else to offer, so show the copy options straight away.
  const [showCopy, setShowCopy] = useState(!api.configured);
  const [members, setMembers] = useState<Member[]>([]);

  // Once the account steps finish, finish what the person asked for.
  useEffect(() => {
    if (settingUp && household) {
      setSettingUp(false);
      if (!shared) onSetShared(true);
    }
  }, [settingUp, household, shared, onSetShared]);

  const { members: loadMembers } = api;
  useEffect(() => {
    if (!live || !shared) return;
    void loadMembers().then(setMembers);
  }, [live, shared, loadMembers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet household" role="dialog" aria-label={`Share ${list.name}`} onClick={(e) => e.stopPropagation()}>
        <h2>Share “{list.name}”</h2>

        {api.configured && (
          <div className="card inset list-share-live">
            {live ? (
              <>
                <label className="check share-option">
                  <input
                    type="checkbox"
                    checked={shared}
                    onChange={(e) => (e.target.checked ? onSetShared(true) : setConfirmOff(true))}
                  />
                  <span>
                    <span className="share-option-title">Share with {household!.name}</span>
                    <span className="muted small">
                      {shared
                        ? ' Everyone in the household sees and edits this list live.'
                        : ' Keep this list in sync on everyone’s phone. Your other lists stay private.'}
                    </span>
                  </span>
                </label>
                {confirmOff && (
                  <div className="list-confirm">
                    <p className="small">
                      Stop sharing “{list.name}”? Everyone keeps their own copy, but changes stop syncing.
                      Sharing it again later merges the copies.
                    </p>
                    <div className="sheet-actions">
                      <button className="btn" onClick={() => setConfirmOff(false)}>Keep sharing</button>
                      <span style={{ flex: 1 }} />
                      <button className="btn danger" onClick={() => { setConfirmOff(false); onSetShared(false); }}>Stop sharing</button>
                    </div>
                  </div>
                )}
                {shared && !confirmOff && (
                  <>
                    <p className={`small status-text status-${api.status}`}>
                      <span className="dot" aria-hidden="true" /> {STATUS_TEXT[api.status]}
                    </p>
                    {members.length > 0 && (
                      <p className="muted small share-members">
                        <Icon name="users" /> {sortMembers(members).map((m) => (m.userId === api.userId ? 'You' : m.email)).join(', ')}
                      </p>
                    )}
                    <InviteButton code={household!.invite_code} className="btn wide" />
                  </>
                )}
                <button type="button" className="link" onClick={onManageHousehold}>Household settings…</button>
              </>
            ) : settingUp ? (
              <>
                <HouseholdAccount api={api} />
                <button type="button" className="link" onClick={() => setSettingUp(false)}>Not now</button>
              </>
            ) : (
              <>
                <p className="small">
                  <b>Keep this list in sync with your household.</b>{' '}
                  <span className="muted">Everyone you invite sees changes live. It needs a free account.</span>
                </p>
                <button type="button" className="btn primary wide" onClick={() => setSettingUp(true)}>
                  <Icon name="users" /> Share with household…
                </button>
              </>
            )}
          </div>
        )}

        {showCopy ? (
          <>
            {api.configured && <h3>Send a copy</h3>}
            <CopyPanel
              listName={list.name}
              items={items}
              layout={layout}
              catalog={catalog}
              initial={{ list: true, map: false }}
            />
          </>
        ) : (
          <button type="button" className="link" onClick={() => setShowCopy(true)}>
            Send a copy instead… <span className="muted small">(a one-time link, doesn’t stay in sync)</span>
          </button>
        )}

        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
