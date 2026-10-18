-- Admin console → Users at scale (Phase 1A), step 2 of 3: start keeping the directory current.
-- Run ON ITS OWN in the Supabase SQL editor, after 202610180001 and before the backfill.
--
-- Locking. CREATE TRIGGER takes a SHARE ROW EXCLUSIVE lock on the table, which conflicts with
-- every INSERT/UPDATE/DELETE on it and is held until this transaction commits. This transaction
-- does nothing else — no backfill, no index build — so the lock is held for milliseconds. To avoid
-- the dangerous case (waiting behind a long-running transaction while sign-ins and sign-ups queue
-- up behind *our* waiting lock request), lock_timeout makes it give up after 3 seconds instead.
--
-- If it fails with "canceling statement due to lock timeout": nothing was changed (the whole
-- transaction rolls back). Wait a moment and run this file again. It is idempotent.
--
-- Order. The triggers are installed before the backfill, so every account created or changed
-- while the backfill runs is written by a trigger, and the backfill (which only inserts missing
-- rows) never overwrites those newer values.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

drop trigger if exists admin_user_directory_profile_sync on public.profiles;
create trigger admin_user_directory_profile_sync
  after insert or update of name, role on public.profiles
  for each row execute function public.admin_user_directory_sync_profile();

drop trigger if exists admin_user_directory_auth_sync on auth.users;
create trigger admin_user_directory_auth_sync
  after update of email, email_confirmed_at, banned_until, last_sign_in_at, raw_user_meta_data
  on auth.users
  for each row execute function public.admin_user_directory_sync_auth();

commit;
