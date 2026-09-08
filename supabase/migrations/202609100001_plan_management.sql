-- Database-driven plan/pricing management for Superadmin, replacing the hardcoded
-- STRIPE_PRICE_* env var mapping in billing-plans.ts. Stripe Prices are immutable once created —
-- a "price change" always inserts a new plan_prices row and marks the old one inactive rather than
-- mutating it, so existing subscribers (who reference a specific stripe_price_id on their own
-- subscriptions row, set at checkout time) are never affected by a later price change.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  currency text not null default 'usd',
  features jsonb not null default '[]'::jsonb,
  -- Free-form usage limits (e.g. {"channel_limit": 1, "ai_credits": 500}) — Tubify doesn't yet
  -- enforce numeric entitlements anywhere in the app, so this stays a flexible bag rather than
  -- fabricating specific limit columns nothing currently reads.
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  is_public boolean not null default true,
  sort_order integer not null default 0,
  stripe_product_id text unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  billing_interval text not null check (billing_interval in ('month', 'year')),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'usd',
  stripe_price_id text unique,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- A plan can have historical (inactive) prices, but only one ACTIVE price per billing interval —
-- this is what "changing a price creates a new Stripe Price and retires the old one" enforces at
-- the database level, not just in application logic.
create unique index plan_prices_one_active_per_interval
  on public.plan_prices(plan_id, billing_interval)
  where is_active;

create index plan_prices_plan_idx on public.plan_prices(plan_id);

create table public.plan_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles(id) on delete set null,
  action text not null,
  plan_id uuid references public.plans(id) on delete set null,
  plan_name text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index plan_audit_log_created_idx on public.plan_audit_log(created_at desc);

create trigger plans_updated_at before update on public.plans
  for each row execute function public.set_updated_at();
create trigger plan_prices_updated_at before update on public.plan_prices
  for each row execute function public.set_updated_at();

alter table public.plans enable row level security;
alter table public.plan_prices enable row level security;
alter table public.plan_audit_log enable row level security;

-- Public pricing (billing.tsx) needs to read active+public plans without being an admin — everyone
-- can SELECT, but only the service-role client used by admin-gated API routes can write (there is
-- deliberately no insert/update/delete policy for regular authenticated users).
create policy plans_public_read on public.plans for select using (true);
create policy plan_prices_public_read on public.plan_prices for select using (true);

-- Audit log is admin-only reading too — it can reveal pricing history/strategy.
create policy plan_audit_log_admin_read on public.plan_audit_log for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
