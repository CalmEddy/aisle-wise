/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL, e.g. https://abcd.supabase.co. Leave unset to run without live sharing. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase "anon" public key. Safe to publish; the database rules protect the data. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
