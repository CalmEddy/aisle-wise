-- Aisle Wise: live sharing for households.
-- Run in the Supabase SQL editor (or with `supabase db push`).
-- Safe to run more than once: it only adds what's missing and never deletes data.

-- Stop (without changing anything) if these names are already used by
-- something that isn't Aisle Wise.
do $$
begin
  if to_regclass('public.households') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'households' and column_name = 'invite_code'
  ) then
    raise exception 'A different table called "households" already exists in this database. Nothing was changed. Use a separate Supabase project for Aisle Wise, or rename that table.';
  end if;
  if to_regclass('public.household_members') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'household_members' and column_name = 'household_id'
  ) then
    raise exception 'A different table called "household_members" already exists in this database. Nothing was changed.';
  end if;
  if to_regclass('public.docs') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'docs' and column_name = 'household_id'
  ) then
    raise exception 'A different table called "docs" already exists in this database. Nothing was changed. Use a separate Supabase project for Aisle Wise, or rename that table.';
  end if;
end $$;

-- A household shares one shopping list, master item list, categories and stores.
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Our household',
  invite_code text not null unique
    default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Everything synced, one row per list item / grocery item / store, plus one
-- row holding the category list. `data` is the app's own JSON for that thing.
-- Deletes are soft (deleted = true) so other phones hear about them.
create table if not exists public.docs (
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null check (kind in ('item', 'product', 'layout', 'categories')),
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  -- Which phone made the change, so it can ignore its own echoes.
  device text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (household_id, kind, id)
);

create index if not exists docs_household_updated on public.docs (household_id, updated_at);

create or replace function public.docs_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
for each row execute function public.docs_touch();

-- Membership check used by the access rules. Runs with owner rights so the
-- rules on household_members don't call themselves.
create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members where household_id = h and user_id = auth.uid()
  );
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.docs enable row level security;

drop policy if exists "members read their household" on public.households;
create policy "members read their household" on public.households
  for select to authenticated using (public.is_member(id));
drop policy if exists "members rename their household" on public.households;
create policy "members rename their household" on public.households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

drop policy if exists "members see each other" on public.household_members;
create policy "members see each other" on public.household_members
  for select to authenticated using (public.is_member(household_id));
drop policy if exists "members can leave" on public.household_members;
create policy "members can leave" on public.household_members
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "members read docs" on public.docs;
create policy "members read docs" on public.docs
  for select to authenticated using (public.is_member(household_id));
drop policy if exists "members add docs" on public.docs;
create policy "members add docs" on public.docs
  for insert to authenticated with check (public.is_member(household_id));
drop policy if exists "members change docs" on public.docs;
create policy "members change docs" on public.docs
  for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));

-- Creating and joining go through these functions so nobody can add
-- themselves to a household without its invite code.
create or replace function public.create_household(p_name text) returns public.households
language plpgsql security definer set search_path = public as $$
declare
  h public.households;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  insert into public.households (name, created_by)
    values (coalesce(nullif(trim(p_name), ''), 'Our household'), auth.uid())
    returning * into h;
  insert into public.household_members (household_id, user_id, email)
    values (h.id, auth.uid(), auth.jwt() ->> 'email');
  return h;
end $$;

create or replace function public.join_household(p_code text) returns public.households
language plpgsql security definer set search_path = public as $$
declare
  h public.households;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into h from public.households where invite_code = upper(trim(p_code));
  if h.id is null then
    raise exception 'No household has that invite code';
  end if;
  insert into public.household_members (household_id, user_id, email)
    values (h.id, auth.uid(), auth.jwt() ->> 'email')
    on conflict do nothing;
  return h;
end $$;

revoke execute on function public.create_household(text) from public, anon;
revoke execute on function public.join_household(text) from public, anon;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;

grant select, update on public.households to authenticated;
grant select, delete on public.household_members to authenticated;
grant select, insert, update on public.docs to authenticated;

-- Live updates for docs.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'
  ) then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
