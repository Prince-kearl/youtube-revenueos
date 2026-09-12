-- Fixes "infinite recursion detected in policy for relation workspace_members" (Postgres 42P17).
-- Every workspace-scoped policy added in 202609170001/202609170003 checks membership with
-- `workspace_id in (select workspace_id from workspace_members where user_id = auth.uid() and
-- status = 'active')` — including workspace_members' OWN read policy. That inner subquery scans
-- workspace_members, which re-applies workspace_members' RLS policy to itself, which re-runs the
-- same subquery, recursing indefinitely. Postgres detects this and raises a hard error, which
-- getWorkspaceContext (and every other real, RLS-scoped query) was silently swallowing as
-- "no membership found" — this is why a real signed-in user with a genuine active membership row
-- got NO_WORKSPACE / storage_failed: the query never actually returned "no row", it errored out
-- every time. Every earlier verification of this feature used mocked API responses in tests, which
-- never touched real RLS, so this went uncaught until a real production request hit it.
--
-- Fix: move the membership check into a SECURITY DEFINER function. Such a function runs with the
-- privileges of its owner, so its internal query against workspace_members does not re-trigger
-- workspace_members' own RLS policy — breaking the recursion — while still only ever answering
-- "is the CURRENT caller (auth.uid()) an active member of this workspace," so it grants no broader
-- access than the policies already intended.
create or replace function public.is_active_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

grant execute on function public.is_active_workspace_member(uuid) to authenticated;

-- ============================================================
-- workspaces / workspace_members themselves
-- ============================================================
drop policy if exists workspaces_member_read on public.workspaces;
create policy workspaces_member_read on public.workspaces for select using (
  public.is_active_workspace_member(id)
);

drop policy if exists workspace_members_read on public.workspace_members;
create policy workspace_members_read on public.workspace_members for select using (
  public.is_active_workspace_member(workspace_id)
);

-- ============================================================
-- Direct tables (own workspace_id column)
-- ============================================================
drop policy if exists youtube_channels_workspace on public.youtube_channels;
create policy youtube_channels_workspace on public.youtube_channels for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists destinations_workspace on public.destinations;
create policy destinations_workspace on public.destinations for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists campaigns_workspace on public.campaigns;
create policy campaigns_workspace on public.campaigns for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists tracking_links_workspace on public.tracking_links;
create policy tracking_links_workspace on public.tracking_links for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists leads_workspace on public.leads;
create policy leads_workspace on public.leads for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists deals_workspace on public.deals;
create policy deals_workspace on public.deals for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists notifications_workspace on public.notifications;
create policy notifications_workspace on public.notifications for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists jobs_workspace_read on public.jobs;
create policy jobs_workspace_read on public.jobs for select using (
  public.is_active_workspace_member(workspace_id)
);

drop policy if exists connected_integrations_workspace on public.connected_integrations;
create policy connected_integrations_workspace on public.connected_integrations for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists projects_workspace on public.projects;
create policy projects_workspace on public.projects for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

drop policy if exists lead_magnets_workspace on public.lead_magnets;
create policy lead_magnets_workspace on public.lead_magnets for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

-- ============================================================
-- Child tables (scoped through a parent row's workspace_id)
-- ============================================================
drop policy if exists videos_workspace on public.videos;
create policy videos_workspace on public.videos for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists transcripts_workspace on public.transcripts;
create policy transcripts_workspace on public.transcripts for all
  using (exists (
    select 1 from public.videos v join public.youtube_channels c on c.id = v.channel_id
    where v.id = video_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.videos v join public.youtube_channels c on c.id = v.channel_id
    where v.id = video_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists campaign_videos_workspace on public.campaign_videos;
create policy campaign_videos_workspace on public.campaign_videos for all
  using (exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.campaigns c
    where c.id = campaign_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists click_events_workspace on public.link_click_events;
create policy click_events_workspace on public.link_click_events for select using (
  exists (
    select 1 from public.tracking_links l
    where l.id = link_id and public.is_active_workspace_member(l.workspace_id)
  )
);

drop policy if exists youtube_integration_settings_workspace on public.youtube_integration_settings;
create policy youtube_integration_settings_workspace on public.youtube_integration_settings for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists youtube_comments_workspace on public.youtube_comments;
create policy youtube_comments_workspace on public.youtube_comments for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists youtube_chapters_workspace on public.youtube_chapters;
create policy youtube_chapters_workspace on public.youtube_chapters for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists youtube_analytics_snapshots_workspace on public.youtube_analytics_snapshots;
create policy youtube_analytics_snapshots_workspace on public.youtube_analytics_snapshots for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists comment_automation_rules_workspace on public.comment_automation_rules;
create policy comment_automation_rules_workspace on public.comment_automation_rules for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists comment_automation_replies_workspace on public.comment_automation_replies;
create policy comment_automation_replies_workspace on public.comment_automation_replies for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists comment_automation_rule_events_workspace on public.comment_automation_rule_events;
create policy comment_automation_rule_events_workspace on public.comment_automation_rule_events for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id and public.is_active_workspace_member(c.workspace_id)
  ));

drop policy if exists lead_messages_workspace on public.lead_messages;
create policy lead_messages_workspace on public.lead_messages for all
  using (exists (
    select 1 from public.leads l
    where l.id = lead_id and public.is_active_workspace_member(l.workspace_id)
  ))
  with check (exists (
    select 1 from public.leads l
    where l.id = lead_id and public.is_active_workspace_member(l.workspace_id)
  ));
