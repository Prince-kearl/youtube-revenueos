-- Links between brand deals and the videos they cover (Phase 2B-2). Many-to-many: a deal can
-- cover several videos and a video can carry several deals. This table records ONLY the link —
-- no amount of any kind. How much of a deal's value is attributed to a video is computed when it
-- is read (equal split, see the application code), so nothing here can drift from the deal.
--
-- Safe to apply before the application code that uses it (nothing reads or writes it until
-- then), and safe to re-run. It changes no existing row, policy or privilege; on three existing
-- tables it adds only a guard trigger (below) that refuses one specific kind of update.
--
-- Who can reach it:
--   * active members of the workspace may READ its links (row-level security), exactly like the
--     non-monetary columns of `deals`;
--   * nobody but the service role may write it. Linking changes how a deal's value is spread
--     across videos, so — like every write to `deals` since the revenue-column-privacy migration —
--     it happens only in the application, after its own checks (brand_deals feature and revenue
--     write access). Every privilege is set explicitly here; nothing relies on default grants.
--
-- Workspace integrity, enforced in the database and not only in the API:
--   * a link is accepted only if the deal's workspace and the video's workspace (through its
--     channel) are both the link's own workspace;
--   * afterwards, an update that would move a linked deal, a linked video (to another channel) or
--     the channel of a linked video into a different workspace is REFUSED rather than allowed to
--     leave a link pointing across workspaces. The application never makes such a move today
--     (channels are matched on (workspace_id, youtube_channel_id), deals keep their workspace),
--     so this refuses nothing the application does; it exists so that no route, member session
--     or manual edit can create a cross-workspace link indirectly. To move such a row, unlink
--     first.
--
-- The trigger functions are SECURITY DEFINER with an empty search_path and fully qualified
-- names, so their checks see every row whatever the caller may see. They cannot be called
-- directly (they are trigger functions) and EXECUTE is revoked from everyone regardless.
--
-- NOTE for later migrations: dropping and re-creating a function restores EXECUTE to PUBLIC;
-- `create or replace` keeps the privileges set here.

begin;

create table if not exists public.deal_videos (
  deal_id      uuid        not null references public.deals(id)      on delete cascade,
  video_id     uuid        not null references public.videos(id)     on delete cascade,
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  created_by   uuid                 references public.profiles(id)   on delete set null,
  created_at   timestamptz not null default timezone('utc', now()),
  primary key (deal_id, video_id)
);

-- (deal_id, …) is served by the primary key.
create index if not exists deal_videos_video_idx on public.deal_videos (video_id);
create index if not exists deal_videos_workspace_idx on public.deal_videos (workspace_id);

-- ---------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------
alter table public.deal_videos enable row level security;

revoke all on table public.deal_videos from public, anon, authenticated, service_role;
grant select on table public.deal_videos to authenticated;
grant select, insert, delete on table public.deal_videos to service_role;

drop policy if exists deal_videos_workspace_read on public.deal_videos;
create policy deal_videos_workspace_read on public.deal_videos
  for select to authenticated
  using (public.is_active_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------------------------
-- Workspace integrity: the link itself
-- ---------------------------------------------------------------------------------------------
create or replace function public.deal_videos_check_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal_workspace  uuid;
  v_video_workspace uuid;
begin
  -- FOR SHARE: the deal, video and channel rows stay locked until this link is committed, so a
  -- concurrent move of any of them waits for it (and is then refused by its guard below), and a
  -- move already in progress makes this check wait and re-read the moved row. Without the locks,
  -- a link and a move in two simultaneous transactions could each pass their check.
  select d.workspace_id into v_deal_workspace
  from public.deals d
  where d.id = new.deal_id
  for share;

  select c.workspace_id into v_video_workspace
  from public.videos v
  join public.youtube_channels c on c.id = v.channel_id
  where v.id = new.video_id
  for share;

  -- A missing deal or video, or one whose workspace is NULL, finds no workspace here and is
  -- refused (the foreign keys would refuse a missing one as well).
  if v_deal_workspace is distinct from new.workspace_id
     or v_video_workspace is distinct from new.workspace_id then
    raise exception 'deal and video must belong to the link''s workspace'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists deal_videos_check_workspace on public.deal_videos;
create trigger deal_videos_check_workspace
  before insert or update on public.deal_videos
  for each row execute function public.deal_videos_check_workspace();

-- ---------------------------------------------------------------------------------------------
-- Workspace integrity: later moves of a linked deal, video or channel
-- (each fires only when the relevant column really changes)
-- ---------------------------------------------------------------------------------------------
create or replace function public.deal_videos_guard_deal_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.deal_videos dv
    where dv.deal_id = new.id and dv.workspace_id is distinct from new.workspace_id
  ) then
    raise exception 'deal is linked to videos in its current workspace; unlink it first'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists deal_videos_guard_deal_move on public.deals;
create trigger deal_videos_guard_deal_move
  before update of workspace_id on public.deals
  for each row
  when (old.workspace_id is distinct from new.workspace_id)
  execute function public.deal_videos_guard_deal_move();

create or replace function public.deal_videos_guard_video_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_workspace uuid;
begin
  select c.workspace_id into v_new_workspace
  from public.youtube_channels c
  where c.id = new.channel_id;

  if exists (
    select 1 from public.deal_videos dv
    where dv.video_id = new.id and dv.workspace_id is distinct from v_new_workspace
  ) then
    raise exception 'video is linked to deals in its current workspace; unlink it first'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists deal_videos_guard_video_move on public.videos;
create trigger deal_videos_guard_video_move
  before update of channel_id on public.videos
  for each row
  when (old.channel_id is distinct from new.channel_id)
  execute function public.deal_videos_guard_video_move();

create or replace function public.deal_videos_guard_channel_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.deal_videos dv
    join public.videos v on v.id = dv.video_id
    where v.channel_id = new.id and dv.workspace_id is distinct from new.workspace_id
  ) then
    raise exception 'channel has videos linked to deals in its current workspace; unlink them first'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists deal_videos_guard_channel_move on public.youtube_channels;
create trigger deal_videos_guard_channel_move
  before update of workspace_id on public.youtube_channels
  for each row
  when (old.workspace_id is distinct from new.workspace_id)
  execute function public.deal_videos_guard_channel_move();

-- The four functions run only as triggers; nobody needs EXECUTE on them.
revoke all on function public.deal_videos_check_workspace() from public, anon, authenticated, service_role;
revoke all on function public.deal_videos_guard_deal_move() from public, anon, authenticated, service_role;
revoke all on function public.deal_videos_guard_video_move() from public, anon, authenticated, service_role;
revoke all on function public.deal_videos_guard_channel_move() from public, anon, authenticated, service_role;

commit;
