-- Profile identity and customer-id protection (M1b). Requires 202610170001 (M1a).
--
-- Row-level security is not relied on alone for these profile columns: profiles_self_update pins
-- some of them, but a policy is a row check, not column immutability, and it does not cover a
-- profile a user creates themselves. This trigger enforces, for a signed-in user's OWN requests
-- (the database roles "authenticated" and "anon"):
--
--   * stripe_customer_id, stripe_test_customer_id, role, referral_code, referred_by: never
--     changed — an attempt is refused (42501). On a profile the user creates themselves they
--     start as the defaults (no customer ids, role 'user', no referral code, no referrer), so a
--     self-created profile cannot claim a referrer (and with it referral commissions).
--   * email: set only to the email in the user's own verified session token; any other value is
--     ignored and the stored email is kept. The profile routes write the signed-in email back
--     (api.profile.ts), so they keep working. profiles.email is a convenience copy: no
--     authentication action trusts it (admin impersonation, password reset, invitations and
--     checkout resolve the account through Supabase Auth by its id).
--
-- Unaffected — other database roles: the service role (the Stripe webhook writing customer ids,
-- admin role changes, the referral-code backfill), handle_new_user (SECURITY DEFINER, runs as its
-- owner, including for admin invites) and migrations or dashboard edits.
--
-- SECURITY INVOKER on purpose: current_user is then the role of the request itself. NOTE for later
-- migrations: a SECURITY DEFINER function that writes profiles runs as its owner and is NOT
-- checked here — it must validate what it writes itself.
--
-- Rollback (independent of M1a; the billing code does not depend on this):
--   begin;
--   drop trigger if exists profiles_protect_billing_identity on public.profiles;
--   drop function if exists public.protect_profile_billing_identity();
--   commit;
-- The profiles_self_update policy below is left in place on rollback: it differs from the one in
-- 202609130002_rbac_data.sql only by also pinning stripe_test_customer_id, which stays correct
-- while M1a's column exists.

begin;

-- Depends on M1a: refuse to run without its column, rather than half-applying.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'stripe_test_customer_id'
  ) then
    raise exception 'apply 202610170001_stripe_livemode_separation.sql first';
  end if;
end;
$$;

create or replace function public.protect_profile_billing_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  session_email text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  session_email := nullif(auth.jwt() ->> 'email', '');

  if tg_op = 'INSERT' then
    new.stripe_customer_id := null;
    new.stripe_test_customer_id := null;
    new.role := 'user';
    new.referral_code := null;
    new.referred_by := null;
    new.email := session_email;
    return new;
  end if;

  if new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_test_customer_id is distinct from old.stripe_test_customer_id
     or new.role is distinct from old.role
     or new.referral_code is distinct from old.referral_code
     or new.referred_by is distinct from old.referred_by then
    raise exception 'protected profile field is not writable'
      using errcode = '42501';
  end if;

  if new.email is distinct from old.email and new.email is distinct from session_email then
    new.email := old.email;
  end if;

  return new;
end;
$$;

-- A trigger function is never called directly; nobody needs EXECUTE on it (PostgreSQL checks it
-- when the trigger is created, not when it fires — the same convention as
-- 202610140001_deal_videos.sql).
revoke all on function public.protect_profile_billing_identity() from public, anon, authenticated, service_role;

drop trigger if exists profiles_protect_billing_identity on public.profiles;
create trigger profiles_protect_billing_identity
  before insert or update on public.profiles
  for each row execute function public.protect_profile_billing_identity();

-- The existing row-level check (202609130002_rbac_data.sql) now also pins stripe_test_customer_id,
-- as it already pins stripe_customer_id.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role is not distinct from (select p.role from public.profiles p where p.id = auth.uid())
    and stripe_customer_id is not distinct from (
      select p.stripe_customer_id from public.profiles p where p.id = auth.uid()
    )
    and stripe_test_customer_id is not distinct from (
      select p.stripe_test_customer_id from public.profiles p where p.id = auth.uid()
    )
    and referral_code is not distinct from (
      select p.referral_code from public.profiles p where p.id = auth.uid()
    )
    and referred_by is not distinct from (
      select p.referred_by from public.profiles p where p.id = auth.uid()
    )
  );

commit;
