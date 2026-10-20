-- Comment Automation: AI-written queued replies.
--
-- reply_mode says how a queued job's reply is written:
--   * 'text' — reply_text is posted as is (personalized with the viewer's first name);
--   * 'ai'   — reply_text is only the creator's intent (a rule's template); the server writes the
--              actual reply for that comment when it sends it, from the video's own title,
--              description, chapters, analysis and transcript (src/lib/server/ai-generation.ts,
--              generateCommentReply), then stores what was posted back in reply_text.
--
-- Existing rows keep 'text', which is exactly how they behave today. No grants or policies
-- change: the table stays read-only to workspace members and written only by the server.
--
-- Rollback:
--   begin;
--   alter table public.comment_reply_jobs drop column if exists reply_mode;
--   commit;

begin;
set local lock_timeout = '3s';

alter table public.comment_reply_jobs
  add column if not exists reply_mode text not null default 'text'
    check (reply_mode in ('text', 'ai'));

commit;
