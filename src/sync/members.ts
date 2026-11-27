/** A person in a household, as shown in the household sheet. */
export interface Member {
  userId: string;
  email: string;
  /** Unknown (undefined) until the database has the hardening migration. */
  role?: 'owner' | 'member';
}

/** Owners first, then everyone else by email. */
export function sortMembers(list: Member[]): Member[] {
  return [...list].sort(
    (a, b) => Number(b.role === 'owner') - Number(a.role === 'owner') || a.email.localeCompare(b.email),
  );
}

export const isOwner = (list: Member[], userId: string | undefined): boolean =>
  !!userId && list.some((m) => m.userId === userId && m.role === 'owner');

/** Whether the database knows about owners (so owner-only buttons make sense). */
export const rolesKnown = (list: Member[]): boolean => list.some((m) => !!m.role);

/** What to tell someone before they leave, depending on what leaving does. */
export function leaveWarning(list: Member[], userId: string | undefined): string {
  const keeps = 'Your phone keeps a copy of everything, but stops getting updates.';
  const others = list.filter((m) => m.userId !== userId);
  if (list.length > 0 && others.length === 0) {
    return `You’re the only member, so leaving deletes this household and everything shared in it. ${keeps}`;
  }
  if (isOwner(list, userId)) {
    return `Leave this household? Ownership passes to the member who has been here longest. ${keeps}`;
  }
  return `Leave this household? ${keeps}`;
}

export const REMOVE_MEMBER_WARNING = (email: string) =>
  `Remove ${email} from this household? They keep a copy on their phone, but stop getting updates.`;

export const NEW_CODE_WARNING =
  'Make a new invite code? The old code and any links already sent stop working. People already in the household stay in.';

export const DELETE_ACCOUNT_CONFIRM_WORD = 'DELETE';
