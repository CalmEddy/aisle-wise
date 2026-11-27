import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Member } from '../sync/members';
import { MembersCard } from './HouseholdSheet';

const members: Member[] = [
  { userId: 'b', email: 'ben@example.com', role: 'member' },
  { userId: 'a', email: 'ana@example.com', role: 'owner' },
];
const render = (over: { canRemove: boolean; myId?: string; list?: Member[] }) =>
  renderToStaticMarkup(
    createElement(MembersCard, { members: over.list ?? members, myId: over.myId, canRemove: over.canRemove, busy: false, onRemove: () => {} }),
  );

describe('MembersCard', () => {
  it('shows the owner first, marks you, and has no Remove buttons for ordinary members', () => {
    const html = render({ canRemove: false, myId: 'b' });
    expect(html.indexOf('ana@example.com')).toBeLessThan(html.indexOf('ben@example.com'));
    expect(html).toContain('Owner');
    expect(html).toContain('ben@example.com (you)');
    expect(html).not.toContain('Remove');
  });

  it('gives the owner a Remove button for everyone but themselves', () => {
    const html = render({ canRemove: true, myId: 'a' });
    expect(html.match(/>Remove</g)).toHaveLength(1);
    expect(html.indexOf('ben@example.com')).toBeLessThan(html.indexOf('Remove'));
  });

  it('shows nothing when the list is empty', () => {
    expect(render({ canRemove: true, list: [] })).toBe('');
  });
});
