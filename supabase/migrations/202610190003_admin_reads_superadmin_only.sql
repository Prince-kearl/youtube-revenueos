-- Admin console access is Superadmin only (src/lib/server/roles.ts, CONSOLE_ROLES). These three
-- read policies still let a platform Owner read the admin tables straight through the Supabase API
-- with their own session — the same data the console APIs now refuse them. Recreate each with
-- Superadmin only; nothing else about them changes (SELECT only; there are no write policies, so
-- writes stay service-role only).
--
-- Policy changes only: no data is touched. One short transaction; lock_timeout keeps it from
-- waiting behind a long-running query (re-run it if it times out).
--
-- Rollback (restores the previous rule):
--   begin;
--   drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
--   create policy admin_audit_log_admin_read on public.admin_audit_log for select using (
--     exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('superadmin', 'owner')));
--   (and the same for app_releases_admin_read and plan_audit_log_admin_read)
--   commit;

begin;
set local lock_timeout = '3s';

drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
create policy admin_audit_log_admin_read on public.admin_audit_log for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'superadmin'
  )
);

drop policy if exists app_releases_admin_read on public.app_releases;
create policy app_releases_admin_read on public.app_releases for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'superadmin'
  )
);

drop policy if exists plan_audit_log_admin_read on public.plan_audit_log;
create policy plan_audit_log_admin_read on public.plan_audit_log for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'superadmin'
  )
);

commit;
