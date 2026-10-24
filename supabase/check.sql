-- Aisle Wise: is live sharing set up? Run in the Supabase SQL editor.
-- Every row should say OK. Changes nothing.
select part, case when ok then 'OK' else 'MISSING – run the setup script' end as status
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
    and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('households', 'household_members', 'docs')) >= 7),
  ('7. live updates for docs',
    exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'))
) as t(part, ok)
order by part;
