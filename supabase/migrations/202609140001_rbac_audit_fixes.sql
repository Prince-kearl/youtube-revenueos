-- Fixes for real regressions found in a production-readiness audit of the 202609130002_rbac_data.sql
-- migration. Two classes of bug, both from the same root cause (the old 'admin' role value was
-- renamed to 'superadmin' in data, but a few RLS policies and app-level enums were never updated
-- to match):
--
-- 1. profiles had its old "for all" self policy replaced with SELECT + UPDATE only — no INSERT
--    policy was ever added. PostgREST's .upsert() (used by api.profile.ts's PATCH handler, and by
--    its GET handler's first-time-profile fallback) compiles to INSERT ... ON CONFLICT DO UPDATE,
--    which requires INSERT privilege even when the row already exists and the statement always
--    resolves to the UPDATE branch. Net effect: every profile save was broken for every user.
--
-- 2. app_releases_admin_read / admin_audit_log_admin_read / plan_audit_log_admin_read still check
--    `p.role = 'admin'` — a value no profile has carried since the previous migration promoted
--    every such row to 'superadmin'. These three read policies matched zero rows, so Version
--    Control's release list and both audit-log feeds silently rendered empty for real superadmins.
--    Fixed to check ('superadmin', 'owner'), matching that Owner also holds manage_releases/
--    view_audit_logs/manage_plans in src/lib/server/roles.ts's ROLE_PERMISSIONS — these read
--    policies should reflect the same authority the application layer already grants Owner.

-- Self-insert only, and only with the safe default role — a client-driven insert (the profile
-- fallback paths in api.profile.ts) can never create its own row with anything but 'user',
-- mirroring the column default and closing off role smuggling at row-creation time too.
create policy profiles_self_insert on public.profiles for insert
  with check (id = auth.uid() and role = 'user');

drop policy if exists app_releases_admin_read on public.app_releases;
create policy app_releases_admin_read on public.app_releases for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('superadmin', 'owner')
  )
);

drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
create policy admin_audit_log_admin_read on public.admin_audit_log for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('superadmin', 'owner')
  )
);

drop policy if exists plan_audit_log_admin_read on public.plan_audit_log;
create policy plan_audit_log_admin_read on public.plan_audit_log for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('superadmin', 'owner')
  )
);
