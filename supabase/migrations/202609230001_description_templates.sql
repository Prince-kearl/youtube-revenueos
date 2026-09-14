-- Real backing store for AI Lab's "Description Template" presets — a named, reusable combination
-- of Brand Voice + featured destination + custom instructions, so a creator can save their usual
-- generation settings under a recognizable name instead of re-picking them for every video.
create table public.description_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  voice text not null,
  destination_id uuid references public.destinations(id) on delete set null,
  custom_instructions text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index description_templates_workspace_idx
  on public.description_templates(workspace_id, created_at desc);

create trigger description_templates_updated_at before update on public.description_templates
  for each row execute function public.set_updated_at();

alter table public.description_templates enable row level security;

-- Same workspace-membership shape as every other direct tenant table (destinations, campaigns,
-- etc. — see 202609170003_workspaces_rls.sql) rather than a bespoke policy.
create policy description_templates_workspace on public.description_templates for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));
