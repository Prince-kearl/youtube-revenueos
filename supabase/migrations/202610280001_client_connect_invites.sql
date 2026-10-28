-- Client connect links, and a per-workspace channel limit for agencies.
--
-- An agency manages clients' YouTube channels. A client usually gives the agency access in
-- YouTube Studio (Settings → Permissions); Google does not let any app reach such a channel
-- through the agency's own login. So the agency sends the client a connect link instead: the
-- client signs in with THEIR Google account, approves, and the one channel they choose is
-- attached to the agency's workspace (src/routes/api.connect-invites*.ts and the OAuth callback).
--
-- channel_connect_invites — one row per link:
--   * only a SHA-256 hash of the link's secret is stored; the link itself is shown once;
--   * single use (used_at), expiring (expires_at), revocable (revoked_at);
--   * created by an owner or manager of the workspace (created_by), for that workspace only.
--   Server only: RLS on with no policies, and no client-role privileges.
--
-- youtube_connections.granted_via_invite_id — set on a connection a client granted through a
-- link. The authorization belongs to the client (google_subject_id / google_email are the
-- client's); user_id stays the workspace member who sent the link (it is NOT NULL and is
-- display/audit only). The app never lets the workspace browse or attach the client's other
-- channels through such a connection (api.youtube.connections.ts refuses it).
--
-- workspaces.channel_limit_override — set by platform staff for agency workspaces: the channel
-- limit becomes the larger of the plan's and this. It grants no access by itself (a plan, trial,
-- transition or staff exception is still required). Members can read it; nobody writes it from a
-- client (workspaces has no member write privilege).
--
-- Rollback:
--   begin;
--   alter table public.workspaces drop column if exists channel_limit_override;
--   alter table public.youtube_connections drop column if exists granted_via_invite_id;
--   drop table if exists public.channel_connect_invites;
--   commit;

begin;
set local lock_timeout = '3s';

create table if not exists public.channel_connect_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  token_hash text not null unique check (char_length(token_hash) = 64),
  label text check (label is null or char_length(label) between 1 and 80),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_channel_id uuid references public.youtube_channels(id) on delete set null,
  -- A client whose Google account has several channels picks one; meanwhile the grant waits here.
  pending_connection_id uuid references public.youtube_connections(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists channel_connect_invites_workspace_idx
  on public.channel_connect_invites (workspace_id, created_at desc);

alter table public.channel_connect_invites enable row level security;
revoke all on public.channel_connect_invites from anon, authenticated;

alter table public.youtube_connections
  add column if not exists granted_via_invite_id uuid
    references public.channel_connect_invites(id) on delete set null;

alter table public.workspaces
  add column if not exists channel_limit_override integer
    check (channel_limit_override is null or channel_limit_override between 1 and 500);

commit;
