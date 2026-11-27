/**
 * Turns whatever was pasted as the Supabase address into the bare project
 * URL the client needs, e.g. https://abcd.supabase.co. Accepts the REST/auth
 * endpoint (…/rest/v1/), the dashboard page (supabase.com/dashboard/project/abcd),
 * a bare project id, extra spaces, quotes and trailing slashes.
 */
export function normalizeSupabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!s) return undefined;

  // Dashboard link → project URL.
  const dash = /supabase\.com\/dashboard\/project\/([a-z0-9]+)/i.exec(s);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;

  // Just the project id.
  if (/^[a-z0-9]{15,30}$/i.test(s)) return `https://${s.toLowerCase()}.supabase.co`;

  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    // Keep only the origin: drops /rest/v1/, /auth/v1/, query strings, etc.
    return u.origin;
  } catch {
    return undefined;
  }
}

/** What the address the app was opened with says about a Supabase email link. */
export interface AuthLink {
  /** The person followed a password-reset link and is signed in to choose a new password. */
  recovery: boolean;
  /** Plain-language reason the link didn't work (expired, already used), if it didn't. */
  problem?: string;
}

export const EXPIRED_LINK_MESSAGE =
  'That email link has expired or was already used. If you were confirming a new account, try signing in. If you were resetting a password, ask for a new link.';

/**
 * Supabase sends people back with the result in the address after `#`:
 * `#access_token=…&type=recovery` when a reset link worked, or
 * `#error=access_denied&error_code=otp_expired…` when it didn't. (Some email
 * programs open links in the background, which uses them up.)
 */
export function parseAuthLink(hash: string): AuthLink {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('error') || params.get('error_code')) return { recovery: false, problem: EXPIRED_LINK_MESSAGE };
  return { recovery: params.get('type') === 'recovery' && params.has('access_token') };
}
