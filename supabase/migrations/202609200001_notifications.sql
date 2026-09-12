-- Real backing store for the Notifications bell + full /notifications page, replacing the
-- local-storage mock (useNotifications in stores.ts). Shared per-workspace — matching the
-- notifications_workspace RLS policy already created in 202609170003_workspaces_rls.sql — rather
-- than private to one recipient: these are team-relevant alerts (a deal expiring, an automated
-- reply going out, a teammate's ticket getting resolved), not personal DMs, so any active member
-- of the workspace sees the same feed. user_id records who/what the event is about, not who may
-- view it.
--
-- icon/color are NOT stored — type is a closed set and the UI derives both from it (see
-- NotificationRow.tsx), so there's nothing presentation-specific to persist.
alter table public.notifications alter column workspace_id set not null;
alter table public.notifications add column if not exists pinned boolean not null default false;
alter table public.notifications add column if not exists archived boolean not null default false;
alter table public.notifications add constraint notifications_type_check
  check (type in ('message', 'check', 'dollar', 'alert', 'zap', 'clock'));

create index if not exists notifications_workspace_created_idx
  on public.notifications(workspace_id, created_at desc);
