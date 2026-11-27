import { describe, expect, it } from 'vitest';
import { isOwner, leaveWarning, rolesKnown, sortMembers, type Member } from './members';

const ana: Member = { userId: 'a', email: 'ana@example.com', role: 'owner' };
const ben: Member = { userId: 'b', email: 'ben@example.com', role: 'member' };
const cal: Member = { userId: 'c', email: 'cal@example.com', role: 'member' };

describe('members', () => {
  it('lists owners first, then everyone by email', () => {
    expect(sortMembers([cal, ben, ana]).map((m) => m.userId)).toEqual(['a', 'b', 'c']);
    expect(sortMembers([ben, { ...cal, role: 'owner' }, ana]).map((m) => m.userId)).toEqual(['a', 'c', 'b']);
  });

  it('knows who the owner is', () => {
    expect(isOwner([ana, ben], 'a')).toBe(true);
    expect(isOwner([ana, ben], 'b')).toBe(false);
    expect(isOwner([ana, ben], undefined)).toBe(false);
    expect(isOwner([], 'a')).toBe(false);
  });

  it('only offers owner controls when the database has roles', () => {
    expect(rolesKnown([ana, ben])).toBe(true);
    expect(rolesKnown([{ userId: 'a', email: 'x' }, { userId: 'b', email: 'y' }])).toBe(false);
    expect(rolesKnown([])).toBe(false);
  });

  it('warns about what leaving does', () => {
    expect(leaveWarning([ana, ben], 'b')).toMatch(/^Leave this household\?/);
    expect(leaveWarning([ana, ben], 'b')).not.toMatch(/Ownership/);
    expect(leaveWarning([ana, ben], 'a')).toMatch(/Ownership passes/);
    expect(leaveWarning([ana], 'a')).toMatch(/only member.*deletes this household/);
    expect(leaveWarning([], 'a')).toMatch(/^Leave this household\?/);
  });
});
