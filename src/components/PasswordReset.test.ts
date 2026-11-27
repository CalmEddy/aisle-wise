import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HouseholdApi } from '../sync/useHousehold';
import { EXPIRED_LINK_MESSAGE } from '../sync/url';
import { HouseholdSheet } from './HouseholdSheet';

/** The sheet with just enough of the sync hook to draw each screen. */
const render = (over: Partial<HouseholdApi>) =>
  renderToStaticMarkup(
    createElement(HouseholdSheet, {
      api: {
        configured: true, signedIn: false, email: undefined, household: null, status: 'off', needsDbUpdate: false,
        recovering: false, passwordChanged: false, linkProblem: '', userId: undefined,
        ...over,
      } as unknown as HouseholdApi,
      onClose: () => {},
    }),
  );

describe('password reset screens', () => {
  it('offers "Forgot your password?" on sign-in instead of telling people to make a new account', () => {
    const html = render({});
    expect(html).toContain('Forgot your password?');
    expect(html).not.toContain('Create a new account and rejoin');
  });

  it('asks for a new password after a reset link, once the sign-in is ready', () => {
    const html = render({ recovering: true, signedIn: true, email: 'ana@example.com' });
    expect(html).toContain('Choose a new password');
    expect(html).toContain('ana@example.com');
    expect(html).toContain('at least 8 characters');
    expect(html).not.toContain('Join with an invite code');
  });

  it('waits while the reset link is still being read', () => {
    const html = render({ recovering: true, signedIn: false });
    expect(html).toContain('Checking your reset link');
    expect(html).not.toContain('Choose a new password');
  });

  it('explains a link that expired or was already used, above the normal screen', () => {
    const html = render({ linkProblem: EXPIRED_LINK_MESSAGE });
    expect(html).toContain('expired or was already used');
    expect(html).toContain('Dismiss');
    expect(html).toContain('Forgot your password?');
  });

  it('confirms a changed password, but not while still choosing one', () => {
    expect(render({ passwordChanged: true, signedIn: true })).toContain('Password updated');
    expect(render({ passwordChanged: true, recovering: true, signedIn: true })).not.toContain('Password updated');
  });

});
