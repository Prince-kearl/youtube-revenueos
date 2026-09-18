-- Freebie overhaul: a real knowledge base to ground generation in the creator's own material, a
-- per-workspace brand kit, publishing a freebie as a real public opt-in page, and an "upload your
-- own finished freebie" path that skips AI generation entirely. See api.knowledge.ts,
-- api.workspace.branding.ts, api.freebies.ts, api.freebies.optin.ts, and f.$slug.tsx.

-- ============================================================
-- Storage: one private bucket for everything creators upload (knowledge files, freebie deliverable
-- files, brand logos). Never served directly — always through a short-lived signed URL generated
-- server-side (see src/lib/server/storage.ts), even for public freebie downloads, so nothing here
-- needs to be a public bucket.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('workspace-files', 'workspace-files', false)
on conflict (id) do nothing;

drop policy if exists workspace_files_workspace_rw on storage.objects;
create policy workspace_files_workspace_rw on storage.objects for all
  using (
    bucket_id = 'workspace-files'
    and public.is_active_workspace_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'workspace-files'
    and public.is_active_workspace_member((storage.foldername(name))[1]::uuid)
  );

-- ============================================================
-- Knowledge base: real material (pasted notes, transcripts, or uploaded files) a creator drops in
-- so generation can draw on it instead of inventing everything. `lead_magnet_id` null = available
-- to every freebie in the workspace; set = attached to just that one freebie.
-- ============================================================
create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  lead_magnet_id uuid references public.lead_magnets(id) on delete cascade,
  title text not null,
  kind text not null check (kind in ('note', 'file')),
  content text,
  file_path text,
  file_name text,
  file_type text,
  file_size bigint,
  -- 'ready' once `content` has usable text (typed directly, or extracted from a supported file
  -- type); 'unsupported' when the file type can't be text-extracted (still stored, just excluded
  -- from generation prompts); 'failed' when extraction was attempted and errored.
  extraction_status text not null default 'ready'
    check (extraction_status in ('ready', 'unsupported', 'failed')),
  created_at timestamptz not null default timezone('utc', now())
);

create index knowledge_items_workspace_idx on public.knowledge_items(workspace_id, created_at desc);
create index knowledge_items_lead_magnet_idx
  on public.knowledge_items(lead_magnet_id) where lead_magnet_id is not null;

alter table public.knowledge_items enable row level security;
create policy knowledge_items_workspace on public.knowledge_items for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

-- ============================================================
-- Brand kit: logo/colors/font applied to a freebie's public page. Per workspace (this app has no
-- per-workspace branding of any kind yet — see api.workspace.branding.ts). Read is open to any
-- active member; writes go through the service client gated by canManageWorkspaceMembers in app
-- code, same reasoning as workspaces.custom_domain (202609260001).
-- ============================================================
create table public.workspace_branding (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  logo_path text,
  primary_color text,
  accent_color text,
  font_family text,
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger workspace_branding_updated_at before update on public.workspace_branding
  for each row execute function public.set_updated_at();

alter table public.workspace_branding enable row level security;
create policy workspace_branding_read on public.workspace_branding for select using (
  public.is_active_workspace_member(workspace_id)
);

-- ============================================================
-- lead_magnets: publishing + an "uploaded" alternative to AI generation.
-- ============================================================
alter table public.lead_magnets
  add column if not exists slug text,
  add column if not exists status text not null default 'draft' check (status in ('draft', 'published')),
  add column if not exists source text not null default 'generated' check (source in ('generated', 'uploaded')),
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_type text,
  add column if not exists teaser text,
  add column if not exists views bigint not null default 0 check (views >= 0),
  add column if not exists published_at timestamptz;

-- `content` was `not null` for the AI-generated-only era; an uploaded freebie has no Markdown body.
alter table public.lead_magnets alter column content drop not null;

create unique index if not exists lead_magnets_slug_idx
  on public.lead_magnets (slug) where slug is not null;

create or replace function public.increment_lead_magnet_views(p_lead_magnet_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.lead_magnets set views = views + 1 where id = p_lead_magnet_id;
$$;
-- Public page runs as an anonymous visitor and calls this via the service role client (like
-- increment_link_clicks), so no grant to anon/authenticated is needed here either.

-- ============================================================
-- Opt-ins: one row per real visitor who traded their email for the freebie. Each opt-in also
-- upserts a real "Email" lead into the same Lead Inbox every other channel feeds (see
-- api.freebies.optin.ts) — `lead_id` links back to it.
-- ============================================================
create table public.lead_magnet_optins (
  id uuid primary key default gen_random_uuid(),
  lead_magnet_id uuid not null references public.lead_magnets(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  name text,
  lead_id uuid references public.leads(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index lead_magnet_optins_lead_magnet_idx
  on public.lead_magnet_optins(lead_magnet_id, created_at desc);
create index lead_magnet_optins_workspace_idx
  on public.lead_magnet_optins(workspace_id, created_at desc);

alter table public.lead_magnet_optins enable row level security;
create policy lead_magnet_optins_workspace_read on public.lead_magnet_optins for select using (
  public.is_active_workspace_member(workspace_id)
);
-- Inserts come only from api.freebies.optin.ts (public route, service role client) — no
-- anon/authenticated insert policy needed, same reasoning as link_click_events.
