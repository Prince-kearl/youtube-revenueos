-- Real history of active/inactive toggles for comment automation rules, so the "Active Rules" KPI
-- card can show a genuine trend (active count now vs 30 days ago) instead of staying a plain
-- current-value stat. One row is written whenever a rule is created or its `active` flag changes;
-- reconstructing "how many were active as of date X" is a client-side reduction over these events
-- (see api.comment-rules.ts), not a stored snapshot, since a rule's active count at any past moment
-- is fully determined by the latest event at-or-before that moment.
create table public.comment_automation_rule_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.comment_automation_rules(id) on delete cascade,
  channel_id uuid not null references public.youtube_channels(id) on delete cascade,
  active boolean not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index comment_automation_rule_events_channel_created_idx
  on public.comment_automation_rule_events(channel_id, created_at);

alter table public.comment_automation_rule_events enable row level security;

create policy comment_automation_rule_events_owner on public.comment_automation_rule_events for all using (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
) with check (
  exists (select 1 from public.youtube_channels c where c.id = channel_id and c.user_id = auth.uid())
);
