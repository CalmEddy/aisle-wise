import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Catalog } from '../core/catalog';
import { demoLayout } from '../core/demoLayout';
import { defaultCategories } from '../core/categories';
import type { ShoppingList } from '../core/types';
import type { HouseholdApi } from '../sync/useHousehold';
import { ListShareSheet } from './ListShareSheet';

const api = (over: Partial<HouseholdApi>) => ({
  configured: true,
  signedIn: false,
  household: null,
  status: 'synced',
  userId: 'a',
  members: async () => [],
  ...over,
}) as unknown as HouseholdApi;

const smiths = { id: 'h1', name: 'The Smiths', invite_code: 'ABCD1234' };
const render = (list: ShoppingList, household: HouseholdApi) =>
  renderToStaticMarkup(createElement(ListShareSheet, {
    list,
    items: [],
    layout: demoLayout,
    catalog: new Catalog([], defaultCategories),
    api: household,
    onSetShared: () => {},
    onManageHousehold: () => {},
    onClose: () => {},
  }));

describe('ListShareSheet', () => {
  const party: ShoppingList = { id: 'party', name: 'Party' };

  it('without live sharing, goes straight to sending a copy', () => {
    const html = render(party, api({ configured: false }));
    expect(html).toContain('Share “Party”');
    expect(html).toContain('Copy link');
    expect(html).not.toContain('Share with');
    expect(html).not.toContain('Send a copy instead');
  });

  it('before an account exists, offers household sharing first and keeps the copy tucked away', () => {
    const html = render(party, api({}));
    expect(html).toContain('Share with household…');
    expect(html).toContain('Send a copy instead…');
    expect(html).not.toContain('Copy link');
    expect(html).not.toContain('Email'); // no sign-in form until asked
  });

  it('in a household, a private list has an unchecked switch and no invite', () => {
    const html = render(party, api({ household: smiths }));
    expect(html).toContain('Share with The Smiths');
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/);
    expect(html).not.toContain('Send invite link');
    expect(html).toContain('Household settings…');
  });

  it('a shared list is checked and offers an invite and its status', () => {
    const html = render({ ...party, shared: true }, api({ household: smiths }));
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    expect(html).toContain('Send invite link');
    expect(html).toContain('Up to date');
    expect(html).toContain('sees and edits this list live');
  });
});
