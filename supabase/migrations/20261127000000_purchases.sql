-- Purchase history ('purchase' docs, one per thing bought on a trip) feeds
-- the Buy again section. Allow the new kind; existing data is untouched.
alter table public.docs drop constraint if exists docs_kind_check;
alter table public.docs add constraint docs_kind_check
  check (kind in ('item', 'product', 'layout', 'categories', 'list', 'purchase'));
