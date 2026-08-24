create table public.two_factor_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index two_factor_recovery_codes_user_idx
  on public.two_factor_recovery_codes(user_id, used_at);

alter table public.two_factor_recovery_codes enable row level security;