-- Real backing store for the Projects page's AI concept generator, replacing the client-only
-- mock queue (src/lib/mock-generation.ts) that never persisted anything server-side. Reuses the
-- existing public.job_status enum ('queued' | 'processing' | 'completed' | 'failed') from the
-- initial schema instead of introducing a near-duplicate type.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  prompt text not null,
  status public.job_status not null default 'queued',
  output jsonb,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index projects_user_created_idx on public.projects(user_id, created_at desc);

create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

create policy projects_owner on public.projects for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
