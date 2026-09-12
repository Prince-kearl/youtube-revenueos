-- Backfill: give every existing account its own workspace (as owner) and move all of that
-- account's existing rows into it. Nobody loses access to anything — every profile becomes the
-- sole owner of exactly one workspace containing exactly what they already had.
insert into public.workspaces (id, name, owner_id, created_at)
select gen_random_uuid(), coalesce(nullif(p.name, ''), p.email, 'My Workspace'), p.id, p.created_at
from public.profiles p
where not exists (select 1 from public.workspaces w where w.owner_id = p.id);

insert into public.workspace_members (workspace_id, user_id, invited_email, role, status, invited_by, invited_at, joined_at)
select w.id, w.owner_id, coalesce(p.email, ''), 'owner', 'active', w.owner_id, w.created_at, w.created_at
from public.workspaces w
join public.profiles p on p.id = w.owner_id
where not exists (
  select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = w.owner_id
);

update public.youtube_channels c set workspace_id = w.id
from public.workspaces w where w.owner_id = c.user_id and c.workspace_id is null;
update public.destinations d set workspace_id = w.id
from public.workspaces w where w.owner_id = d.user_id and d.workspace_id is null;
update public.campaigns c set workspace_id = w.id
from public.workspaces w where w.owner_id = c.user_id and c.workspace_id is null;
update public.tracking_links t set workspace_id = w.id
from public.workspaces w where w.owner_id = t.user_id and t.workspace_id is null;
update public.leads l set workspace_id = w.id
from public.workspaces w where w.owner_id = l.user_id and l.workspace_id is null;
update public.deals d set workspace_id = w.id
from public.workspaces w where w.owner_id = d.user_id and d.workspace_id is null;
update public.notifications n set workspace_id = w.id
from public.workspaces w where w.owner_id = n.user_id and n.workspace_id is null;
update public.jobs j set workspace_id = w.id
from public.workspaces w where w.owner_id = j.user_id and j.workspace_id is null and j.user_id is not null;
update public.connected_integrations ci set workspace_id = w.id
from public.workspaces w where w.owner_id = ci.user_id and ci.workspace_id is null;
update public.projects p2 set workspace_id = w.id
from public.workspaces w where w.owner_id = p2.user_id and p2.workspace_id is null;
update public.lead_magnets lm set workspace_id = w.id
from public.workspaces w where w.owner_id = lm.user_id and lm.workspace_id is null;
