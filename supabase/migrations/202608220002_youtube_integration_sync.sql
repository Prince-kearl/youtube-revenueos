create table public.youtube_integration_settings (
  channel_id uuid primary key references public.youtube_channels(id) on delete cascade,
  auto_sync_videos boolean not null default true,
  import_analytics boolean not null default true,
  sync_comments boolean not null default false,
  import_chapters boolean not null default true,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.youtube_channels add column if not exists last_sync_status text not null default 'never_synced' check (last_sync_status in ('never_synced', 'syncing', 'success', 'partial', 'failed', 'reauth_required'));
alter table public.youtube_channels add column if not exists last_sync_error text;

create table public.youtube_analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (channel_id, period_start, period_end)
);

create table public.youtube_comments (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  youtube_comment_id text not null,
  youtube_video_id text not null,
  parent_comment_id text,
  author_name text,
  author_channel_id text,
  text text not null,
  like_count bigint not null default 0 check (like_count >= 0),
  published_at timestamptz,
  updated_at timestamptz,
  can_reply boolean,
  created_at timestamptz not null default timezone('utc', now()),
  unique (channel_id, youtube_comment_id)
);

create table public.youtube_chapters (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  youtube_video_id text not null,
  title text not null,
  start_seconds integer not null check (start_seconds >= 0),
  end_seconds integer check (end_seconds is null or end_seconds > start_seconds),
  position integer not null check (position >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (channel_id, youtube_video_id, position)
);

create index youtube_comments_channel_published_idx on public.youtube_comments(channel_id, published_at desc);
create index youtube_chapters_channel_video_idx on public.youtube_chapters(channel_id, youtube_video_id, position);
create index youtube_analytics_channel_period_idx on public.youtube_analytics_snapshots(channel_id, period_end desc);

create trigger youtube_integration_settings_updated_at before update on public.youtube_integration_settings for each row execute function public.set_updated_at();

alter table public.youtube_integration_settings enable row level security;
alter table public.youtube_comments enable row level security;
alter table public.youtube_chapters enable row level security;
alter table public.youtube_analytics_snapshots enable row level security;

create policy youtube_integration_settings_owner on public.youtube_integration_settings for all using (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
);
create policy youtube_comments_owner on public.youtube_comments for all using (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
);
create policy youtube_chapters_owner on public.youtube_chapters for all using (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
);
create policy youtube_analytics_snapshots_owner on public.youtube_analytics_snapshots for all using (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
);
