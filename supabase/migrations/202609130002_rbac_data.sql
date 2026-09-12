-- Promote existing 'admin' accounts to the real 'superadmin' role — the safest, most defensible
-- mapping given the app previously only distinguished admin/user (see the audit in this task's
-- plan: no existing data justifies mapping anyone to owner/manager/setter/editor, so nobody is
-- silently assigned one of those). 'user' rows are left untouched. 'admin' itself is never
-- reassigned automatically after this point — it stays in the enum only for historical safety.
update public.profiles set role = 'superadmin' where role = 'admin';

-- role_feature_access previously only accepted the two real roles that existed at the time
-- (user/admin). Widen it to the full canonical set, and migrate any existing 'admin' override
-- rows to 'superadmin' so a Superadmin's previously-configured feature access isn't silently lost.
-- Safe to run more than once: drops-then-adds regardless of whether a previous partial run of
-- this file already got this far before failing later on (Postgres has no
-- "add constraint if not exists", so this uses a plain drop-if-exists immediately before adding).
alter table public.role_feature_access drop constraint if exists role_feature_access_role_check;
update public.role_feature_access set role = 'superadmin' where role = 'admin';
alter table public.role_feature_access drop constraint if exists role_feature_access_role_check;
alter table public.role_feature_access
  add constraint role_feature_access_role_check
  check (role in ('user', 'editor', 'setter', 'manager', 'owner', 'superadmin'));

-- Seed default feature access for the 4 newly-real roles (owner/manager/setter/editor) —
-- everything enabled, exactly matching current app behavior (these roles didn't exist as a real
-- distinction before, so nothing should be hidden from anyone on migration day). Superadmin can
-- restrict per-role from the Feature Management UI afterward.
insert into public.role_feature_access (role, feature_id, enabled)
select r.role, f.id, true
from public.features f
cross join (values ('owner'), ('manager'), ('setter'), ('editor')) as r(role)
on conflict (role, feature_id) do nothing;

-- ============================================================
-- profiles RLS was previously a single blanket "for all using (id = auth.uid())" policy — which
-- meant any authenticated user could rewrite their OWN role, stripe_customer_id, referral_code, or
-- referred_by via a direct client-side Supabase call (e.g. from the browser console), a real
-- privilege-escalation / billing-hijack / referral-fraud hole discovered auditing this task, not
-- hypothetical. Split into a read policy (unchanged) and a narrower update policy that pins every
-- server-managed column to its current value — only the service-role client (used by
-- api.admin.users.ts after requirePermission has verified real authorization) can change them.
drop policy if exists profiles_self on public.profiles;
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_self_update on public.profiles;

create policy profiles_self_select on public.profiles for select using (id = auth.uid());

-- Four separate scalar comparisons rather than one row-constructor comparison — Postgres's
-- `IS DISTINCT FROM` only accepts a bare multi-column subquery on the `=` operator, not here
-- ("subquery must return only one column"), and this form sidesteps that entirely.
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role is not distinct from (select p.role from public.profiles p where p.id = auth.uid())
    and stripe_customer_id is not distinct from (
      select p.stripe_customer_id from public.profiles p where p.id = auth.uid()
    )
    and referral_code is not distinct from (
      select p.referral_code from public.profiles p where p.id = auth.uid()
    )
    and referred_by is not distinct from (
      select p.referred_by from public.profiles p where p.id = auth.uid()
    )
  );
