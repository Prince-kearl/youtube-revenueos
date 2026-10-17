-- Stripe live/test separation.
--
-- A Stripe test-mode subscription, customer or invoice costs nothing: in production it must never
-- be mistaken for a live financial record. Until now nothing stored said which mode a record was
-- in. This migration is ADDITIVE ONLY — it adds three nullable columns, an index and a profile
-- safeguard, and changes no existing value:
--
--   * subscriptions.livemode and referral_commissions.livemode: the mode Stripe reported for the
--     object, written by the webhook from the signature-verified event (api.stripe.webhook.ts).
--     NULL means "not classified": every row that exists before this migration stays NULL, and a
--     NULL row never grants a plan, never counts in a total and never shows as earnings
--     (lib/server/stripe-mode.ts, trustedLivemode). A subscription is re-classified from Stripe the
--     next time any event about it arrives. No backfill is made here: historical rows are
--     classified only once their origin has been verified, separately.
--   * profiles.stripe_test_customer_id: test-mode customer ids. From now on stripe_customer_id
--     holds LIVE customer ids only, so a test checkout (a Preview deployment sharing this
--     database, or local development) can never overwrite a customer's live id, and a test id is
--     never sent to the live API. Existing stripe_customer_id values are left exactly as they are.
--
-- No NOT NULL constraint is added: that waits until the rollout and the classification of
-- historical rows have been validated.
--
-- Order: apply this BEFORE deploying the code that reads these columns (that code filters on
-- livemode; against a database without it every plan check would fail with 503). The previous
-- code ignores the new columns, so applying this first changes nothing for it.
--
-- Rollback (only after the code that uses these columns has been reverted):
--   drop trigger if exists profiles_protect_billing_identity on public.profiles;
--   drop function if exists public.protect_profile_billing_identity();
--   -- profiles_self_update: recreate it as in 202609130002_rbac_data.sql.
--   drop index if exists public.subscriptions_user_livemode_idx;
--   alter table public.subscriptions drop column if exists livemode;
--   alter table public.referral_commissions drop column if exists livemode;
--   alter table public.profiles drop column if exists stripe_test_customer_id;
-- Dropping stripe_test_customer_id discards test customer ids only; they can be recovered from the
-- Stripe test dashboard.

-- ============================================================
-- Columns
-- ============================================================
alter table public.subscriptions add column if not exists livemode boolean;
alter table public.referral_commissions add column if not exists livemode boolean;
alter table public.profiles add column if not exists stripe_test_customer_id text unique;

comment on column public.subscriptions.livemode is
  'Stripe livemode of the subscription, from the verified webhook. NULL = not classified: never grants access.';
comment on column public.referral_commissions.livemode is
  'Stripe livemode of the invoice, from the verified webhook. NULL = not classified: never counted.';
comment on column public.profiles.stripe_customer_id is
  'LIVE-mode Stripe customer id. Written only by the Stripe webhook (service role).';
comment on column public.profiles.stripe_test_customer_id is
  'TEST-mode Stripe customer id. Written only by the Stripe webhook (service role).';

-- Plan checks read a user's newest subscription in one mode (plan-access.ts, subscription-tier.ts).
create index if not exists subscriptions_user_livemode_idx
  on public.subscriptions (user_id, livemode, created_at desc);

-- No grant changes: subscriptions and referral_commissions have owner-read policies only (no
-- insert/update/delete policy, so only the service role writes them); the new columns are covered
-- by those same policies.

-- ============================================================
-- Profile billing identity: database-level safeguard
-- ============================================================
-- Row-level security is not relied on alone for these columns. A signed-in user's own requests
-- (the database roles "authenticated" and "anon") may not change either customer id, and may not
-- set profiles.email to anything but the email in their own verified session token:
--   * stripe_customer_id / stripe_test_customer_id: an attempt to change them is refused (42501);
--     on a profile a user creates themselves they start empty;
--   * email: a change to a value other than the session's own email is ignored (the stored email
--     is kept), so the profile editor — which writes the signed-in email back — keeps working,
--     but an account can no longer claim someone else's email. Admin impersonation, admin password
--     resets and team-invite matching read profiles.email.
-- The service role (the webhook, admin routes), the signup trigger handle_new_user (security
-- definer, runs as its owner) and migrations are other database roles: unaffected.
--
-- SECURITY INVOKER on purpose: current_user is then the role of the request itself.
create or replace function public.protect_profile_billing_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  session_email text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  session_email := auth.jwt() ->> 'email';

  if tg_op = 'INSERT' then
    new.stripe_customer_id := null;
    new.stripe_test_customer_id := null;
    new.email := session_email;
    return new;
  end if;

  if new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_test_customer_id is distinct from old.stripe_test_customer_id then
    raise exception 'profile billing identity is not writable'
      using errcode = '42501';
  end if;

  if new.email is distinct from old.email and new.email is distinct from session_email then
    new.email := old.email;
  end if;

  return new;
end;
$$;

-- A trigger function is never called directly; nobody needs EXECUTE on it (triggers fire
-- regardless of it — the same convention as 202610140001_deal_videos.sql).
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
