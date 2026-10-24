import { describe, expect, it } from 'vitest';
import { normalizeSupabaseUrl } from './url';

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
