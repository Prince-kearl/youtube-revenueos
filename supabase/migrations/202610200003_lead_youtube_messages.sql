-- Lead Inbox: a real two-way conversation with a YouTube commenter.
--
-- A YouTube commenter can only be answered in public, in their comment's thread (YouTube has no
-- private messages for channels). A lead message can now say which YouTube comment it IS
-- (youtube_comment_id) and which thread it belongs to (youtube_thread_id), on which of the
-- workspace's channels (channel_id). The server uses this to
--   * send: post a reply in the lead's own thread (src/lib/server/lead-youtube.ts), and
--   * receive: bring the lead's new replies and comments into the conversation without
--     duplicates — one row per YouTube comment per lead (the partial unique index below).
--
-- Older rows keep NULLs (notes, and replies recorded before this); nothing is rewritten here.
-- The existing workspace policy on lead_messages is unchanged. No grants change.
--
-- Rollback:
--   begin;
--   drop index if exists public.lead_messages_youtube_comment_idx;
--   alter table public.lead_messages
--     drop column if exists youtube_thread_id,
--     drop column if exists youtube_comment_id,
--     drop column if exists channel_id;
--   commit;

begin;
set local lock_timeout = '3s';

alter table public.lead_messages
  add column if not exists channel_id uuid references public.youtube_channels(id) on delete set null,
  add column if not exists youtube_comment_id text
    check (youtube_comment_id is null or char_length(youtube_comment_id) between 1 and 128),
  add column if not exists youtube_thread_id text
    check (youtube_thread_id is null or char_length(youtube_thread_id) between 1 and 128);

create unique index if not exists lead_messages_youtube_comment_idx
  on public.lead_messages (lead_id, youtube_comment_id)
  where youtube_comment_id is not null;

commit;
