-- Real multi-tenant workspaces, replacing the client-only "Team" demo (TeamMember/useTeam in
-- stores.ts, localStorage, never persisted, never actually granted access to anything). A
-- workspace is the real tenant boundary going forward — every account gets one automatically
-- (itself, as owner), and an invited teammate becomes a real member of an EXISTING workspace
-- with real shared access to its data, gated by a real role.
--
-- IMPORTANT — workspace_members.role is a DIFFERENT axis from profiles.role, even though both
-- happen to use the labels owner/manager/setter/editor. profiles.role governs platform-staff
-- concerns (the Superadmin console, requirePermission/requireAdminUser) and is NEVER read by any
-- workspace-membership code. Every signed-up user becomes "owner" of their own workspace by
-- default — if that were ever confused with profiles.role's 'owner' (a rare, powerful platform
-- staff role), every new signup would silently gain Superadmin-console permissions. Keep these
-- two systems structurally separate: workspace_members.role only ever feeds
-- getWorkspaceContext()/requireWorkspaceFeature() in src/lib/server/workspace.ts, never
-- requirePermission/requireAdminUser/canAccessConsole.
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index workspaces_owner_idx on public.workspaces(owner_id);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Null until the invite is accepted (or immediately, for an invite to an existing Tubify
  -- account — see api.workspace.members.ts, which auto-joins existing users since there's no
  -- real notification system yet to make a separate "pending accept" step meaningful).
  user_id uuid references public.profiles(id) on delete cascade,
  invited_email text not null,
  role text not null check (role in ('owner', 'manager', 'setter', 'editor')),
  status text not null default 'invited' check (status in ('invited', 'active', 'removed')),
  lead_share integer not null default 0 check (lead_share between 0 and 100),
  commission integer not null default 0 check (commission between 0 and 100),
  invited_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default timezone('utc', now()),
  joined_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- A given real account can only hold one membership row per workspace (re-inviting updates the
-- existing row rather than duplicating it). A given email can only have one *pending* invite per
-- workspace — enforced separately below since user_id is null for those.
create unique index workspace_members_workspace_user_idx
  on public.workspace_members(workspace_id, user_id) where user_id is not null;
create unique index workspace_members_workspace_email_pending_idx
  on public.workspace_members(workspace_id, invited_email) where status = 'invited';
create index workspace_members_user_idx on public.workspace_members(user_id);

create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function public.set_updated_at();
create trigger workspace_members_updated_at before update on public.workspace_members
  for each row execute function public.set_updated_at();

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

-- Members can see their own workspace(s) and roster — never other workspaces.
create policy workspaces_member_read on public.workspaces for select using (
  id in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and status = 'active'
  )
);
create policy workspace_members_read on public.workspace_members for select using (
  workspace_id in (
    select workspace_id from public.workspace_members
    where user_id = auth.uid() and status = 'active'
  )
);
-- Writes (invite/change role/remove) go through the service-role client in
-- api.workspace.members.ts after requireWorkspaceFeature + a real hierarchy check — no client-
-- writable policy is granted here, same pattern as role_feature_access/plan_prices.

-- ============================================================
-- Add workspace_id to every table that was previously scoped by user_id alone (or, for
-- youtube_channels' dependents, by a join through it). The existing user_id/channel_id columns
-- are kept as-is (now read as "created by" / "the channel this row belongs to") — workspace_id is
-- the new tenant-scoping column RLS actually filters on.
-- ============================================================
alter table public.youtube_channels add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.destinations add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.campaigns add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.tracking_links add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.leads add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.deals add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.notifications add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.jobs add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.connected_integrations add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.projects add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.lead_magnets add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
