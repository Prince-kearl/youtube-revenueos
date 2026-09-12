-- Rewrite RLS across every tenant table to scope by real workspace membership instead of
-- direct/indirect user_id ownership, and update the two per-user uniqueness constraints that
-- become per-workspace. All new policies check the same shape: the caller has an 'active'
-- workspace_members row for the target workspace_id (direct tables) or for the workspace_id of
-- the parent row they're joining through (child tables) — any active role, since page/feature-
-- level access is separately gated by requireWorkspaceFeature (see src/lib/server/workspace.ts),
-- matching how the original page-per-role matrix (ROLE_ROUTES in stores.ts) was never a per-table
-- CRUD matrix either.

-- ============================================================
-- Direct tables (own workspace_id column)
-- ============================================================
drop policy if exists youtube_channels_owner on public.youtube_channels;
create policy youtube_channels_workspace on public.youtube_channels for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

drop policy if exists destinations_owner on public.destinations;
create policy destinations_workspace on public.destinations for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

drop policy if exists campaigns_owner on public.campaigns;
create policy campaigns_workspace on public.campaigns for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

drop policy if exists tracking_links_owner on public.tracking_links;
create policy tracking_links_workspace on public.tracking_links for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

drop policy if exists leads_owner on public.leads;
create policy leads_workspace on public.leads for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

drop policy if exists deals_owner on public.deals;
create policy deals_workspace on public.deals for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

drop policy if exists notifications_owner on public.notifications;
create policy notifications_workspace on public.notifications for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

-- jobs stays read-only for members (writes are service-role/background-worker only, unchanged).
drop policy if exists jobs_owner on public.jobs;
create policy jobs_workspace_read on public.jobs for select using (
  workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
);

drop policy if exists connected_integrations_owner on public.connected_integrations;
create policy connected_integrations_workspace on public.connected_integrations for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

drop policy if exists projects_owner on public.projects;
create policy projects_workspace on public.projects for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

drop policy if exists lead_magnets_owner on public.lead_magnets;
create policy lead_magnets_workspace on public.lead_magnets for all
  using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'))
  with check (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active'));

-- ============================================================
-- Child tables (scoped through a parent row's workspace_id)
-- ============================================================
drop policy if exists videos_owner on public.videos;
create policy videos_workspace on public.videos for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists transcripts_owner on public.transcripts;
create policy transcripts_workspace on public.transcripts for all
  using (exists (
    select 1 from public.videos v join public.youtube_channels c on c.id = v.channel_id
    where v.id = video_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.videos v join public.youtube_channels c on c.id = v.channel_id
    where v.id = video_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists campaign_videos_owner on public.campaign_videos;
create policy campaign_videos_workspace on public.campaign_videos for all
  using (exists (
    select 1 from public.campaigns c
    where c.id = campaign_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.campaigns c
    where c.id = campaign_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists click_events_owner on public.link_click_events;
create policy click_events_workspace on public.link_click_events for select using (
  exists (
    select 1 from public.tracking_links l
    where l.id = link_id
      and l.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  )
);

drop policy if exists youtube_integration_settings_owner on public.youtube_integration_settings;
create policy youtube_integration_settings_workspace on public.youtube_integration_settings for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists youtube_comments_owner on public.youtube_comments;
create policy youtube_comments_workspace on public.youtube_comments for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists youtube_chapters_owner on public.youtube_chapters;
create policy youtube_chapters_workspace on public.youtube_chapters for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists youtube_analytics_snapshots_owner on public.youtube_analytics_snapshots;
create policy youtube_analytics_snapshots_workspace on public.youtube_analytics_snapshots for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists comment_automation_rules_owner on public.comment_automation_rules;
create policy comment_automation_rules_workspace on public.comment_automation_rules for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists comment_automation_replies_owner on public.comment_automation_replies;
create policy comment_automation_replies_workspace on public.comment_automation_replies for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists comment_automation_rule_events_owner on public.comment_automation_rule_events;
create policy comment_automation_rule_events_workspace on public.comment_automation_rule_events for all
  using (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.youtube_channels c
    where c.id = channel_id
      and c.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

drop policy if exists lead_messages_owner on public.lead_messages;
create policy lead_messages_workspace on public.lead_messages for all
  using (exists (
    select 1 from public.leads l
    where l.id = lead_id
      and l.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ))
  with check (exists (
    select 1 from public.leads l
    where l.id = lead_id
      and l.workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and status = 'active')
  ));

-- ============================================================
-- Per-user uniqueness becomes per-workspace (a workspace can only connect a given YouTube channel
-- or a given third-party provider once, same as before but at the workspace level instead of the
-- individual-account level).
-- ============================================================
alter table public.youtube_channels drop constraint if exists youtube_channels_user_id_youtube_channel_id_key;
alter table public.youtube_channels
  add constraint youtube_channels_workspace_id_youtube_channel_id_key
  unique (workspace_id, youtube_channel_id);

alter table public.connected_integrations drop constraint if exists connected_integrations_user_id_provider_key;
alter table public.connected_integrations
  add constraint connected_integrations_workspace_id_provider_key
  unique (workspace_id, provider);
