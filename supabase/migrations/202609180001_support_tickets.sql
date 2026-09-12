-- Real backing store for the Support page (creator-facing ticket submission) and the admin
-- console's Support section. Deliberately NOT workspace-scoped: a Superadmin needs to see and
-- manage tickets across every customer/workspace, not just one, so this is admin-global like
-- admin_audit_log rather than following the workspace_id tenant-scoping pattern used elsewhere.
-- user_id is nullable because the public landing-page contact form accepts messages from
-- signed-out visitors with no auth.users row at all.
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  subject text not null,
  message text not null,
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  status text not null default 'Open' check (status in ('Open', 'Pending', 'Resolved')),
  source text not null default 'App' check (source in ('App', 'Landing Page')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index support_tickets_user_idx on public.support_tickets(user_id, created_at desc);
create index support_tickets_status_idx on public.support_tickets(status, created_at desc);

create trigger support_tickets_set_updated_at
  before update on public.support_tickets
  for each row execute function public.set_updated_at();

alter table public.support_tickets enable row level security;

-- A signed-in creator may only see/create their own tickets. The public landing-page form and
-- all admin management go through server routes using the service-role client, so no anon-insert
-- or admin-read policy is needed here (mirrors admin_audit_log's admin-via-service-role pattern).
create policy support_tickets_owner_read on public.support_tickets for select
  using (user_id = auth.uid());

create policy support_tickets_owner_insert on public.support_tickets for insert
  with check (user_id = auth.uid());
