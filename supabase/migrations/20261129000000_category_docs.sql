-- Categories sync as one document each ('category'), instead of one document
-- holding the whole list, so two people editing different categories no
-- longer overwrite each other. Only widens the allowed kinds; existing data
-- is untouched (the old 'categories' document stays, for phones that haven't
-- updated yet). Safe to run more than once.
--
-- Run this BEFORE the app update that goes with it: until then, categories
-- stay on each phone (everything else keeps syncing) and the household sheet
-- says the database needs updating.
-- NOTE: re-running 20261024000000_households.sql afterwards narrows the list
-- of kinds again; if you do, run this file again.
alter table public.docs drop constraint if exists docs_kind_check;
alter table public.docs add constraint docs_kind_check
  check (kind in ('item', 'product', 'layout', 'categories', 'category', 'list', 'purchase'));
