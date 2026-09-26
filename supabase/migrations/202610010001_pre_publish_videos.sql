-- Pre-Publish Video Analysis: lets a creator upload a video that hasn't been published to
-- YouTube yet and get AI-generated title/description/tags/chapters/CTA ideas before it goes live.
-- Deliberately a separate table rather than a row in `videos` — that table's youtube_video_id is
-- `not null` by design (every existing row really is a synced YouTube video, and every RLS policy/
-- query downstream assumes that), so a video that doesn't have one yet gets its own table instead
-- of loosening a constraint the rest of the app relies on. See src/routes/api.pre-publish-videos.ts
-- and src/routes/api.pre-publish-videos.analyze.ts.

create type public.pre_publish_video_status as enum ('uploaded', 'analyzing', 'completed', 'failed');

create table public.pre_publish_videos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Optional: which of the workspace's connected channels this is intended for, so the AI can use
  -- real channel context (name/niche/audience). Never required — the whole point of this table is
  -- that a video can be analyzed before it's ever associated with a channel or published.
  channel_id uuid references public.youtube_channels(id) on delete set null,

  -- Source file, stored in the existing workspace-files bucket under
  -- {workspaceId}/pre-publish/{this id}/original.<ext> (see src/lib/server/storage.ts).
  file_path text not null,
  file_name text not null,
  file_size bigint not null check (file_size > 0),
  mime_type text not null,
  -- Read client-side from the video element's real metadata before upload (duration/dimensions) —
  -- never guessed server-side, since no video-decoding runs on the server for this feature (see
  -- the "Known limitations" section of the feature's implementation report).
  duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),

  status public.pre_publish_video_status not null default 'uploaded',

  -- Optional context the user can supply before analyzing — never required, only sharpens output.
  topic text,
  audience text,
  tone text,
  goal text,
  -- Optional manually-pasted transcript, same "creator pastes it, never auto-fetched" convention
  -- as public.transcripts for YouTube videos (see 202608160001_initial_schema.sql).
  transcript text,

  analysis_result jsonb,
  analysis_model text,
  error text,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index pre_publish_videos_workspace_idx on public.pre_publish_videos(workspace_id, created_at desc);
create index pre_publish_videos_channel_idx on public.pre_publish_videos(channel_id) where channel_id is not null;

alter table public.pre_publish_videos enable row level security;

-- Same workspace-membership pattern as every other workspace-scoped table (see
-- 202609190001_fix_workspace_rls_recursion.sql) — a caller can never read/write another
-- workspace's rows regardless of what id they pass, since RLS filters at the database level
-- before the row is even considered, independent of application-code checks.
create policy pre_publish_videos_workspace on public.pre_publish_videos for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

-- Reuses the workspace-files bucket (see 202609270001_freebie_knowledge_branding_launch.sql) —
-- same private bucket, same RLS-by-workspace-folder convention, just a new path prefix. Raises the
-- bucket's file-size ceiling for real video uploads; existing small uploads (logos, knowledge
-- files) are unaffected since this only raises the ceiling, it doesn't add a floor. 2GB is a
-- deliberate, generous-but-bounded default — tune via this same statement if the product needs a
-- different limit later.
update storage.buckets set file_size_limit = 2147483648 where id = 'workspace-files';
