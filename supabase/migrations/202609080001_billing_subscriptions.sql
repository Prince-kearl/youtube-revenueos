-- Real Stripe billing for Tubify itself (not to be confused with connected_integrations.stripe,
-- which is a creator's OWN business Stripe account connected for revenue attribution). This is the
-- record of what a Tubify user actually pays Tubify — the prerequisite for any honest commission
-- calculation on the Affiliate Program page, which previously showed entirely fabricated numbers
-- because no real subscription/payment data existed anywhere in the app.
alter table public.profiles add column if not exists stripe_customer_id text unique;

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid'
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_price_id text not null,
  plan_id text not null,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  status public.subscription_status not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index subscriptions_user_idx on public.subscriptions(user_id, created_at desc);

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

-- Users can only ever read their own subscription rows — every write comes from the Stripe
-- webhook handler using the service-role client, never directly from a user's own session, since
-- subscription state must only ever reflect what Stripe actually confirmed.
create policy subscriptions_owner_read on public.subscriptions for select using (user_id = auth.uid());
