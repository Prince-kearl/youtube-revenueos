-- Real referral tracking + commission ledger for the Affiliate Program page. Commission amounts
-- are only ever written by the Stripe webhook handler, computed from a real invoice.paid event for
-- a referred user's subscription (see api.stripe.webhook.ts) — never entered manually or
-- fabricated, since this is literally what determines what a real person is owed.
alter table public.profiles add column if not exists referral_code text unique;
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id) on delete set null;

create table public.referral_clicks (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  privacy_id uuid not null,
  created_at timestamptz not null default timezone('utc', now())
);

-- One row per (referrer, visitor) — a visitor reloading the referral link repeatedly shouldn't
-- inflate the click count used for the real conversion-rate calculation.
create unique index referral_clicks_referrer_privacy_idx on public.referral_clicks(referrer_id, privacy_id);
create index referral_clicks_referrer_created_idx on public.referral_clicks(referrer_id, created_at desc);

create table public.referral_commissions (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  stripe_invoice_id text not null unique,
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'usd',
  commission_cents bigint not null check (commission_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz not null default timezone('utc', now())
);

create index referral_commissions_referrer_created_idx
  on public.referral_commissions(referrer_id, created_at desc);

-- Backfills referral_code for every existing profile (new ones get it from the updated
-- handle_new_user trigger below) — derived from the user's own id, so it's deterministic and
-- needs no random-collision retry loop.
update public.profiles
set referral_code = lower(substr(replace(id::text, '-', ''), 1, 10))
where referral_code is null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, avatar, referral_code, referred_by)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'avatar_url',
    lower(substr(replace(new.id::text, '-', ''), 1, 10)),
    (select id from public.profiles where referral_code = new.raw_user_meta_data ->> 'referred_by_code')
  );
  return new;
end;
$$;

alter table public.referral_clicks enable row level security;
alter table public.referral_commissions enable row level security;

create policy referral_clicks_owner on public.referral_clicks for select using (referrer_id = auth.uid());
create policy referral_commissions_owner on public.referral_commissions for select using (referrer_id = auth.uid());
