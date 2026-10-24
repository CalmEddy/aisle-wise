import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the migration against an in-memory Postgres with just enough of
 * Supabase stubbed (auth.uid(), auth.jwt(), roles, realtime publication)
 * to check the access rules.
 */
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select jsonb_build_object('email', current_setting('test.email', true)) $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  create publication supabase_realtime;
`;

const ANA = '00000000-0000-0000-0000-00000000000a';
const BEN = '00000000-0000-0000-0000-00000000000b';
const EVE = '00000000-0000-0000-0000-00000000000e';

let db: PGlite;

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ''}', false);
    select set_config('test.email', '${uid ? uid.slice(-1) + '@example.com' : ''}', false);
    set role ${uid ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  await db.exec(readFileSync(new URL('./migrations/20261024000000_households.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into auth.users values ('${ANA}'), ('${BEN}'), ('${EVE}');`);
});

describe('household access rules', () => {
  let household: { id: string; invite_code: string };

  it('lets a signed-in user create a household and become its member', async () => {
    [household] = await as<{ id: string; invite_code: string }>(ANA, `select * from create_household('Branyans')`);
    expect(household.invite_code).toMatch(/^[0-9A-F]{8}$/);
    const members = await as(ANA, 'select user_id, email from household_members');
    expect(members).toEqual([{ user_id: ANA, email: 'a@example.com' }]);
  });

  it('does not let signed-out visitors create or join', async () => {
    await expect(as(null, `select * from create_household('x')`)).rejects.toThrow();
    await expect(as(null, `select * from join_household('${household.invite_code}')`)).rejects.toThrow();
  });

  it('lets members read and write docs', async () => {
    await as(ANA, `insert into docs (household_id, kind, id, data, device) values ($1, 'item', 'i1', '{"name":"Milk"}', 'phone-a')`, [household.id]);
    const rows = await as<{ data: unknown; updated_by: string }>(ANA, 'select data, updated_by from docs');
    expect(rows).toEqual([{ data: { name: 'Milk' }, updated_by: ANA }]);
  });

  it('hides everything from non-members, and blocks their writes', async () => {
    expect(await as(EVE, 'select * from households')).toEqual([]);
    expect(await as(EVE, 'select * from docs')).toEqual([]);
    expect(await as(EVE, 'select * from household_members')).toEqual([]);
    await expect(
      as(EVE, `insert into docs (household_id, kind, id, data) values ($1, 'item', 'x', '{}')`, [household.id]),
    ).rejects.toThrow(/row-level security/);
    await as(EVE, `update docs set data = '{"name":"hacked"}'`);
    expect((await as<{ data: unknown }>(ANA, 'select data from docs'))[0].data).toEqual({ name: 'Milk' });
    // Nor can they add themselves directly.
    await expect(
      as(EVE, `insert into household_members (household_id, user_id) values ($1, $2)`, [household.id, EVE]),
    ).rejects.toThrow();
  });

  it('rejects a wrong invite code and accepts the right one (any case, spaces)', async () => {
    await expect(as(BEN, `select * from join_household('NOPE1234')`)).rejects.toThrow(/invite code/);
    await as(BEN, `select * from join_household($1)`, [`  ${household.invite_code.toLowerCase()} `]);
    // Joining twice is harmless.
    await as(BEN, `select * from join_household($1)`, [household.invite_code]);
    expect(await as(BEN, 'select data from docs')).toEqual([{ data: { name: 'Milk' } }]);
    expect((await as(BEN, 'select user_id from household_members order by user_id')).length).toBe(2);
  });

  it('records who changed a doc and when', async () => {
    const [before] = await as<{ updated_at: string }>(ANA, 'select updated_at from docs');
    await as(BEN, `update docs set data = '{"name":"Milk","done":true}', device = 'phone-b'`);
    const [after] = await as<{ updated_by: string; updated_at: string; device: string }>(ANA, 'select updated_by, updated_at, device from docs');
    expect(after.updated_by).toBe(BEN);
    expect(after.device).toBe('phone-b');
    expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before.updated_at).getTime());
  });

  it('lets a member leave, after which they lose access', async () => {
    await as(BEN, 'delete from household_members where user_id = auth.uid()');
    expect(await as(BEN, 'select * from docs')).toEqual([]);
    // Ben can't remove Ana.
    await as(BEN, `delete from household_members where user_id = $1`, [ANA]);
    expect((await as(ANA, 'select * from household_members')).length).toBe(1);
  });
});
