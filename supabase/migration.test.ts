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
const CAL = '00000000-0000-0000-0000-00000000000c';
const DEE = '00000000-0000-0000-0000-00000000000d';

const BASE = readFileSync(new URL('./migrations/20261024000000_households.sql', import.meta.url), 'utf8');
const HARDENING = readFileSync(new URL('./migrations/20261128000000_hardening.sql', import.meta.url), 'utf8');
const CATEGORY_DOCS = readFileSync(new URL('./migrations/20261129000000_category_docs.sql', import.meta.url), 'utf8');
const MIGRATION = BASE + '\n' + HARDENING + '\n' + CATEGORY_DOCS;
/** How many numbered checks supabase/check.sql reports. */
const CHECKS = 11;
const CHECK = readFileSync(new URL('./check.sql', import.meta.url), 'utf8');

let db: PGlite;

const as = <T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) =>
  asOn<T>(db, uid, sql, params);

async function asOn<T = Record<string, unknown>>(db: PGlite, uid: string | null, sql: string, params: unknown[] = []) {
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
  await db.exec(MIGRATION);
  await db.exec(`insert into auth.users values ('${ANA}'), ('${BEN}'), ('${EVE}'), ('${CAL}'), ('${DEE}');`);
});

/** A separate database with the full setup, for tests that change global rules. */
async function freshDb(users: string[] = [ANA, BEN, CAL, DEE]) {
  const d = new PGlite();
  await d.exec(SUPABASE_STUBS);
  await d.exec(MIGRATION);
  for (const u of users) await d.exec(`insert into auth.users values ('${u}');`);
  return d;
}

describe('household access rules', () => {
  let household: { id: string; invite_code: string };

  it('lets a signed-in user create a household and become its member', async () => {
    [household] = await as<{ id: string; invite_code: string }>(ANA, `select * from create_household('Branyans')`);
    expect(household.invite_code).toMatch(/^[0-9A-F]{16}$/);
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
    // A wrong code comes back empty (the app says "No household has that invite code").
    expect((await as<{ id: string | null }>(BEN, `select * from join_household('NOPE1234')`))[0].id).toBeNull();
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
    await as(BEN, 'select leave_household($1)', [household.id]);
    expect(await as(BEN, 'select * from docs')).toEqual([]);
    expect((await as(ANA, 'select * from household_members')).length).toBe(1);
  });
});

describe('running the setup again', () => {
  it('reports everything as set up', async () => {
    const rows = (await db.query<{ part: string; status: string }>(CHECK)).rows;
    expect(rows.map((r) => r.status)).toEqual(Array(CHECKS).fill('OK'));
  });

  it('can be run a second time without errors or losing data', async () => {
    const before = (await db.query('select count(*)::int as n from docs')).rows;
    await db.exec(MIGRATION);
    expect((await db.query('select count(*)::int as n from docs')).rows).toEqual(before);
    const rows = (await db.query<{ status: string }>(CHECK)).rows;
    expect(rows.map((r) => r.status)).toEqual(Array(CHECKS).fill('OK'));
  });

  it('upgrades an older setup so named lists can sync, keeping data', async () => {
    const old = new PGlite();
    await old.exec(SUPABASE_STUBS);
    // The setup as it was before lists: only four kinds allowed.
    await old.exec(BASE.replace(/alter table public\.docs drop constraint[\s\S]*?'list'\)\);/, '')
      .replace("'categories', 'list')", "'categories')"));
    await old.exec(`insert into auth.users values ('${ANA}');`);
    await old.exec(`reset role; select set_config('test.uid', '${ANA}', false); set role authenticated;`);
    const [h] = (await old.query<{ id: string }>(`select * from create_household('Home')`)).rows;
    await old.query(`insert into docs (household_id, kind, id, data) values ($1, 'item', 'i1', '{}')`, [h.id]);
    await expect(old.query(`insert into docs (household_id, kind, id, data) values ($1, 'list', 'l1', '{}')`, [h.id])).rejects.toThrow(/docs_kind_check/);
    await old.exec('reset role;');
    let rows = (await old.query<{ part: string; status: string }>(CHECK)).rows;
    expect(rows.find((r) => r.part.startsWith('8'))?.status).toMatch(/MISSING/);

    await old.exec(MIGRATION);
    rows = (await old.query<{ part: string; status: string }>(CHECK)).rows;
    expect(rows.map((r) => r.status)).toEqual(Array(CHECKS).fill('OK'));
    await old.exec(`select set_config('test.uid', '${ANA}', false); set role authenticated;`);
    await old.query(`insert into docs (household_id, kind, id, data) values ($1, 'list', 'l1', '{"name":"Party"}')`, [h.id]);
    expect((await old.query('select kind, id from docs order by kind')).rows).toEqual([{ kind: 'item', id: 'i1' }, { kind: 'list', id: 'l1' }]);
    await old.exec('reset role;');
  });

  it('reports a fresh database as not set up', async () => {
    const empty = new PGlite();
    await empty.exec(SUPABASE_STUBS);
    const rows = (await empty.query<{ status: string }>(CHECK)).rows;
    expect(rows.every((r) => r.status.startsWith('MISSING'))).toBe(true);
  });

  it('refuses to touch an unrelated "households" table', async () => {
    const other = new PGlite();
    await other.exec(SUPABASE_STUBS);
    await other.exec(`create table public.households (id serial primary key, address text); insert into public.households (address) values ('1 Main St');`);
    await expect(other.exec(MIGRATION)).rejects.toThrow(/different table called "households"/);
    expect((await other.query('select address from public.households')).rows).toEqual([{ address: '1 Main St' }]);
    expect((await other.query(`select to_regclass('public.docs') as t`)).rows).toEqual([{ t: null }]);
  });
});

describe('owners, invite codes and leaving', () => {
  // DEE is a signed-in person who belongs to no household.
  const create = async (d: PGlite, uid: string, name = 'Home') =>
    (await asOn<{ id: string; invite_code: string }>(d, uid, `select * from create_household($1)`, [name]))[0];
  const roles = async (d: PGlite, h: string) =>
    (await d.query<{ user_id: string; role: string }>(
      `select user_id, role from household_members where household_id = $1 order by joined_at, user_id`, [h],
    )).rows;

  it('makes the creator the owner and later joiners members', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await asOn(d, BEN, 'select * from join_household($1)', [h.invite_code]);
    expect(await roles(d, h.id)).toEqual([{ user_id: ANA, role: 'owner' }, { user_id: BEN, role: 'member' }]);
  });

  it('gives owners to households made before roles existed', async () => {
    const old = new PGlite();
    await old.exec(SUPABASE_STUBS);
    await old.exec(BASE);
    await old.exec(`insert into auth.users values ('${ANA}'), ('${BEN}'), ('${CAL}');`);
    const h = await create(old, ANA);
    await asOn(old, BEN, 'select * from join_household($1)', [h.invite_code]);
    // A household whose creator was deleted before this setup: no creator to promote.
    const orphan = await create(old, CAL, 'Orphan');
    await asOn(old, BEN, 'select * from join_household($1)', [orphan.invite_code]);
    await old.exec(`delete from household_members where user_id = '${CAL}'`);
    await old.exec(HARDENING);
    expect(await roles(old, h.id)).toEqual([{ user_id: ANA, role: 'owner' }, { user_id: BEN, role: 'member' }]);
    expect(await roles(old, orphan.id)).toEqual([{ user_id: BEN, role: 'owner' }]);
  });

  it('lets only owners rename, and nobody edit the invite code or creator directly', async () => {
    const d = await freshDb();
    const h = await create(d, ANA, 'Original');
    await asOn(d, BEN, 'select * from join_household($1)', [h.invite_code]);
    await asOn(d, BEN, `update households set name = 'Hijacked'`);
    expect((await asOn<{ name: string }>(d, ANA, 'select name from households'))[0].name).toBe('Original');
    await asOn(d, ANA, `update households set name = 'Renamed'`);
    expect((await asOn<{ name: string }>(d, BEN, 'select name from households'))[0].name).toBe('Renamed');
    await expect(asOn(d, ANA, `update households set invite_code = 'AAAAAAAAAAAAAAAA'`)).rejects.toThrow(/permission denied/);
    await expect(asOn(d, ANA, `update households set created_by = $1`, [BEN])).rejects.toThrow(/permission denied/);
  });

  it('lets only the owner change the invite code, and the old code stops working', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await asOn(d, BEN, 'select * from join_household($1)', [h.invite_code]);
    await expect(asOn(d, BEN, 'select * from rotate_invite_code($1)', [h.id])).rejects.toThrow(/owner/);
    const [fresh] = await asOn<{ invite_code: string }>(d, ANA, 'select * from rotate_invite_code($1)', [h.id]);
    expect(fresh.invite_code).toMatch(/^[0-9A-F]{16}$/);
    expect(fresh.invite_code).not.toBe(h.invite_code);
    const [old] = await asOn<{ id: string | null }>(d, CAL, 'select * from join_household($1)', [h.invite_code]);
    expect(old.id).toBeNull();
    const [ok] = await asOn<{ id: string }>(d, CAL, 'select * from join_household($1)', [fresh.invite_code]);
    expect(ok.id).toBe(h.id);
  });

  it('still accepts the short codes households were created with', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await d.exec(`update households set invite_code = 'ABCD1234' where id = '${h.id}'`);
    const [ok] = await asOn<{ id: string }>(d, BEN, `select * from join_household('abcd1234')`);
    expect(ok.id).toBe(h.id);
  });

  it('throttles wrong invite codes per person, even for the right code afterwards', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    for (let i = 0; i < 5; i++) {
      expect((await asOn<{ id: string | null }>(d, BEN, `select * from join_household('WRONG${i}')`))[0].id).toBeNull();
    }
    await expect(asOn(d, BEN, `select * from join_household('WRONG9')`)).rejects.toThrow(/Too many/);
    await expect(asOn(d, BEN, 'select * from join_household($1)', [h.invite_code])).rejects.toThrow(/Too many/);
    // Someone else is unaffected, and the block lifts after an hour.
    expect((await asOn<{ id: string }>(d, CAL, 'select * from join_household($1)', [h.invite_code]))[0].id).toBe(h.id);
    await d.exec(`update join_failures set at = now() - interval '2 hours'`);
    expect((await asOn<{ id: string }>(d, BEN, 'select * from join_household($1)', [h.invite_code]))[0].id).toBe(h.id);
  });

  it('keeps the failure log out of reach of the app', async () => {
    const d = await freshDb();
    await asOn(d, BEN, `select * from join_household('NOPE')`);
    await expect(asOn(d, BEN, 'select * from join_failures')).rejects.toThrow(/permission denied/);
  });

  it('refuses new members once a household is full', async () => {
    const d = await freshDb();
    await d.exec(`create or replace function public.aw_limit(p text) returns int language sql immutable as
      $$ select case p when 'members_per_household' then 2 else 1000000 end $$`);
    const h = await create(d, ANA);
    await asOn(d, BEN, 'select * from join_household($1)', [h.invite_code]);
    await expect(asOn(d, CAL, 'select * from join_household($1)', [h.invite_code])).rejects.toThrow(/full/);
    // A member who is already in can still "join" again.
    await asOn(d, BEN, 'select * from join_household($1)', [h.invite_code]);
  });

  it('does not let signed-out visitors use the new functions', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    for (const sql of [
      `select rotate_invite_code('${h.id}')`,
      `select leave_household('${h.id}')`,
      `select remove_member('${h.id}', '${BEN}')`,
      `select delete_my_account()`,
      `select remove_from_household('${h.id}', '${ANA}')`,
    ]) await expect(asOn(d, null, sql)).rejects.toThrow();
    // Not even signed-in people can call the internal one directly.
    await expect(asOn(d, ANA, `select remove_from_household('${h.id}', '${ANA}')`)).rejects.toThrow(/permission denied/);
  });

  it('blocks deleting membership rows directly', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await expect(asOn(d, ANA, 'delete from household_members')).rejects.toThrow(/permission denied/);
    expect(await roles(d, h.id)).toHaveLength(1);
  });

  it('hands ownership to the longest-standing member when the owner leaves', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await asOn(d, BEN, 'select * from join_household($1)', [h.invite_code]);
    await asOn(d, CAL, 'select * from join_household($1)', [h.invite_code]);
    await asOn(d, ANA, 'select leave_household($1)', [h.id]);
    expect(await roles(d, h.id)).toEqual([{ user_id: BEN, role: 'owner' }, { user_id: CAL, role: 'member' }]);
    expect(await asOn(d, ANA, 'select * from households')).toEqual([]);
  });

  it('removes a household, and its data, when the last member leaves', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await asOn(d, ANA, `insert into docs (household_id, kind, id, data) values ($1, 'item', 'i1', '{}')`, [h.id]);
    await asOn(d, ANA, 'select leave_household($1)', [h.id]);
    expect((await d.query('select count(*)::int as n from households')).rows).toEqual([{ n: 0 }]);
    expect((await d.query('select count(*)::int as n from docs')).rows).toEqual([{ n: 0 }]);
  });

  it('lets only the owner remove other members', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await asOn(d, BEN, 'select * from join_household($1)', [h.invite_code]);
    await asOn(d, CAL, 'select * from join_household($1)', [h.invite_code]);
    await expect(asOn(d, BEN, 'select remove_member($1, $2)', [h.id, CAL])).rejects.toThrow(/owner/);
    await expect(asOn(d, ANA, 'select remove_member($1, $2)', [h.id, ANA])).rejects.toThrow(/Leave household/);
    await asOn(d, ANA, 'select remove_member($1, $2)', [h.id, CAL]);
    expect((await roles(d, h.id)).map((r) => r.user_id)).toEqual([ANA, BEN]);
    expect(await asOn(d, CAL, 'select * from docs')).toEqual([]);
  });

  it('leaves a household alone when someone from outside tries to remove or rotate', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await expect(asOn(d, DEE, 'select remove_member($1, $2)', [h.id, ANA])).rejects.toThrow(/owner/);
    await expect(asOn(d, DEE, 'select rotate_invite_code($1)', [h.id])).rejects.toThrow(/owner/);
    expect(await roles(d, h.id)).toHaveLength(1);
  });

  it('erases an account without deleting the household other people use', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await asOn(d, BEN, 'select * from join_household($1)', [h.invite_code]);
    await asOn(d, ANA, `insert into docs (household_id, kind, id, data) values ($1, 'item', 'i1', '{"name":"Milk"}')`, [h.id]);
    await asOn(d, ANA, 'select delete_my_account()');
    expect((await d.query(`select id from auth.users where id = '${ANA}'`)).rows).toEqual([]);
    expect(await roles(d, h.id)).toEqual([{ user_id: BEN, role: 'owner' }]);
    expect((await asOn(d, BEN, 'select data from docs')).length).toBe(1);
  });

  it('keeps the household when its creator’s account is removed by an admin', async () => {
    const d = await freshDb();
    const h = await create(d, ANA);
    await asOn(d, BEN, 'select * from join_household($1)', [h.invite_code]);
    await d.exec(`delete from auth.users where id = '${ANA}'`);
    expect((await d.query<{ created_by: string | null }>(`select created_by from households where id = '${h.id}'`)).rows)
      .toEqual([{ created_by: null }]);
    expect(await asOn(d, BEN, 'select id from households')).toHaveLength(1);
  });

  it('removes a household when its only member erases their account', async () => {
    const d = await freshDb();
    await create(d, ANA);
    await asOn(d, ANA, 'select delete_my_account()');
    expect((await d.query('select count(*)::int as n from households')).rows).toEqual([{ n: 0 }]);
  });
});

describe('document limits', () => {
  const setup = async () => {
    const d = await freshDb();
    const [h] = await asOn<{ id: string }>(d, ANA, `select * from create_household('Home')`);
    return { d, h: h.id };
  };
  const insert = (d: PGlite, h: string, id: string, data: unknown) =>
    asOn(d, ANA, `insert into docs (household_id, kind, id, data) values ($1, 'item', $2, $3::jsonb)`, [h, id, JSON.stringify(data)]);

  it('accepts normal-sized documents, including a big store layout', async () => {
    const { d, h } = await setup();
    await insert(d, h, 'i1', { name: 'Milk' });
    await insert(d, h, 'big', { blob: 'x'.repeat(100_000) });
  });

  it('refuses oversized documents, on insert and on update', async () => {
    const { d, h } = await setup();
    await expect(insert(d, h, 'huge', { blob: 'x'.repeat(300_000) })).rejects.toMatchObject({ code: '54000' });
    await insert(d, h, 'i1', { name: 'Milk' });
    await expect(
      asOn(d, ANA, `update docs set data = $1::jsonb where id = 'i1'`, [JSON.stringify({ blob: 'x'.repeat(300_000) })]),
    ).rejects.toMatchObject({ code: '54000' });
  });

  it('refuses very long ids', async () => {
    const { d, h } = await setup();
    await expect(insert(d, h, 'x'.repeat(201), {})).rejects.toMatchObject({ code: '54000' });
  });

  it('refuses documents past the household limit, but lets existing ones be edited', async () => {
    const { d, h } = await setup();
    await d.exec(`create or replace function public.aw_limit(p text) returns int language sql immutable as
      $$ select case p when 'docs_per_household' then 3 when 'doc_bytes' then 262144 when 'id_length' then 200 else 100 end $$`);
    await insert(d, h, 'a', {});
    await insert(d, h, 'b', {});
    await insert(d, h, 'c', {});
    await expect(insert(d, h, 'd', {})).rejects.toMatchObject({ code: '54000' });
    // A bulk sync that crosses the limit is refused as a whole.
    await expect(asOn(d, ANA, `insert into docs (household_id, kind, id, data)
      select $1, 'item', 'n' || g, '{}' from generate_series(1, 5) g`, [h])).rejects.toMatchObject({ code: '54000' });
    // Saving over an existing document is still fine (the app's "upsert").
    await asOn(d, ANA, `insert into docs (household_id, kind, id, data) values ($1, 'item', 'a', '{"v":2}')
      on conflict (household_id, kind, id) do update set data = excluded.data`, [h]);
    expect((await asOn(d, ANA, `select data from docs where id = 'a'`))[0]).toEqual({ data: { v: 2 } });
    expect((await d.query('select count(*)::int as n from docs')).rows).toEqual([{ n: 3 }]);
  });

  it('counts each household on its own', async () => {
    const { d, h } = await setup();
    await d.exec(`create or replace function public.aw_limit(p text) returns int language sql immutable as
      $$ select case p when 'docs_per_household' then 2 when 'doc_bytes' then 262144 when 'id_length' then 200 else 100 end $$`);
    await insert(d, h, 'a', {});
    await insert(d, h, 'b', {});
    const [other] = await asOn<{ id: string }>(d, BEN, `select * from create_household('Other')`);
    await asOn(d, BEN, `insert into docs (household_id, kind, id, data) values ($1, 'item', 'a', '{}')`, [other.id]);
  });
});

describe('category documents', () => {
  const insertKind = (d: PGlite, hid: string, kind: string) =>
    asOn(d, ANA, `insert into docs (household_id, kind, id, data) values ($1, $2, 'x', '{}')`, [hid, kind]);

  it('lets categories sync one by one, and still refuses made-up kinds', async () => {
    const d = await freshDb();
    const [h] = await asOn<{ id: string }>(d, ANA, `select * from create_household('Home')`);
    await insertKind(d, h.id, 'category');
    await insertKind(d, h.id, 'purchase');
    await insertKind(d, h.id, 'categories'); // the old single document is still allowed
    await expect(insertKind(d, h.id, 'nonsense')).rejects.toMatchObject({ code: '23514' });
  });

  it('upgrades a database that only knows the older kinds, keeping its data', async () => {
    const old = new PGlite();
    await old.exec(SUPABASE_STUBS);
    await old.exec(BASE);
    await old.exec(`insert into auth.users values ('${ANA}');`);
    const [h] = await asOn<{ id: string }>(old, ANA, `select * from create_household('Home')`);
    await asOn(old, ANA, `insert into docs (household_id, kind, id, data) values ($1, 'categories', 'all', '[{"id":"a"}]')`, [h.id]);
    await expect(insertKind(old, h.id, 'category')).rejects.toMatchObject({ code: '23514' });
    await old.exec(CATEGORY_DOCS);
    await insertKind(old, h.id, 'category');
    expect((await old.query('select kind from docs order by kind')).rows).toEqual([{ kind: 'categories' }, { kind: 'category' }]);
  });

  it('can be run again without changing anything', async () => {
    const d = await freshDb();
    await d.exec(CATEGORY_DOCS);
    await d.exec(CATEGORY_DOCS);
    const rows = (await d.query<{ status: string }>(CHECK)).rows;
    expect(rows.map((r) => r.status)).toEqual(Array(CHECKS).fill('OK'));
  });
});
