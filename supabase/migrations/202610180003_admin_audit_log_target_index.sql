-- Admin console → Users at scale (Phase 1A), step 3 of 3: the index behind a user's "recent admin
-- actions", which are now looked up by the account's immutable id (admin_audit_log.target).
--
-- CREATE INDEX CONCURRENTLY builds the index without blocking writes to admin_audit_log. It
-- cannot run inside a transaction, so this file holds exactly one statement and must be run ON ITS
-- OWN in the Supabase SQL editor (never pasted together with anything else).
--
-- If it is interrupted it can leave an INVALID index behind; check with
--   select indexrelid::regclass, indisvalid from pg_index
--   where indexrelid = 'public.admin_audit_log_target_created_idx'::regclass;
-- and, if indisvalid is false, run `drop index concurrently public.admin_audit_log_target_created_idx;`
-- (also on its own) before running this file again.
create index concurrently if not exists admin_audit_log_target_created_idx
  on public.admin_audit_log (target, created_at desc);
