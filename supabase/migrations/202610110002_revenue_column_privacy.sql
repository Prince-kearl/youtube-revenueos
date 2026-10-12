-- Takes money out of reach of the member-facing database roles: reading it, and writing it.
--
-- STEP 2 of 2.  *** DO NOT APPLY UNTIL THE APPLICATION CODE THAT IMPLEMENTS WORKSPACE REVENUE
-- VISIBILITY IS DEPLOYED AND VERIFIED. ***  The code before it reads these columns, and writes
-- deals, with the member's own session; with this applied that code fails (permission error →
-- HTTP 500 on the Dashboard, Videos, Analytics, Brand Deals and Reports, and deals cannot be
-- saved). The code that implements the feature does both on the server with the service role
-- and works before and after this file.
--
-- Why it is needed.
--
--   Reading. Row-level security chooses ROWS, not columns. Every active member can read their
--   workspace's rows in the tables below, so an editor or setter with revenue visibility switched
--   OFF could still query the amounts directly (PostgREST with their own session), whatever the
--   application chose to show.
--
--   Writing. `deals` had a FOR ALL member policy, so the same editor or setter could also set,
--   overwrite, zero or delete a deal's value directly — without being able to see it. Whether a
--   member may write an amount depends on their role and on a workspace setting, which column
--   privileges cannot express; so no member-facing session writes deals at all any more.
--
-- After this, amounts are read and deals are written only by the application's own endpoints,
-- which decide per caller (lib/server/revenue-visibility.ts) and use the service role. That is
-- the same arrangement already in place for team membership and compensation
-- (202610100001_workspace_member_compensation_privacy.sql), which this file does not touch.
--
-- What stays readable by members, and still works on their own session:
--   * activity — views, watch time, engagement, subscribers, impressions
--   * everything about a deal except its value (name, stage, dates, currency, assignee…)
--   * every other table's row policy, including the ones used to check membership
--
-- What stops working for the member-facing roles, on purpose:
--   * `select *` on these tables, and any select, filter, order or aggregate naming a money
--     column (permission error 42501)
--   * any insert, update, delete or truncate on these tables
--
-- The service role is not affected. No data is changed.
--
-- NOTE for later migrations: a column added to one of these tables is NOT readable by
-- `authenticated` until it is granted here-style. That is the safe default for these tables.

-- ---------------------------------------------------------------------------------------------
-- Stored YouTube revenue, per channel per day.
-- Withheld: estimated_revenue_usd, ad_revenue_usd, premium_revenue_usd.
-- Written only by the sync (service role). Members never had a write policy here; the write
-- privileges are removed as well so that does not rest on row-level security alone.
-- ---------------------------------------------------------------------------------------------
revoke select, insert, update, delete, truncate on table public.channel_daily_stats
  from anon, authenticated;
grant select (
  channel_id,
  day,
  views,
  watch_minutes,
  average_view_duration_seconds,
  average_view_percentage,
  likes,
  comments,
  shares,
  subscribers_gained,
  subscribers_lost,
  fetched_at
) on table public.channel_daily_stats to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Stored YouTube revenue, per video per day.
-- Withheld: estimated_revenue_usd, ad_revenue_usd, premium_revenue_usd.
-- ---------------------------------------------------------------------------------------------
revoke select, insert, update, delete, truncate on table public.video_daily_stats
  from anon, authenticated;
grant select (
  video_id,
  channel_id,
  day,
  views,
  watch_minutes,
  average_view_duration_seconds,
  average_view_percentage,
  likes,
  comments,
  shares,
  subscribers_gained,
  subscribers_lost,
  impressions,
  impression_ctr,
  fetched_at
) on table public.video_daily_stats to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Brand deals. Withheld from reading: value. Not writable by member-facing roles at all.
--
-- The FOR ALL policy is replaced by a read-only one, so that even if a write privilege were
-- granted again by mistake, row-level security would still refuse the write.
-- ---------------------------------------------------------------------------------------------
revoke select, insert, update, delete, truncate on table public.deals from anon, authenticated;
grant select (
  id,
  user_id,
  workspace_id,
  lead_id,
  campaign_id,
  assigned_member_id,
  name,
  contact_name,
  currency,
  stage,
  status,
  tag,
  next_action,
  expected_close_date,
  closed_at,
  notes,
  created_at,
  updated_at
) on table public.deals to anon, authenticated;

drop policy if exists deals_workspace on public.deals;
drop policy if exists deals_workspace_read on public.deals;
create policy deals_workspace_read on public.deals for select using (
  public.is_active_workspace_member(workspace_id)
);

-- ---------------------------------------------------------------------------------------------
-- Retired analytics snapshots. Nothing in the application reads or writes this table any more,
-- but the rows that remain hold whole YouTube report payloads from before, revenue included, in
-- one JSON column — and its FOR ALL member policy let members rewrite them. No member-facing
-- access of any kind is needed, so none is left.
-- ---------------------------------------------------------------------------------------------
revoke select, insert, update, delete, truncate on table public.youtube_analytics_snapshots
  from anon, authenticated;

-- To undo. LAST RESORT ONLY: this reopens direct reads of every amount, and direct writes of
-- deals, to every workspace member. The application code that implements revenue visibility
-- keeps working with this file applied, so prefer fixing forward; see the deployment notes.
--   grant select on table public.channel_daily_stats to anon, authenticated;
--   grant select on table public.video_daily_stats to anon, authenticated;
--   grant select, insert, update, delete on table public.deals to anon, authenticated;
--   grant select on table public.youtube_analytics_snapshots to anon, authenticated;
--   drop policy if exists deals_workspace_read on public.deals;
--   create policy deals_workspace on public.deals for all
--     using (public.is_active_workspace_member(workspace_id))
--     with check (public.is_active_workspace_member(workspace_id));
