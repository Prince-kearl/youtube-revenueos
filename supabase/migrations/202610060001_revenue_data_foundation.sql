-- Revenue data foundation (P0).
--
-- Until now every YouTube number in the app was fetched live on each page load and nothing was
-- kept: no per-video history, and only a write-only channel rollup (youtube_analytics_snapshots).
-- This adds the canonical stored layer the revenue features build on:
--
--   channel_daily_stats   authoritative channel totals, one row per channel per day
--   video_daily_stats     per-video attribution layer, one row per video per day
--   youtube_sync_state    progress markers that make the sync bounded and resumable
--
-- Two facts verified against the live YouTube Analytics API (2026-10-06) shape this design:
--
--   1. SUM(video_daily_stats) is NOT guaranteed to equal channel_daily_stats. Channel totals
--      include activity/revenue from videos that no longer exist; the per-video report silently
--      omits them. The difference is real ("videos no longer available") and is never spread
--      across the remaining videos. Neither table is derived from the other.
--   2. Revenue is an ESTIMATE that Google revises ("subject to month-end adjustment"); there is no
--      finalized flag for channels. Rows are therefore upserted and may change after first write
--      — fetched_at records when a row was last refreshed, not when it became final.
--
-- Currency: every revenue column is USD, requested explicitly from the API (currency=USD), and
-- the column names say so. Nothing here may ever hold another currency.
--
-- All writes come from the server sync using the service role (which bypasses RLS). Workspace
-- members get read-only access through their channel, the same derivation `videos` already uses
-- — there is deliberately no workspace_id column to drift out of sync with the channel's.

-- ---------------------------------------------------------------------------------------------
-- videos: when the catalogue sync last saw this video in the channel's uploads playlist. A full
-- catalogue pass stamps every video it finds; anything not stamped by the time the pass finishes
-- is no longer on YouTube and gets status 'deleted' (an existing video_status value). The row and
-- all of its history are kept.
-- ---------------------------------------------------------------------------------------------
alter table public.videos add column if not exists catalogue_seen_at timestamptz;

-- ---------------------------------------------------------------------------------------------
-- channel_daily_stats
-- ---------------------------------------------------------------------------------------------
create table public.channel_daily_stats (
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  -- YouTube's reporting day (12:00AM–11:59PM Pacific time), exactly as the API labels it.
  day date not null,
  views bigint not null default 0 check (views >= 0),
  watch_minutes bigint not null default 0 check (watch_minutes >= 0),
  average_view_duration_seconds integer,
  average_view_percentage numeric(7,2),
  likes integer not null default 0,
  comments integer not null default 0,
  shares integer not null default 0,
  subscribers_gained integer not null default 0,
  subscribers_lost integer not null default 0,
  -- NULL = revenue was not available for this row (e.g. the monetary report was refused);
  -- 0 = YouTube reported zero. These are different facts and must stay distinguishable.
  estimated_revenue_usd numeric(14,6),
  ad_revenue_usd numeric(14,6),
  premium_revenue_usd numeric(14,6),
  fetched_at timestamptz not null default timezone('utc', now()),
  primary key (channel_id, day)
);

alter table public.channel_daily_stats enable row level security;

create policy channel_daily_stats_workspace_read on public.channel_daily_stats for select
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

-- ---------------------------------------------------------------------------------------------
-- video_daily_stats
-- ---------------------------------------------------------------------------------------------
create table public.video_daily_stats (
  video_id uuid not null references public.videos(id) on delete cascade,
  -- Denormalized from videos.channel_id (a video never changes channel) so channel/date range
  -- queries and the RLS check need one hop instead of two.
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  day date not null,
  views bigint not null default 0 check (views >= 0),
  watch_minutes bigint not null default 0 check (watch_minutes >= 0),
  average_view_duration_seconds integer,
  average_view_percentage numeric(7,2),
  likes integer not null default 0,
  comments integer not null default 0,
  shares integer not null default 0,
  subscribers_gained integer not null default 0,
  subscribers_lost integer not null default 0,
  estimated_revenue_usd numeric(14,6),
  ad_revenue_usd numeric(14,6),
  premium_revenue_usd numeric(14,6),
  -- Thumbnail impressions and click-through rate are NOT available from the Analytics API. They
  -- come only from the YouTube Reporting API's reach reports and stay NULL until that ingestion
  -- has been validated against a real report file and switched on.
  impressions bigint check (impressions is null or impressions >= 0),
  impression_ctr numeric(9,6),
  fetched_at timestamptz not null default timezone('utc', now()),
  primary key (video_id, day)
);

-- Dashboard/rollup queries are "this channel (or these channels), this date range".
create index video_daily_stats_channel_day_idx on public.video_daily_stats (channel_id, day);

alter table public.video_daily_stats enable row level security;

create policy video_daily_stats_workspace_read on public.video_daily_stats for select
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

-- ---------------------------------------------------------------------------------------------
-- youtube_sync_state: one row per channel. The sync does a bounded amount of work per invocation
-- and records here where it stopped, so the next invocation continues instead of starting over.
-- ---------------------------------------------------------------------------------------------
create table public.youtube_sync_state (
  channel_id uuid primary key references public.youtube_channels(id) on delete cascade,
  -- Catalogue (full video list).
  catalogue_synced_at timestamptz,
  catalogue_full_synced_at timestamptz,
  -- Set while a full pass is in progress; cleared when it completes.
  catalogue_pass_started_at timestamptz,
  catalogue_page_token text,
  -- Stats pass currently in progress, if any.
  stats_pass_kind text check (stats_pass_kind in ('backfill', 'recent', 'revision')),
  stats_pass_started_at timestamptz,
  stats_pass_window_start date,
  stats_pass_channel_done boolean not null default false,
  -- Last time a pass completed, and last time one covered the full revision window.
  stats_synced_at timestamptz,
  stats_revised_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger youtube_sync_state_set_updated_at
  before update on public.youtube_sync_state
  for each row execute function public.set_updated_at();

alter table public.youtube_sync_state enable row level security;

create policy youtube_sync_state_workspace_read on public.youtube_sync_state for select
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

-- ---------------------------------------------------------------------------------------------
-- Click attribution backfill.
--
-- The redirect route never copied the link's video/campaign onto the click row, so
-- link_click_events.video_id / channel_id / campaign_id were always NULL. New clicks are fixed in
-- the route. For existing clicks, the only source of attribution is the link they came through,
-- so this fills ONLY columns that are currently NULL, and only from that click's own link:
-- nothing is overwritten and nothing is inferred from anywhere else. A click whose link has no
-- video stays unattributed.
--
-- Caveat, stated rather than hidden: a link's video can be edited after the fact, so for an old
-- click this records the link's CURRENT video. At the time of writing the table was verified to
-- hold zero rows, which makes this a no-op; it is kept so any click recorded between then and
-- this migration running is not left stranded.
-- ---------------------------------------------------------------------------------------------
update public.link_click_events e
set
  video_id = coalesce(e.video_id, l.video_id),
  campaign_id = coalesce(e.campaign_id, l.campaign_id),
  channel_id = coalesce(e.channel_id, v.channel_id)
from public.tracking_links l
left join public.videos v on v.id = l.video_id
where l.id = e.link_id
  and (
    (e.video_id is null and l.video_id is not null)
    or (e.campaign_id is null and l.campaign_id is not null)
    or (e.channel_id is null and v.channel_id is not null)
  );
