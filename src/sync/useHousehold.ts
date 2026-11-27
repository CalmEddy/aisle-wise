import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistentState } from '../usePersistentState';
import { SyncEngine, type SyncData, type SyncStatus } from './engine';
import { passwordProblem, MIN_PASSWORD } from './password';
import { openedFromAuthLink, supabase, supabaseRemote, supabaseUrl, type Household } from './supabase';
import { EXPIRED_LINK_MESSAGE } from './url';

export type HouseholdStatus = SyncStatus | 'off';

function deviceId(): string {
  try {
    let id = localStorage.getItem('aw.device');
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      localStorage.setItem('aw.device', id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

function loadShadow(householdId: string): Record<string, string> | undefined {
  try {
    return JSON.parse(localStorage.getItem(`aw.shadow.${householdId}`) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

/** Sign-in, household membership, and live sync of the shared data. */
export function useHousehold(data: SyncData, setData: (d: SyncData) => void) {
  const [session, setSession] = useState<Session | null>(null);
  const [household, setHousehold] = usePersistentState<Household | null>('aw.household', null);
  const [status, setStatus] = useState<HouseholdStatus>('off');
  // The database setup is older than this app: list names can't sync until it's re-run.
  const [needsDbUpdate, setNeedsDbUpdate] = useState(false);
  // Opened from a password-reset email link: the person is signed in just long enough to pick a new password.
  const [recovering, setRecovering] = useState(openedFromAuthLink.recovery);
  // An email link that didn't work (expired, or used up by an email scanner).
  const [linkProblem, setLinkProblem] = useState(openedFromAuthLink.problem ?? '');
  const [passwordChanged, setPasswordChanged] = useState(false);
  const engine = useRef<SyncEngine | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const setRef = useRef(setData);
  setRef.current = setData;

  // Track sign-in.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: d }) => {
      setSession(d.session);
      // Don't leave a used-up or invalid token sitting in the address bar.
      if (openedFromAuthLink.recovery || openedFromAuthLink.problem) {
        history.replaceState(null, '', location.pathname + location.search);
      }
      // The reset link was read but didn't give a session: it was invalid.
      if (!d.session && openedFromAuthLink.recovery) {
        setRecovering(false);
        setLinkProblem(EXPIRED_LINK_MESSAGE);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Confirm (or discover) this account's household once signed in.
  useEffect(() => {
    if (!supabase || !session) return;
    supabase.from('households').select('id, name, invite_code').limit(1).then(({ data: rows, error }) => {
      if (error) return; // offline: keep what we had
      setHousehold(rows?.[0] ?? null);
    });
  }, [session, setHousehold]);

  // Run the sync engine while signed in to a household.
  const userId = session?.user.id;
  const householdId = household?.id;
  useEffect(() => {
    if (!supabase || !userId || !householdId) {
      setStatus('off');
      return;
    }
    const e = new SyncEngine(
      supabaseRemote(supabase, householdId),
      deviceId(),
      () => dataRef.current,
      (d) => {
        dataRef.current = d;
        setRef.current(d);
      },
      {
        onStatus: setStatus,
        onRefused: (kinds) => setNeedsDbUpdate(kinds.length > 0),
        shadow: loadShadow(householdId),
        saveShadow: (s) => {
          try {
            localStorage.setItem(`aw.shadow.${householdId}`, JSON.stringify(s));
          } catch {
            // Storage full or blocked: sync still works, just not across restarts.
          }
        },
      },
    );
    engine.current = e;
    setStatus('connecting');
    void e.start();
    return () => {
      e.stop();
      engine.current = null;
    };
  }, [userId, householdId]);

  // Send local changes.
  useEffect(() => {
    engine.current?.changed();
  }, [data]);

  const requireClient = () => {
    if (!supabase) throw new Error('Live sharing isn’t set up for this app yet.');
    return supabase;
  };

  /** Signs in with email and password. */
  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireClient().auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendly(error.message));
  }, []);

  /**
   * Creates an account. Returns true when the user still has to confirm their
   * email (only if "Confirm email" is left on in Supabase).
   */
  const signUp = useCallback(async (email: string, password: string): Promise<boolean> => {
    const { data: d, error } = await requireClient().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: appAddress() },
    });
    if (error) throw new Error(friendly(error.message));
    // Supabase hides whether an address is taken: it returns a user with no identities.
    if (d.user && d.user.identities?.length === 0) throw new Error('That email already has an account. Sign in instead.');
    return !d.session;
  }, []);

  /** Emails a link for choosing a new password. Supabase doesn't say whether the address has an account. */
  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await requireClient().auth.resetPasswordForEmail(email, { redirectTo: appAddress() });
    if (error) throw new Error(friendly(error.message));
  }, []);

  /** Chooses a new password (after following a reset link). */
  const setNewPassword = useCallback(async (password: string) => {
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);
    const { error } = await requireClient().auth.updateUser({ password });
    if (error) throw new Error(friendly(error.message));
    setRecovering(false);
    setPasswordChanged(true);
  }, []);

  const dismissLinkProblem = useCallback(() => setLinkProblem(''), []);

  /** Sends the confirmation email again (the first may have been lost or gone to spam). */
  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await requireClient().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: appAddress() },
    });
    if (error) throw new Error(friendly(error.message));
  }, []);

  const signOut = useCallback(async () => {
    engine.current?.stop();
    setHousehold(null);
    setRecovering(false);
    setPasswordChanged(false);
    await requireClient().auth.signOut();
  }, [setHousehold]);

  const create = useCallback(async (name: string) => {
    const { data: h, error } = await requireClient().rpc('create_household', { p_name: name });
    if (error) throw error;
    setHousehold(h as Household);
  }, [setHousehold]);

  const join = useCallback(async (code: string) => {
    const { data: h, error } = await requireClient().rpc('join_household', { p_code: code });
    if (error) throw new Error(error.message);
    // A wrong code comes back empty (the database remembers wrong guesses, which an error would undo).
    if (!h || !(h as Household).id) throw new Error('No household has that invite code.');
    setHousehold(h as Household);
  }, [setHousehold]);

  const leave = useCallback(async () => {
    const client = requireClient();
    if (!household || !userId) return;
    const { error } = await client.rpc('leave_household', { p_household: household.id });
    // A database that hasn't had the hardening migration yet still lets members delete their own row.
    if (error && isMissingFunction(error)) {
      const old = await client.from('household_members').delete()
        .eq('household_id', household.id).eq('user_id', userId);
      if (old.error) throw new Error(old.error.message);
    } else if (error) {
      throw new Error(error.message);
    }
    try {
      localStorage.removeItem(`aw.shadow.${household.id}`);
    } catch {
      // ignore
    }
    setHousehold(null);
  }, [household, userId, setHousehold]);

  const members = useCallback(async (): Promise<string[]> => {
    if (!supabase || !household) return [];
    const { data: rows } = await supabase.from('household_members').select('email').eq('household_id', household.id);
    return (rows ?? []).map((r) => r.email ?? 'Someone');
  }, [household]);

  return {
    configured: !!supabase,
    email: session?.user.email,
    signedIn: !!session,
    household,
    status,
    needsDbUpdate,
    signIn,
    signUp,
    sendPasswordReset,
    setNewPassword,
    recovering,
    passwordChanged,
    linkProblem,
    dismissLinkProblem,
    resendConfirmation,
    signOut,
    create,
    join,
    leave,
    members,
  };
}

export type HouseholdApi = ReturnType<typeof useHousehold>;

/** The database doesn't have this function yet (its setup is older than this app). */
function isMissingFunction(e: { code?: string }): boolean {
  return e.code === 'PGRST202' || e.code === '42883';
}

/** Where the confirmation link should land: this app, without any invite or share fragment. */
function appAddress(): string {
  return `${location.origin}${location.pathname}`;
}

/** Plain-language versions of Supabase's sign-in errors. */
function friendly(message: string): string {
  const checkUrl = `Check that the SUPABASE_URL variable in GitHub is just your Project URL (like https://abcd.supabase.co), then run the deploy again. This app is using: ${supabaseUrl}`;
  if (/invalid path specified/i.test(message)) return `Supabase didn’t recognise the app’s address. ${checkUrl}`;
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return navigator.onLine ? `Couldn’t reach Supabase. ${checkUrl}` : 'You’re offline. Try again when you have signal.';
  }
  if (/invalid api key|no api key/i.test(message)) {
    return 'Supabase rejected the app’s key. Check that the SUPABASE_ANON_KEY variable in GitHub is the “anon public” key (it starts with eyJ), then run the deploy again.';
  }
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match.';
  if (/email not confirmed/i.test(message)) return 'This account’s email hasn’t been confirmed yet.';
  if (/already registered|already exists/i.test(message)) return 'That email already has an account. Sign in instead.';
  if (/password should be at least/i.test(message)) return `Use a password with at least ${MIN_PASSWORD} characters.`;
  if (/different from the old password/i.test(message)) return 'Choose a password you haven’t used for this account before.';
  if (/weak|easy to guess|pwned|known to be/i.test(message)) return 'That password is too easy to guess. Pick a longer or less common one.';
  const wait = /only request this after (\d+) seconds?/i.exec(message)?.[1];
  if (wait) return `Please wait ${wait} seconds before asking again.`;
  if (/auth session missing/i.test(message)) return 'That reset link has expired. Ask for a new one from the sign-in screen.';
  if (/error sending (confirmation|recovery|magic link|email)/i.test(message)) {
    return 'The confirmation email couldn’t be sent. This is a problem with the app’s email setup (Supabase → Authentication → Emails → SMTP Settings), not with your address. Try again later.';
  }
  if (/rate limit/i.test(message)) return 'Too many tries. Wait a minute and try again.';
  return message;
}
