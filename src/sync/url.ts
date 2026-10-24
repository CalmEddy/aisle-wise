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
