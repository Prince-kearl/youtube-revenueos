-- Real backing for the Link Tracking page's click stats. tracking_links.clicks already tracks
-- total clicks (incremented by the public redirect route); this adds real unique-visitor counting
-- via the privacy_id the redirect route stamps on each click event, and an atomic increment
-- function so concurrent redirects can't race a read-then-write update.
create view public.tracking_link_stats
with (security_invoker = true) as
select
  link_id,
  count(*) as total_clicks,
  count(distinct privacy_id) as unique_clicks
from public.link_click_events
group by link_id;

create or replace function public.increment_link_clicks(p_link_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tracking_links
  set clicks = clicks + 1, updated_at = timezone('utc', now())
  where id = p_link_id;
$$;

-- The redirect route runs as an anonymous visitor (no Supabase session), so it calls this via the
-- service role client rather than needing a grant here — security definer keeps the update scoped
-- to exactly this one statement rather than granting broader table access.
