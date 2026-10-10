-- Keeps teammates' compensation (lead share, commission, monthly cost) out of reach of the
-- member-facing database roles.
--
-- Until now the only guard on workspace_members was the row policy workspace_members_read:
-- any active member may read every row of their own workspace. Row-level security chooses ROWS,
-- not columns, so a setter or editor querying the table directly (PostgREST with their own
-- session) could read every teammate's lead_share, commission and cost_amount — whatever the
-- Team page chose to show.
--
-- This replaces the table-wide SELECT privilege with a column list that leaves those three
-- columns out. The row policy is unchanged and still applies on top: members see the same rows
-- as before, minus the compensation columns.
--
-- Compensation is now served only by /api/workspace/members, which reads with the service role
-- (unaffected by this migration) and blanks the columns per viewer — see canViewCompensation in
-- src/lib/team-policy.ts.
--
-- What keeps working, because it reads only granted columns:
--   * getWorkspaceContext / api.features.access   (workspace_id, role — filtered on user_id, status)
--   * api.deals' assignee check                    (id — filtered on id, workspace_id)
--   * every RLS policy that looks a membership up  (workspace_id, user_id, status)
--   * is_active_workspace_member()                 (security definer; not subject to these grants)
--
-- What stops working, on purpose: `select *` on workspace_members as anon/authenticated, and any
-- select or filter naming lead_share, commission or cost_amount, now fail with 42501.
--
-- NOTE for later migrations: a column added to this table is NOT readable by `authenticated`
-- until it is granted here-style. That is the safe default for this table.
--
-- No data is changed. Writes were never open to these roles (no insert/update/delete policy
-- exists) and remain so.

revoke select on table public.workspace_members from anon, authenticated;

grant select (
  id,
  workspace_id,
  user_id,
  invited_email,
  role,
  status,
  job_title,
  invited_by,
  invited_at,
  joined_at,
  created_at,
  updated_at
) on table public.workspace_members to anon, authenticated;
-- anon keeps the same (non-compensation) column list it had implicitly: the row policy already
-- returns it no rows, and keeping the privilege means a policy elsewhere that looks a membership
-- up still answers "no rows" for a signed-out request instead of raising a permission error.

-- To undo:
--   grant select on table public.workspace_members to anon, authenticated;
