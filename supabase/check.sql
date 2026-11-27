-- Aisle Wise: is live sharing set up? Run in the Supabase SQL editor.
-- Every row should say OK. Changes nothing.
select part, case when ok then 'OK' else 'MISSING – run the matching file in supabase/migrations' end as status
from (values
  ('1. households table',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'households' and column_name = 'invite_code')),
  ('2. household_members table',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'household_members' and column_name = 'household_id')),
  ('3. docs table',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'docs' and column_name = 'device')),
  ('4. create_household function', to_regprocedure('public.create_household(text)') is not null),
  ('5. join_household function', to_regprocedure('public.join_household(text)') is not null),
  ('6. access rules switched on',
    coalesce((select bool_and(relrowsecurity) from pg_class
      where oid in (to_regclass('public.households'), to_regclass('public.household_members'), to_regclass('public.docs'))), false)
    and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('households', 'household_members', 'docs')) >= 6),
  ('7. live updates for docs',
    exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs')),
  ('8. named lists can sync',
    exists (select 1 from pg_constraint where conrelid = to_regclass('public.docs') and conname = 'docs_kind_check'
      and pg_get_constraintdef(oid) like '%''list''%')),
  ('9. owners and safer joining',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'household_members' and column_name = 'role')
    and to_regprocedure('public.leave_household(uuid)') is not null
    and to_regprocedure('public.rotate_invite_code(uuid)') is not null
    and to_regprocedure('public.delete_my_account()') is not null
    -- the old "any member can leave / rename" rules must be gone
    and not exists (select 1 from pg_policies where schemaname = 'public'
      and policyname in ('members can leave', 'members rename their household'))),
  ('10. size and quota limits on documents',
    exists (select 1 from pg_trigger where tgrelid = to_regclass('public.docs') and tgname = 'docs_limits' and not tgisinternal)
    and exists (select 1 from pg_trigger where tgrelid = to_regclass('public.docs') and tgname = 'docs_quota' and not tgisinternal)),
  ('11. categories and purchases can sync one by one',
    exists (select 1 from pg_constraint where conrelid = to_regclass('public.docs') and conname = 'docs_kind_check'
      and pg_get_constraintdef(oid) like '%''category''%' and pg_get_constraintdef(oid) like '%''purchase''%'))
) as t(part, ok)
order by (regexp_match(part, '^[0-9]+'))[1]::int;
