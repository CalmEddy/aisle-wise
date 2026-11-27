import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ShoppingList } from '../core/types';
import type { HouseholdApi } from '../sync/useHousehold';
import { HouseholdRow, HouseholdSheet, ShareListsStep, SharedListsCard } from './HouseholdSheet';

const lists: ShoppingList[] = [
  { id: 'main', name: 'Shopping list', shared: true },
  { id: 'party', name: 'Party' },
];
const noop = () => {};
const checked = (html: string, name: string) =>
  new RegExp(`<input type="checkbox"[^>]*checked=""[^>]*/><span><span class="share-option-title">${name}<`).test(html);

describe('household list sharing', () => {
  it('the join step offers every list, none ticked, and mentions the Shopping list merge', () => {
    const html = renderToStaticMarkup(createElement(ShareListsStep, { householdName: 'The Smiths', lists, onSetShared: noop, onDone: noop }));
    expect(html).toContain('Share any of your lists?');
    expect(html).toContain('Shopping list');
    expect(html).toContain('Party');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('Skip for now');
    expect(html).toContain('Joins the household’s “Shopping list”');
    expect(html.match(/Joins the household/g)).toHaveLength(1); // only the default list can clash
  });

  it('the household screen shows which lists are shared', () => {
    const html = renderToStaticMarkup(createElement(SharedListsCard, { lists, onSetShared: noop }));
    expect(html).toContain('Shared lists');
    expect(checked(html, 'Shopping list')).toBe(true);
    expect(checked(html, 'Party')).toBe(false);
  });

  it('a household that is not joined yet is just called Household', () => {
    const api = { household: null, status: 'off' } as unknown as HouseholdApi;
    const html = renderToStaticMarkup(createElement(HouseholdRow, { api, onClick: noop }));
    expect(html).toContain('>Household<');
    expect(html).not.toContain('Share with your household');
  });

  it('an invite link says so before asking for sign-in', () => {
    const api = { configured: true, signedIn: false, household: null, status: 'off', recovering: false, passwordChanged: false, linkProblem: '' } as unknown as HouseholdApi;
    const html = renderToStaticMarkup(createElement(HouseholdSheet, { api, joinCode: 'ABCD1234', lists, onSetListShared: noop, onClose: noop }));
    expect(html).toContain('You’ve been invited to a household');
    expect(html).toContain('stay private until you choose to share them');
  });
});
