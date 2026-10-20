-- Comment Automation at scale: a server-side queue for bulk auto-replies, and protection against
-- replying to the same comment twice.
--
-- comment_reply_jobs holds one row per comment a reply has been requested for. The server sends
-- them in small paced batches within a per-workspace daily cap and a reserve of the app-wide
-- YouTube quota (src/lib/server/comment-reply-queue.ts), so a large selection is spread over
-- several days instead of failing, and survives the browser being closed.
--
--   * unique (channel_id, youtube_comment_id): a comment is queued at most once, ever.
--   * Workspace members can READ their workspace's jobs (progress); there are no write policies
--     and writes are revoked from client roles: only the server (service role) queues, claims,
--     sends and cancels, after its own authorization.
--
-- comment_automation_replies gets a partial unique index on sent replies, so the direct reply
-- path and the queue can never both record a sent reply to the same comment. (Checked before
-- writing this: no existing duplicates on staging or production.)
--
-- One short transaction; lock_timeout keeps it from waiting behind a long-running query (re-run
-- it if it times out). Rollback:
--   begin;
--   drop table if exists public.comment_reply_jobs;
--   drop index if exists public.comment_automation_replies_sent_once_idx;
--   commit;

begin;
set local lock_timeout = '3s';

create unique index if not exists comment_automation_replies_sent_once_idx
  on public.comment_automation_replies (channel_id, youtube_comment_id)
  where status = 'sent';

create table if not exists public.comment_reply_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  rule_id uuid references public.comment_automation_rules(id) on delete set null,
  youtube_comment_id text not null check (char_length(youtube_comment_id) between 1 and 128),
  youtube_video_id text not null check (char_length(youtube_video_id) between 1 and 64),
  author_name text,
  author_channel_id text,
  author_avatar_url text,
  comment_text text not null,
  reply_text text not null check (char_length(reply_text) between 1 and 10000),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  claimed_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (channel_id, youtube_comment_id)
);

create index if not exists comment_reply_jobs_workspace_status_idx
  on public.comment_reply_jobs (workspace_id, status, created_at);
create index if not exists comment_reply_jobs_status_created_idx
  on public.comment_reply_jobs (status, created_at);

drop trigger if exists comment_reply_jobs_updated_at on public.comment_reply_jobs;
create trigger comment_reply_jobs_updated_at before update on public.comment_reply_jobs
  for each row execute function public.set_updated_at();

alter table public.comment_reply_jobs enable row level security;

drop policy if exists comment_reply_jobs_workspace_read on public.comment_reply_jobs;
create policy comment_reply_jobs_workspace_read on public.comment_reply_jobs
  for select to authenticated using (public.is_active_workspace_member(workspace_id));

revoke all on table public.comment_reply_jobs from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.comment_reply_jobs from authenticated;
grant select on table public.comment_reply_jobs to authenticated;

commit;
