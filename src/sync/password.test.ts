import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD, passwordProblem } from './password';

describe('passwordProblem', () => {
  it('accepts a password of the minimum length', () => {
    expect(passwordProblem('x'.repeat(MIN_PASSWORD))).toBeUndefined();
    expect(passwordProblem('correct horse battery staple')).toBeUndefined();
  });
  it('rejects short or blank passwords', () => {
    expect(passwordProblem('x'.repeat(MIN_PASSWORD - 1))).toMatch(/at least 8/);
    expect(passwordProblem('')).toMatch(/at least 8/);
    expect(passwordProblem(' '.repeat(MIN_PASSWORD))).toMatch(/only spaces/);
  });
});
