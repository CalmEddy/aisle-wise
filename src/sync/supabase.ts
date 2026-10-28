import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Doc, Kind, Remote } from './engine';
import { normalizeSupabaseUrl } from './url';

const url = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim().replace(/^['"]|['"]$/g, '');

/** The project address this build talks to (shown when something's misconfigured). */
export const supabaseUrl = url;

/** Null when this build has no Supabase settings: the app then works on this phone only. */
export const supabase: SupabaseClient | null = url && key
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export interface Household {
  id: string;
  name: string;
  invite_code: string;
}

interface Row {
  household_id: string;
  kind: Kind;
  id: string;
  data: unknown;
  deleted: boolean;
  device: string | null;
}

const toDoc = (r: Row): Doc => ({ kind: r.kind, id: r.id, data: r.data, deleted: r.deleted, device: r.device ?? undefined });

/** Supabase storage for one household's documents, with live updates. */
export function supabaseRemote(client: SupabaseClient, householdId: string): Remote {
  return {
    async fetchAll() {
      const out: Doc[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await client
          .from('docs')
          .select('household_id, kind, id, data, deleted, device')
          .eq('household_id', householdId)
          .order('kind').order('id')
          .range(from, from + 999);
        if (error) throw error;
        out.push(...(data as Row[]).map(toDoc));
        if (data.length < 1000) return out;
      }
    },

    async push(docs) {
      const send = async (batch: typeof docs) => {
        for (let i = 0; i < batch.length; i += 200) {
          const rows = batch.slice(i, i + 200).map((d) => ({
            household_id: householdId, kind: d.kind, id: d.id, data: d.data, deleted: d.deleted, device: d.device ?? null,
          }));
          const { error } = await client.from('docs').upsert(rows, { onConflict: 'household_id,kind,id' });
          if (error) throw error;
        }
      };
      // Kinds added after the first database setup go separately, so an
      // older setup that doesn't accept them can't hold up everything else.
      const newer = (d: (typeof docs)[number]) => d.kind === 'list';
      await send(docs.filter((d) => !newer(d)));
      const later = docs.filter(newer);
      if (!later.length) return;
      try {
        await send(later);
      } catch (e) {
        // 23514: the database's list of allowed kinds is older than this app.
        if ((e as { code?: string }).code === '23514') return { refused: ['list'] };
        throw e;
      }
    },

    subscribe(onChange, onReconnect) {
      let subscribedBefore = false;
      let lastWake = 0;
      const channel = client
        .channel(`docs-${householdId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'docs', filter: `household_id=eq.${householdId}` },
          (payload) => {
            const row = payload.new as Row | undefined;
            if (row?.kind) onChange(toDoc(row));
          },
        )
        .subscribe((status) => {
          if (status !== 'SUBSCRIBED') return;
          if (subscribedBefore) onReconnect();
          subscribedBefore = true;
        });

      // Phones drop connections when asleep or offline: catch up when they come back.
      const wake = () => {
        if (document.visibilityState !== 'visible' || Date.now() - lastWake < 15_000) return;
        lastWake = Date.now();
        onReconnect();
      };
      window.addEventListener('online', onReconnect);
      document.addEventListener('visibilitychange', wake);
      return () => {
        window.removeEventListener('online', onReconnect);
        document.removeEventListener('visibilitychange', wake);
        void client.removeChannel(channel);
      };
    },
  };
}
