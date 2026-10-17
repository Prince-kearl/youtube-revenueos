-- Stripe live/test separation — billing schema (M1a).
--
-- A Stripe test-mode subscription, customer or invoice costs nothing: in production it must never
-- be mistaken for a live financial record. Until now nothing stored said which mode a record was
-- in. This migration is SCHEMA ONLY and ADDITIVE: three nullable columns, an index and comments.
-- No existing value changes, no row is written, and no trigger, policy or privilege changes.
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
-- This is everything the billing code needs. It works on its own, before or without
-- 202610170002_profile_billing_identity.sql — which protects these profile columns in the database
-- (until it is applied, profiles_self_update does not pin stripe_test_customer_id: a user could
-- write their OWN test customer id, which only a deployment billing with a test key ever reads;
-- apply 0002 with or soon after this one).
--
-- No NOT NULL constraint is added: that waits until the rollout and the classification of
-- historical rows have been validated.
--
-- Order: apply this BEFORE deploying the code that reads these columns (that code filters on
-- livemode; against a database without it every plan check fails closed with 503). The code
-- deployed before it ignores the new columns, so applying this first changes nothing for it.
--
-- Rollback (only after the code that uses these columns has been reverted, and after rolling
-- back 202610170002 if it was applied):
--   begin;
--   drop index if exists public.subscriptions_user_livemode_idx;
--   alter table public.subscriptions drop column if exists livemode;
--   alter table public.referral_commissions drop column if exists livemode;
--   alter table public.profiles drop column if exists stripe_test_customer_id;
--   commit;
-- Dropping stripe_test_customer_id discards test customer ids only; they can be recovered from the
-- Stripe test dashboard.

begin;

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

commit;
