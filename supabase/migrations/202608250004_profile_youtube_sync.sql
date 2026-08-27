alter table public.profiles add column if not exists location text;
alter table public.profiles add column if not exists website text;
alter table public.profiles add column if not exists bio text;

alter table public.youtube_channels add column if not exists view_count bigint not null default 0 check (view_count >= 0);
alter table public.youtube_channels add column if not exists video_count bigint not null default 0 check (video_count >= 0);
alter table public.youtube_channels add column if not exists uploads_playlist_id text;