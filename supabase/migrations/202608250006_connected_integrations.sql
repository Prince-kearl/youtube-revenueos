create table public.connected_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('google_analytics', 'stripe', 'kit')),
  provider_account_id text,
  account_name text,
  access_token_ciphertext bytea not null,
  refresh_token_ciphertext bytea,
  token_expiry timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider)
);

create trigger connected_integrations_updated_at before update on public.connected_integrations for each row execute function public.set_updated_at();
alter table public.connected_integrations enable row level security;
create policy connected_integrations_owner on public.connected_integrations for all using (user_id = auth.uid()) with check (user_id = auth.uid());