-- Team page: real job titles (distinct from the 4-tier access-control `role`, which stays
-- untouched — canManageWorkspaceRole/role_feature_access only understand owner/manager/setter/
-- editor, so job_title is purely a label, never checked for permissions), a real monthly cost per
-- teammate, and a real way to attribute a deal's revenue to whoever worked it, so gross profit per
-- teammate is an actual computation instead of a guess.
alter table public.workspace_members
  add column if not exists job_title text,
  add column if not exists cost_amount numeric(12, 2) not null default 0 check (cost_amount >= 0);

alter table public.deals
  add column if not exists assigned_member_id uuid references public.workspace_members(id) on delete set null;

create index if not exists deals_assigned_member_idx
  on public.deals(assigned_member_id)
  where assigned_member_id is not null;
