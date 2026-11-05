-- Move revenue visibility from workspace-wide role switches to an explicit permission on each
-- workspace membership. Existing members keep the access their workspace's role switch granted;
-- new invites default to no access unless the owner chooses otherwise in the invite dialog.
--
-- The field is intentionally absent from anon/authenticated column grants. The server reads and
-- writes it with the service role, just like other protected membership data.
alter table public.workspace_members
  add column if not exists revenue_visible boolean not null default false;

update public.workspace_members as member
set revenue_visible = case
  when member.role = 'editor' then workspace.editor_revenue_visible
  when member.role = 'setter' then workspace.setter_revenue_visible
  else false
end
from public.workspaces as workspace
where member.workspace_id = workspace.id
  and member.status <> 'removed';

comment on column public.workspace_members.revenue_visible is
  'This member may see workspace revenue and deal amounts. Changed only through the authorized team API.';
