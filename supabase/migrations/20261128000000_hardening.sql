-- Aisle Wise: safety rules for many households.
-- Run AFTER 20261024000000_households.sql (and the purchases migration).
-- Safe to run more than once: it only adds or replaces; it never deletes data.
-- NOTE: re-running 20261024000000_households.sql afterwards puts the old,
-- looser rules back. If you do, run this file again.
--
-- What it does:
--   1. Households get an owner (role 'owner' / 'member'). Deleting the
--      creator's account no longer deletes the household for everyone.
--   2. Only owners rename a household, remove members or change the invite code.
--   3. Leaving goes through leave_household(), which hands ownership on (or
--      removes an empty household). Accounts can erase themselves with
--      delete_my_account().
--   4. New invite codes are 16 characters, and wrong guesses are throttled.
--   5. Documents have a size limit, and households a document and member limit.

-- ---------------------------------------------------------------- limits
-- One place for every number, so they're easy to tune: change a value here
-- and run this file again.
create or replace function public.aw_limit(p text) returns int
language sql immutable as $$
  select case p
    when 'doc_bytes' then 262144               -- one document's JSON
    when 'id_length' then 200                  -- a document's id
    when 'docs_per_household' then 50000
    when 'members_per_household' then 20
    when 'join_failures_per_hour' then 5       -- wrong invite codes per user
  end
$$;

-- ----------------------------------------------------------------- owners
alter table public.household_members add column if not exists role text not null default 'member';
alter table public.household_members drop constraint if exists household_members_role_check;
alter table public.household_members add constraint household_members_role_check
  check (role in ('owner', 'member'));

-- The creator is the owner; a household whose creator is gone gets its
-- longest-standing member as owner.
update public.household_members m set role = 'owner'
from public.households h
where h.id = m.household_id and h.created_by = m.user_id and m.role <> 'owner';

update public.household_members m set role = 'owner'
where not exists (select 1 from public.household_members o where o.household_id = m.household_id and o.role = 'owner')
  and (m.user_id) = (
    select f.user_id from public.household_members f
    where f.household_id = m.household_id order by f.joined_at, f.user_id limit 1
  );

-- Deleting an account must not delete a household other people still use.
alter table public.households alter column created_by drop not null;
alter table public.households drop constraint if exists households_created_by_fkey;
alter table public.households add constraint households_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;

create or replace function public.is_owner(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = h and user_id = auth.uid() and role = 'owner'
  );
$$;

-- Members can still read the household; only owners rename it. Nobody can
-- change the invite code or creator by editing the row: only the name.
drop policy if exists "members rename their household" on public.households;
drop policy if exists "owners rename their household" on public.households;
create policy "owners rename their household" on public.households
  for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
revoke update on public.households from authenticated;
grant update (name) on public.households to authenticated;

-- Leaving and removing go through the functions below, so a household can't
-- be left without an owner.
drop policy if exists "members can leave" on public.household_members;
revoke delete on public.household_members from authenticated;

-- ---------------------------------------------------------- invite codes
alter table public.households alter column invite_code
  set default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));

-- Wrong guesses are remembered here (the function below is the only way in).
create table if not exists public.join_failures (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists join_failures_user_at on public.join_failures (user_id, at);
alter table public.join_failures enable row level security;
revoke all on public.join_failures from anon, authenticated;

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
  insert into public.household_members (household_id, user_id, email, role)
    values (h.id, auth.uid(), auth.jwt() ->> 'email', 'owner');
  return h;
end $$;

-- A wrong code returns an empty result (not an error) so the attempt can be
-- remembered: an error would undo the record. The app shows "No household has
-- that invite code" for an empty result.
create or replace function public.join_household(p_code text) returns public.households
language plpgsql security definer set search_path = public as $$
declare
  h public.households;
  failures int;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  delete from public.join_failures where at < now() - interval '1 day';
  select count(*) into failures from public.join_failures
    where user_id = auth.uid() and at > now() - interval '1 hour';
  if failures >= public.aw_limit('join_failures_per_hour') then
    raise exception 'Too many wrong invite codes. Try again in an hour.';
  end if;

  select * into h from public.households where invite_code = upper(trim(p_code));
  if h.id is null then
    insert into public.join_failures (user_id) values (auth.uid());
    return null;
  end if;

  if not exists (select 1 from public.household_members where household_id = h.id and user_id = auth.uid()) then
    if (select count(*) from public.household_members where household_id = h.id) >= public.aw_limit('members_per_household') then
      raise exception 'That household is full.';
    end if;
    insert into public.household_members (household_id, user_id, email, role)
      values (h.id, auth.uid(), auth.jwt() ->> 'email', 'member');
  end if;
  return h;
end $$;

create or replace function public.rotate_invite_code(p_household uuid) returns public.households
language plpgsql security definer set search_path = public as $$
declare
  h public.households;
begin
  if not public.is_owner(p_household) then
    raise exception 'Only the household owner can do that';
  end if;
  update public.households
    set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
    where id = p_household
    returning * into h;
  return h;
end $$;

-- ------------------------------------------------- leaving and removing
-- Takes one user out of one household: ownership passes to the longest-standing
-- other member, and a household with nobody left is removed with its data.
-- Not callable from the app: leave_household and delete_my_account use it.
create or replace function public.remove_from_household(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  was_owner boolean;
  heir uuid;
begin
  select role = 'owner' into was_owner from public.household_members
    where household_id = p_household and user_id = p_user;
  if was_owner is null then
    return;
  end if;
  delete from public.household_members where household_id = p_household and user_id = p_user;
  if not exists (select 1 from public.household_members where household_id = p_household) then
    delete from public.households where id = p_household;
  elsif was_owner and not exists (
    select 1 from public.household_members where household_id = p_household and role = 'owner'
  ) then
    select user_id into heir from public.household_members
      where household_id = p_household order by joined_at, user_id limit 1;
    update public.household_members set role = 'owner' where household_id = p_household and user_id = heir;
  end if;
end $$;

create or replace function public.leave_household(p_household uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  perform public.remove_from_household(p_household, auth.uid());
end $$;

create or replace function public.remove_member(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner(p_household) then
    raise exception 'Only the household owner can do that';
  end if;
  if p_user = auth.uid() then
    raise exception 'Use Leave household to remove yourself';
  end if;
  perform public.remove_from_household(p_household, p_user);
end $$;

-- Erases the signed-in user's account. Their households are handed on or
-- removed first, so nobody else loses their shared data.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  for hid in select household_id from public.household_members where user_id = auth.uid() loop
    perform public.remove_from_household(hid, auth.uid());
  end loop;
  delete from public.join_failures where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.remove_from_household(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.rotate_invite_code(uuid) from public, anon;
revoke execute on function public.leave_household(uuid) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.create_household(text) from public, anon;
revoke execute on function public.join_household(text) from public, anon;
grant execute on function public.rotate_invite_code(uuid) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;

-- --------------------------------------------------------- document limits
-- 54000 (not 23514), so the app doesn't mistake a limit for "your database
-- setup is older than this app".
create or replace function public.docs_limits() returns trigger
language plpgsql as $$
begin
  if length(new.id) > public.aw_limit('id_length') then
    raise exception 'Document id is too long' using errcode = '54000';
  end if;
  if new.data is not null and octet_length(new.data::text) > public.aw_limit('doc_bytes') then
    raise exception 'Document is too large' using errcode = '54000';
  end if;
  return new;
end $$;

drop trigger if exists docs_limits on public.docs;
create trigger docs_limits before insert or update on public.docs
for each row execute function public.docs_limits();

-- Checked once per statement, not per row, so bulk syncs stay fast.
create or replace function public.docs_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  over_limit uuid;
begin
  select g.household_id into over_limit
  from (select distinct household_id from new_rows) g
  where (select count(*) from public.docs d where d.household_id = g.household_id)
        > public.aw_limit('docs_per_household')
  limit 1;
  if over_limit is not null then
    raise exception 'This household has reached its limit of saved items' using errcode = '54000';
  end if;
  return null;
end $$;

drop trigger if exists docs_quota on public.docs;
create trigger docs_quota after insert on public.docs
referencing new table as new_rows
for each statement execute function public.docs_quota();
