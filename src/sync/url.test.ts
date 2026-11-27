import { describe, expect, it } from 'vitest';
import { EXPIRED_LINK_MESSAGE, normalizeSupabaseUrl, parseAuthLink } from './url';

describe('normalizeSupabaseUrl', () => {
  const want = 'https://abcdefghijklmnopqrst.supabase.co';
  it.each([
    ['https://abcdefghijklmnopqrst.supabase.co'],
    ['https://abcdefghijklmnopqrst.supabase.co/'],
    ['https://abcdefghijklmnopqrst.supabase.co/rest/v1/'],
    ['https://abcdefghijklmnopqrst.supabase.co/auth/v1'],
    ['  "https://abcdefghijklmnopqrst.supabase.co"  '],
    ['abcdefghijklmnopqrst.supabase.co'],
    ['https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api'],
    ['abcdefghijklmnopqrst'],
  ])('fixes %s', (input) => {
    expect(normalizeSupabaseUrl(input)).toBe(want);
  });

  it('leaves a custom domain or local server alone (apart from the path)', () => {
    expect(normalizeSupabaseUrl('http://localhost:54321/rest/v1')).toBe('http://localhost:54321');
    expect(normalizeSupabaseUrl('https://db.example.com')).toBe('https://db.example.com');
  });

  it('treats blank as not set', () => {
    expect(normalizeSupabaseUrl('')).toBeUndefined();
    expect(normalizeSupabaseUrl('   ')).toBeUndefined();
    expect(normalizeSupabaseUrl(undefined)).toBeUndefined();
  });
});

describe('parseAuthLink', () => {
  it('recognises a working password-reset link', () => {
    expect(parseAuthLink('#access_token=abc.def&expires_in=3600&refresh_token=xyz&token_type=bearer&type=recovery'))
      .toEqual({ recovery: true });
  });
  it('does not treat a sign-up confirmation as a reset', () => {
    expect(parseAuthLink('#access_token=abc&type=signup')).toEqual({ recovery: false });
    expect(parseAuthLink('#type=recovery')).toEqual({ recovery: false });
  });
  it('explains an expired or used-up link', () => {
    const hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    expect(parseAuthLink(hash)).toEqual({ recovery: false, problem: EXPIRED_LINK_MESSAGE });
  });
  it('ignores ordinary addresses, including invite and share links', () => {
    expect(parseAuthLink('')).toEqual({ recovery: false });
    expect(parseAuthLink('#join=ABCD1234')).toEqual({ recovery: false });
    expect(parseAuthLink('#share=Zm9v')).toEqual({ recovery: false });
  });
});
