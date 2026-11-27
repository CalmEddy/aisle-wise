import { useEffect, useState } from 'react';
import {
  DELETE_ACCOUNT_CONFIRM_WORD,
  NEW_CODE_WARNING,
  REMOVE_MEMBER_WARNING,
  isOwner,
  leaveWarning,
  rolesKnown,
  sortMembers,
  type Member,
} from '../sync/members';
import { MAIN_LIST, type ShoppingList } from '../core/types';
import { MIN_PASSWORD } from '../sync/password';
import type { HouseholdApi } from '../sync/useHousehold';
import { Icon } from './Icon';

export const STATUS_TEXT = {
  off: 'Not shared',
  connecting: 'Connecting…',
  synced: 'Up to date',
  saving: 'Saving…',
  offline: 'Offline – will catch up',
} as const;

/** A row showing whether the household is in sync; tap to open the household sheet. */
export function HouseholdRow({ api, onClick }: { api: HouseholdApi; onClick: () => void }) {
  const live = !!api.household && api.status !== 'off';
  return (
    <button
      type="button"
      className={`menu-row household-row status-${live ? api.status : 'off'}`}
      onClick={onClick}
      aria-label={live ? `Household ${api.household!.name}: ${STATUS_TEXT[api.status]}` : 'Household'}
    >
      <span className="dot" aria-hidden="true" />
      <Icon name="users" />
      <span className="household-row-text">
        <b>{live ? api.household!.name : 'Household'}</b>
        <span className="muted small">{live ? STATUS_TEXT[api.status] : 'Share lists live with family or roommates'}</span>
      </span>
      <Icon name="chevron-right" className="chev" />
    </button>
  );
}

export function HouseholdSheet({ api, joinCode, lists, onSetListShared, onClose }: {
  api: HouseholdApi;
  joinCode?: string;
  /** This phone's lists, so the household screen can show and change which are shared. */
  lists: ShoppingList[];
  onSetListShared: (listId: string, shared: boolean) => void;
  onClose: () => void;
}) {
  // Right after creating or joining: offer to share some lists (none are shared by default).
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet household" role="dialog" aria-label="Household" onClick={(e) => e.stopPropagation()}>
        {api.configured && api.linkProblem && (
          <p className="card inset problems small" role="alert">
            {api.linkProblem}{' '}
            <button type="button" className="link" onClick={api.dismissLinkProblem}>Dismiss</button>
          </p>
        )}
        {api.configured && api.passwordChanged && !api.recovering && <p className="small" role="status">Password updated ✓</p>}
        {!api.configured ? (
          <NotConfigured />
        ) : api.recovering ? (
          <SetNewPassword api={api} />
        ) : !api.signedIn ? (
          <SignIn api={api} joining={!!joinCode} />
        ) : !api.household ? (
          <CreateOrJoin api={api} joinCode={joinCode} onDone={() => setChoosing(true)} />
        ) : choosing ? (
          <ShareListsStep
            householdName={api.household.name}
            lists={lists}
            onSetShared={onSetListShared}
            onDone={() => setChoosing(false)}
          />
        ) : (
          <InHousehold api={api} lists={lists} onSetListShared={onSetListShared} />
        )}
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Sign in, then create or join a household. Shown wherever sharing needs an account. */
export function HouseholdAccount({ api, joinCode }: { api: HouseholdApi; joinCode?: string }) {
  if (!api.configured) return <NotConfigured />;
  if (api.recovering) return <SetNewPassword api={api} />;
  if (!api.signedIn) return <SignIn api={api} joining={!!joinCode} />;
  return <CreateOrJoin api={api} joinCode={joinCode} />;
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function NotConfigured() {
  return (
    <>
      <h2>Share with your household</h2>
      <p className="muted small">
        Live sharing isn’t switched on for this copy of Aisle Wise yet. It needs to be connected to a Supabase
        project – see “Live sharing setup” in the README. Until then, use <b>Share</b> to send a copy of your list
        or a store as a link.
      </p>
    </>
  );
}

function SignIn({ api, joining }: { api: HouseholdApi; joining: boolean }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [notice, setNotice] = useState('');
  // Set once an account needs confirming, so the email can be sent again.
  const [pending, setPending] = useState('');
  const [forgot, setForgot] = useState(false);
  const { busy, error, run } = useAction();
  const creating = mode === 'signup';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice('');
    setPending('');
    void run(async () => {
      const address = email.trim();
      try {
        if (!creating) return await api.signIn(address, password);
        const mustConfirm = await api.signUp(address, password);
        if (mustConfirm) {
          setNotice(`We sent a confirmation link to ${address}. Open it (check spam too), then sign in here.`);
          setPending(address);
          setMode('signin');
        }
      } catch (err) {
        if (err instanceof Error && /hasn’t been confirmed/.test(err.message)) setPending(address);
        throw err;
      }
    });
  }

  if (forgot) return <ForgotPassword api={api} initialEmail={email} onBack={() => setForgot(false)} />;

  return (
    <>
      <h2>{joining ? 'You’ve been invited to a household' : 'Household'}</h2>
      <p className="muted small">
        {joining
          ? 'Sign in or create an account, then you’ll join. Your own lists stay private until you choose to share them.'
          : 'A household shares its grocery items and stores, and any lists you choose to share. Changes show up on everyone’s phone as you shop.'}
      </p>
      <div className="segmented" role="tablist">
        <button type="button" className={!creating ? 'active' : ''} onClick={() => setMode('signin')}>Sign in</button>
        <button type="button" className={creating ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
      </div>
      <form onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </label>
        <label className="field">
          <span>Password{creating && ` (at least ${MIN_PASSWORD} characters)`}</span>
          <div className="password-row">
            <input
              type={show ? 'text' : 'password'}
              autoComplete={creating ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={creating ? MIN_PASSWORD : undefined}
              required
            />
            <button type="button" className="btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <button className="btn primary wide" disabled={busy || !email.includes('@') || (creating ? password.length < MIN_PASSWORD : password.length === 0)}>
          {busy ? 'One moment…' : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>
      {notice && <p className="small">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {pending && (
        <button
          type="button"
          className="btn wide"
          disabled={busy}
          onClick={() => void run(async () => {
            await api.resendConfirmation(pending);
            setNotice(`Sent again to ${pending}. It can take a minute to arrive.`);
          })}
        >
          Send the confirmation email again
        </button>
      )}
      {!creating && (
        <button type="button" className="link" onClick={() => setForgot(true)}>Forgot your password?</button>
      )}
    </>
  );
}

/** Asks for an email address and sends a link for choosing a new password. */
function ForgotPassword({ api, initialEmail, onBack }: { api: HouseholdApi; initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [sentTo, setSentTo] = useState('');
  const { busy, error, run } = useAction();
  const send = () => run(async () => {
    const address = email.trim();
    await api.sendPasswordReset(address);
    setSentTo(address);
  });

  return (
    <>
      <h2>Reset your password</h2>
      {sentTo ? (
        <>
          <p className="small">
            If there’s an account for <b>{sentTo}</b>, we’ve emailed it a link for choosing a new password. Open the link
            on this phone or computer (check spam too). It works once and expires after a while.
          </p>
          <button type="button" className="btn wide" disabled={busy} onClick={() => void send()}>Send it again</button>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <p className="muted small">Enter the email you signed up with and we’ll send a link.</p>
          <label className="field">
            <span>Email</span>
            <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </label>
          <button className="btn primary wide" disabled={busy || !email.includes('@')}>
            {busy ? 'One moment…' : 'Send reset link'}
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <button type="button" className="link" onClick={onBack}>Back to sign in</button>
    </>
  );
}

/** Shown after following a reset link: choose a new password. */
function SetNewPassword({ api }: { api: HouseholdApi }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const { busy, error, run } = useAction();

  if (!api.signedIn) {
    // The link is still being read (or turned out not to work, which clears this screen).
    return <p className="muted small">Checking your reset link…</p>;
  }
  return (
    <>
      <h2>Choose a new password</h2>
      <p className="muted small">Signed in as {api.email}. Pick a password you’ll use from now on.</p>
      <form onSubmit={(e) => { e.preventDefault(); void run(() => api.setNewPassword(password)); }}>
        <label className="field">
          <span>New password (at least {MIN_PASSWORD} characters)</span>
          <div className="password-row">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={MIN_PASSWORD}
              required
            />
            <button type="button" className="btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <button className="btn primary wide" disabled={busy || password.length < MIN_PASSWORD}>
          {busy ? 'One moment…' : 'Save new password'}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </>
  );
}

function CreateOrJoin({ api, joinCode, onDone }: { api: HouseholdApi; joinCode?: string; onDone?: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(joinCode ?? '');
  const { busy, error, run } = useAction();

  return (
    <>
      <h2>{joinCode ? 'Join the household' : 'Household'}</h2>
      <p className="muted small">
        Signed in as {api.email}. Your stores and grocery items will be added to the household.
        Your lists stay private until you choose to share them.
      </p>
      <form className="card inset" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.join(code); onDone?.(); }); }}>
        <h3>Join with an invite code</h3>
        <div className="add-row">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. 7F3A9C21B4D05E68" aria-label="Invite code" autoCapitalize="characters" />
          <button disabled={busy || code.trim().length < 6}>Join</button>
        </div>
      </form>
      {!joinCode && (
        <form className="card inset" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api.create(name); onDone?.(); }); }}>
          <h3>Or start a new household</h3>
          <div className="add-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Smiths" aria-label="Household name" />
            <button disabled={busy}>Create</button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <button className="link" onClick={() => void run(api.signOut)}>Sign out</button>
      <DeleteAccount api={api} />
    </>
  );
}

/** Shares (or copies) the link that lets someone join the household. */
export function InviteButton({ code, className = 'btn primary wide' }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  // A new code means the old "copied" no longer applies.
  useEffect(() => setCopied(false), [code]);

  async function invite() {
    const link = `${location.origin}${location.pathname}#join=${code}`;
    const text = `Join our shopping list in Aisle Wise. Invite code: ${code}`;
    if ('share' in navigator) {
      try {
        await navigator.share({ title: 'Join our household on Aisle Wise', text, url: link });
        return;
      } catch {
        // cancelled – fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // ignore
    }
  }

  return <button type="button" className={className} onClick={invite}>{copied ? 'Link copied ✓' : 'Send invite link'}</button>;
}

/** One checkbox per list. Lists are private unless ticked. */
function ListChecks({ lists, checked, onToggle }: {
  lists: ShoppingList[];
  checked: (l: ShoppingList) => boolean;
  onToggle: (l: ShoppingList, on: boolean) => void;
}) {
  return (
    <div className="share-options" role="group" aria-label="Lists">
      {lists.map((l) => (
        <label key={l.id} className="check share-option">
          <input type="checkbox" checked={checked(l)} onChange={(e) => onToggle(l, e.target.checked)} />
          <span>
            <span className="share-option-title">{l.name}</span>
            {l.id === MAIN_LIST && (
              <span className="muted small"> Joins the household’s “Shopping list” if it has one, combining the items.</span>
            )}
          </span>
        </label>
      ))}
    </div>
  );
}

/** Right after creating or joining a household: choose which lists to share (none by default). */
export function ShareListsStep({ householdName, lists, onSetShared, onDone }: {
  householdName: string;
  lists: ShoppingList[];
  onSetShared: (listId: string, shared: boolean) => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  return (
    <>
      <h2>Share any of your lists?</h2>
      <p className="muted small">
        You’re in {householdName}. Only the lists you tick are shared with it. Your others stay private,
        and you can change this any time from a list’s Share button.
      </p>
      <ListChecks
        lists={lists}
        checked={(l) => picked.has(l.id)}
        onToggle={(l, on) => setPicked((prev) => {
          const next = new Set(prev);
          if (on) next.add(l.id);
          else next.delete(l.id);
          return next;
        })}
      />
      <button
        type="button"
        className="btn primary wide"
        onClick={() => {
          picked.forEach((id) => onSetShared(id, true));
          onDone();
        }}
      >
        {picked.size ? `Share ${picked.size} list${picked.size === 1 ? '' : 's'}` : 'Skip for now'}
      </button>
    </>
  );
}

/** The household screen’s view of which lists are shared, with a switch for each. */
export function SharedListsCard({ lists, onSetShared }: {
  lists: ShoppingList[];
  onSetShared: (listId: string, shared: boolean) => void;
}) {
  if (lists.length === 0) return null;
  return (
    <div className="card inset">
      <h3>Shared lists</h3>
      <p className="muted small">Only ticked lists sync with this household. The rest stay on your phone.</p>
      <ListChecks
        lists={lists}
        checked={(l) => l.shared === true}
        onToggle={(l, on) => {
          if (!on && !confirm(`Stop sharing “${l.name}”? Everyone keeps their own copy, but changes stop syncing.`)) return;
          onSetShared(l.id, on);
        }}
      />
    </div>
  );
}

/** Who is in the household; owners also get a Remove button next to everyone else. */
export function MembersCard({ members, myId, canRemove, busy, onRemove }: {
  members: Member[];
  myId: string | undefined;
  canRemove: boolean;
  busy: boolean;
  onRemove: (m: Member) => void;
}) {
  if (members.length === 0) return null;
  return (
    <div className="card inset">
      <h3>Members</h3>
      <ul className="members">
        {sortMembers(members).map((m) => (
          <li key={m.userId}>
            <span>
              {m.email}{m.userId === myId ? ' (you)' : ''}
              {m.role === 'owner' && <span className="muted small"> · Owner</span>}
            </span>
            {canRemove && m.userId !== myId && (
              <button type="button" className="btn small danger" disabled={busy} onClick={() => onRemove(m)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Erases the account, after typing a confirmation word. */
function DeleteAccount({ api }: { api: HouseholdApi }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const { busy, error, run } = useAction();

  if (!open) {
    return <button className="link" onClick={() => setOpen(true)}>Delete my account…</button>;
  }
  return (
    <form
      className="card inset"
      onSubmit={(e) => {
        e.preventDefault();
        if (word.trim().toUpperCase() === DELETE_ACCOUNT_CONFIRM_WORD) void run(api.deleteAccount);
      }}
    >
      <h3>Delete my account</h3>
      <p className="muted small">
        This erases your login for good. If other people are in your household, it stays with them (the longest-standing
        member becomes its owner). If you’re the only one, the household and its shared data are deleted. Your phone
        keeps its own copy of your lists.
      </p>
      <label className="field">
        <span>Type {DELETE_ACCOUNT_CONFIRM_WORD} to confirm</span>
        <input value={word} onChange={(e) => setWord(e.target.value)} autoCapitalize="characters" autoComplete="off" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => { setOpen(false); setWord(''); }}>Cancel</button>
        <span style={{ flex: 1 }} />
        <button className="btn danger" disabled={busy || word.trim().toUpperCase() !== DELETE_ACCOUNT_CONFIRM_WORD}>
          {busy ? 'One moment…' : 'Delete my account'}
        </button>
      </div>
    </form>
  );
}

function InHousehold({ api, lists, onSetListShared }: {
  api: HouseholdApi;
  lists: ShoppingList[];
  onSetListShared: (listId: string, shared: boolean) => void;
}) {
  const h = api.household!;
  const [members, setMembers] = useState<Member[]>([]);
  const [refresh, setRefresh] = useState(0);
  const { busy, error, run } = useAction();

  const { members: loadMembers } = api;
  useEffect(() => {
    void loadMembers().then(setMembers);
  }, [loadMembers, refresh]);

  // Owner buttons only make sense once the database knows about owners.
  const owner = rolesKnown(members) && isOwner(members, api.userId);

  return (
    <>
      <h2>{h.name}</h2>
      <p className={`small status-text status-${api.status}`}><span className="dot" aria-hidden="true" /> {STATUS_TEXT[api.status]}</p>
      <p className="muted small">Grocery items and stores are shared with everyone here and update live. Lists sync only when you share them.</p>
      {api.needsDbUpdate && (
        <p className="card inset problems small">
          <b>List names aren’t syncing yet.</b> Your household’s database needs the latest setup: open Supabase → SQL Editor,
          run the files in <code>supabase/migrations</code> in order. It’s safe to run again
          and keeps your data. Everything else is syncing normally.
        </p>
      )}

      <SharedListsCard lists={lists} onSetShared={onSetListShared} />

      <div className="card inset">
        <h3>Invite someone</h3>
        <p className="muted small">They open the link (or enter the code), sign in with their email, and they’re in.</p>
        <div className="invite-code" aria-label="Invite code">{h.invite_code}</div>
        <InviteButton code={h.invite_code} />
        {owner && (
          <button
            className="link"
            disabled={busy}
            onClick={() => confirm(NEW_CODE_WARNING) && void run(async () => { await api.rotateInviteCode(); })}
          >
            Make a new invite code
          </button>
        )}
      </div>

      <MembersCard
        members={members}
        myId={api.userId}
        canRemove={owner}
        busy={busy}
        onRemove={(m) => confirm(REMOVE_MEMBER_WARNING(m.email)) && void run(async () => {
          await api.removeMember(m.userId);
          setRefresh((n) => n + 1);
        })}
      />

      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <button className="btn danger" disabled={busy} onClick={() => confirm(leaveWarning(members, api.userId)) && void run(api.leave)}>
          Leave household
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={() => void run(api.signOut)}>Sign out</button>
      </div>
      <p className="muted small">Signed in as {api.email}</p>
      <DeleteAccount api={api} />
    </>
  );
}
