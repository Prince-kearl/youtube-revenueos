-- Measured YouTube Data API quota usage (src/lib/server/youtube-quota.ts).
--
-- Every Data API request the app sends is now stored in youtube_quota_events with source 'api':
-- its operation (videos.list, comments.insert…), Google's published cost and whether it
-- succeeded. Existing rows, and the rows features still write for business events (a reply sent,
-- counted by the per-workspace reply caps), are source 'event'; their units were estimates and are
-- no longer added into quota totals. The quota day is Google's: midnight to midnight Pacific time.
--
-- Additive only: one column with a constant default (no table rewrite), one partial index, and a
-- read-only summary function for the admin quota panel.
--
-- Security: youtube_quota_events keeps its row-level security and policies unchanged. The summary
-- function is SECURITY INVOKER with a fixed search_path; EXECUTE is revoked from PUBLIC, anon and
-- authenticated, so only the server (service_role) can call it, from the admin API after its own
-- permission check. It returns totals only: no user, token or request detail.
--
-- Rollback:
--   drop function if exists public.youtube_quota_usage(timestamptz, timestamptz);
--   drop index if exists public.youtube_quota_events_api_idx;
--   alter table public.youtube_quota_events drop column if exists source;

alter table public.youtube_quota_events
  add column if not exists source text not null default 'event'
  check (source in ('event', 'api'));

create index if not exists youtube_quota_events_api_idx
  on public.youtube_quota_events (created_at)
  where source = 'api';

-- Measured usage between two instants, per Pacific quota day, operation and workspace (the
-- workspace of the channel the request was made for; null when it was made without one).
create or replace function public.youtube_quota_usage(p_from timestamptz, p_to timestamptz)
returns table (day date, operation text, workspace_id uuid, units bigint, calls bigint, failed bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select (e.created_at at time zone 'America/Los_Angeles')::date as day,
         e.operation,
         c.workspace_id,
         sum(e.quota_units)::bigint as units,
         count(*)::bigint as calls,
         count(*) filter (where not e.succeeded)::bigint as failed
    from public.youtube_quota_events e
    left join public.youtube_channels c on c.id = e.channel_id
   where e.source = 'api'
     and e.created_at >= p_from
     and e.created_at < p_to
   group by 1, 2, 3
$$;

revoke execute on function public.youtube_quota_usage(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.youtube_quota_usage(timestamptz, timestamptz) to service_role;
