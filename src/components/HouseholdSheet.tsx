import { useEffect, useState } from 'react';
import type { HouseholdApi } from '../sync/useHousehold';

const STATUS_TEXT = {
  off: 'Not shared',
  connecting: 'Connecting…',
  synced: 'Up to date',
  saving: 'Saving…',
  offline: 'Offline – will catch up',
} as const;

/** Small header button showing whether the household is in sync. */
export function HouseholdButton({ api, onClick }: { api: HouseholdApi; onClick: () => void }) {
  const live = !!api.household && api.status !== 'off';
  return (
    <button className={`household-pill status-${live ? api.status : 'off'}`} onClick={onClick}>
      <span className="dot" aria-hidden="true" />
      {live ? `${api.household!.name} · ${STATUS_TEXT[api.status]}` : 'Share with household'}
    </button>
  );
}

export function HouseholdSheet({ api, joinCode, onClose }: { api: HouseholdApi; joinCode?: string; onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet household" role="dialog" aria-label="Household" onClick={(e) => e.stopPropagation()}>
        {!api.configured ? (
          <NotConfigured />
        ) : !api.signedIn ? (
          <SignIn api={api} joining={!!joinCode} />
        ) : !api.household ? (
          <CreateOrJoin api={api} joinCode={joinCode} />
        ) : (
          <InHousehold api={api} />
        )}
        <div className="sheet-actions">
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
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
  const { busy, error, run } = useAction();
  const creating = mode === 'signup';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice('');
    void run(async () => {
      if (!creating) return api.signIn(email.trim(), password);
      const mustConfirm = await api.signUp(email.trim(), password);
      if (mustConfirm) {
        setNotice('Account created. Confirm it from the email Supabase sent, then sign in here.');
        setMode('signin');
      }
    });
  }

  return (
    <>
      <h2>{joining ? 'Join a household' : 'Share with your household'}</h2>
      <p className="muted small">
        Everyone in a household shares one shopping list, grocery items and stores. Changes show up on
        everyone’s phone as you shop. {joining ? 'Sign in first, then you’ll join.' : ''}
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
          <span>Password{creating && ' (at least 6 characters)'}</span>
          <div className="password-row">
            <input
              type={show ? 'text' : 'password'}
              autoComplete={creating ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
            <button type="button" className="btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <button className="btn primary wide" disabled={busy || !email.includes('@') || password.length < 6}>
          {busy ? 'One moment…' : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>
      {notice && <p className="small">{notice}</p>}
      {error && <p className="error">{error}</p>}
      {!creating && (
        <p className="muted small">
          Forgot your password? Create a new account and rejoin with your household’s invite code – the shared list
          lives in the household, so nothing is lost.
        </p>
      )}
    </>
  );
}

function CreateOrJoin({ api, joinCode }: { api: HouseholdApi; joinCode?: string }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(joinCode ?? '');
  const { busy, error, run } = useAction();

  return (
    <>
      <h2>{joinCode ? 'Join the household' : 'Share with your household'}</h2>
      <p className="muted small">Signed in as {api.email}. Your current list, items and stores will be added to the household.</p>
      <form className="card inset" onSubmit={(e) => { e.preventDefault(); void run(() => api.join(code)); }}>
        <h3>Join with an invite code</h3>
        <div className="add-row">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. 7F3A9C21" aria-label="Invite code" autoCapitalize="characters" />
          <button disabled={busy || code.trim().length < 6}>Join</button>
        </div>
      </form>
      {!joinCode && (
        <form className="card inset" onSubmit={(e) => { e.preventDefault(); void run(() => api.create(name)); }}>
          <h3>Or start a new household</h3>
          <div className="add-row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. The Smiths" aria-label="Household name" />
            <button disabled={busy}>Create</button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <button className="link" onClick={() => void run(api.signOut)}>Sign out</button>
    </>
  );
}

function InHousehold({ api }: { api: HouseholdApi }) {
  const h = api.household!;
  const [members, setMembers] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const { busy, error, run } = useAction();
  const link = `${location.origin}${location.pathname}#join=${h.invite_code}`;

  useEffect(() => {
    void api.members().then(setMembers);
  }, [api]);

  async function invite() {
    const text = `Join our shopping list in Aisle Wise. Invite code: ${h.invite_code}`;
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

  return (
    <>
      <h2>{h.name}</h2>
      <p className={`small status-text status-${api.status}`}><span className="dot" aria-hidden="true" /> {STATUS_TEXT[api.status]}</p>
      <p className="muted small">Your lists, grocery items and stores are shared with everyone here and update live.</p>
      {api.needsDbUpdate && (
        <p className="card inset problems small">
          <b>List names aren’t syncing yet.</b> Your household’s database needs the latest setup: open Supabase → SQL Editor,
          paste in the setup script (<code>supabase/migrations/20261024000000_households.sql</code>) and run it. It’s safe to run again
          and keeps your data. Everything else is syncing normally.
        </p>
      )}

      <div className="card inset">
        <h3>Invite someone</h3>
        <p className="muted small">They open the link (or enter the code), sign in with their email, and they’re in.</p>
        <div className="invite-code" aria-label="Invite code">{h.invite_code}</div>
        <button className="btn primary wide" onClick={invite}>{copied ? 'Link copied ✓' : 'Send invite link'}</button>
      </div>

      {members.length > 0 && (
        <div className="card inset">
          <h3>Members</h3>
          <ul className="members">{members.map((m) => <li key={m}>{m}{m === api.email ? ' (you)' : ''}</li>)}</ul>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      <div className="sheet-actions">
        <button className="btn danger" disabled={busy} onClick={() => confirm('Leave this household? Your phone keeps a copy of everything, but stops getting updates.') && void run(api.leave)}>
          Leave household
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn" disabled={busy} onClick={() => void run(api.signOut)}>Sign out</button>
      </div>
      <p className="muted small">Signed in as {api.email}</p>
    </>
  );
}
