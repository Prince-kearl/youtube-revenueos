-- Real backing store for the AI Freebie Generator, replacing the client-only MockLlmService
-- output (never persisted) and the hardcoded "Lead Performance" sample rows. There is no public
-- distribution/opt-in page yet, so this deliberately has no downloads/opt-in tracking columns —
-- nothing would ever write them. Add those only alongside a real distribution feature.
create table public.lead_magnets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  product text not null,
  audience text not null,
  tone text not null,
  format text not null,
  content text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index lead_magnets_user_created_idx on public.lead_magnets(user_id, created_at desc);

alter table public.lead_magnets enable row level security;

create policy lead_magnets_owner on public.lead_magnets for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
