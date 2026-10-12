-- Workspace revenue visibility: whether editors and setters may see revenue amounts.
--
-- STEP 1 of 2. This file ADDS two columns and removes a write privilege nothing uses. It is safe
-- to apply at any time, with the application code that predates the feature or the code that
-- implements it:
--   * nothing existing reads or writes these columns;
--   * no application code, old or new, writes `workspaces` on a member's session (every write
--     is made with the service role), and row-level security already refused such writes;
--   * until it is applied, the application treats the setting as OFF for both roles.
--
-- (Step 2, 202610110002_revenue_column_privacy.sql, removes direct read access to the money
-- columns and must NOT be applied until the application code that implements this feature is
-- live. See that file.)
--
-- Owners and managers always see revenue and are not configurable; the two columns below are the
-- whole setting. Both default to false, so every existing workspace and every new one starts
-- with revenue hidden from editors and setters. NOT NULL, so "unset" cannot exist.
--
-- Who can change them: nobody, through the member-facing database role. `workspaces` has a
-- member READ policy only (workspaces_member_read); there is no insert, update or delete policy,
-- so row-level security already refuses every direct write — and the write privileges themselves
-- are revoked below, so that does not rest on row-level security alone. The setting is changed
-- only by
-- /api/workspace/revenue-visibility, which authorises the caller (owner, manager, or platform
-- staff who are a member) and then writes with the service role.
--
-- Members can READ the two flags of their own workspace through the existing read policy. That
-- is intended: a page needs to know whether to show amounts, and the flags are not themselves
-- financial data.

alter table public.workspaces
  add column if not exists editor_revenue_visible boolean not null default false,
  add column if not exists setter_revenue_visible boolean not null default false;

-- Belt and braces: with no write policy these were already refused by row-level security.
revoke insert, update, delete, truncate on table public.workspaces from anon, authenticated;

comment on column public.workspaces.editor_revenue_visible is
  'Editors in this workspace may see revenue amounts. Changed only through the API. Does not grant access to team compensation.';
comment on column public.workspaces.setter_revenue_visible is
  'Setters in this workspace may see revenue amounts. Changed only through the API. Does not grant access to team compensation.';

-- To undo:
--   grant insert, update, delete on table public.workspaces to anon, authenticated;
--   alter table public.workspaces
--     drop column if exists editor_revenue_visible,
--     drop column if exists setter_revenue_visible;
