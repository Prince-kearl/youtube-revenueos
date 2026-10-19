-- Executive Dashboard growth charts at scale, step 1 of 2: the index behind "User Growth".
-- /api/admin/dashboard/growth counts profiles by created_at (one count before the chosen range,
-- one per day/week/month bucket); without this index each count reads the whole table.
--
-- CREATE INDEX CONCURRENTLY builds the index without blocking sign-ups or profile edits. It
-- cannot run inside a transaction, so this file holds exactly one statement and must be run ON ITS
-- OWN in the Supabase SQL editor (never pasted together with anything else).
--
-- If it is interrupted it can leave an INVALID index behind; check with
--   select indexrelid::regclass, indisvalid from pg_index
--   where indexrelid = 'public.profiles_created_at_idx'::regclass;
-- and, if indisvalid is false, run `drop index concurrently public.profiles_created_at_idx;`
-- (also on its own) before running this file again.
create index concurrently if not exists profiles_created_at_idx
  on public.profiles (created_at);
