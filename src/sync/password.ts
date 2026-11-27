/** Shortest password the app accepts for a new account or a reset. (Signing in never checks length.) */
export const MIN_PASSWORD = 8;

/** Why a new password can't be used, or undefined when it's fine. */
export function passwordProblem(password: string): string | undefined {
  if (password.length < MIN_PASSWORD) return `Use a password with at least ${MIN_PASSWORD} characters.`;
  if (/^\s+$/.test(password)) return 'A password can’t be only spaces.';
  return undefined;
}
