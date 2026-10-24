import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePersistentState } from '../usePersistentState';
import { SyncEngine, type SyncData, type SyncStatus } from './engine';
import { supabase, supabaseRemote, type Household } from './supabase';

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
  const engine = useRef<SyncEngine | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const setRef = useRef(setData);
  setRef.current = setData;

  // Track sign-in.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data: d }) => setSession(d.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
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

  const sendCode = useCallback(async (email: string) => {
    const { error } = await requireClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}${location.pathname}` },
    });
    if (error) throw error;
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error } = await requireClient().auth.verifyOtp({ email, token: code.trim(), type: 'email' });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    engine.current?.stop();
    setHousehold(null);
    await requireClient().auth.signOut();
  }, [setHousehold]);

  const create = useCallback(async (name: string) => {
    const { data: h, error } = await requireClient().rpc('create_household', { p_name: name });
    if (error) throw error;
    setHousehold(h as Household);
  }, [setHousehold]);

  const join = useCallback(async (code: string) => {
    const { data: h, error } = await requireClient().rpc('join_household', { p_code: code });
    if (error) throw error;
    setHousehold(h as Household);
  }, [setHousehold]);

  const leave = useCallback(async () => {
    const client = requireClient();
    if (!household || !userId) return;
    const { error } = await client.from('household_members').delete()
      .eq('household_id', household.id).eq('user_id', userId);
    if (error) throw error;
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
    sendCode,
    verifyCode,
    signOut,
    create,
    join,
    leave,
    members,
  };
}

export type HouseholdApi = ReturnType<typeof useHousehold>;
