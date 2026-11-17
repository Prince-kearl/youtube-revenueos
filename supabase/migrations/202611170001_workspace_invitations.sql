-- Shareable workspace invitations: an owner or manager creates an invitation for one email
-- address and shares the link themselves (WhatsApp, email, Slack…). Tubify sends no email.
--
-- How it is used (src/lib/server/workspace-invitations.ts, api.workspace.members.ts,
-- api.workspace.invitations.ts, api.invitations.ts, routes/invite.$token.tsx):
--   * The link carries a 256-bit random secret. Only its SHA-256 hash is stored (token_hash);
--     the secret is shown once, when the invitation is created or regenerated.
--   * Single use, expires (7 days by default), revocable. Regenerating replaces token_hash, so
--     the previous link stops working at once.
--   * Accepting happens only through accept_workspace_invitation(), called by the server with
--     the service role after it has authenticated the person and read their CONFIRMED email from
--     Supabase Auth. The function locks the invitation, re-checks everything, and creates the
--     membership in the same transaction, so duplicate or concurrent clicks cannot create two
--     memberships or use one link twice.
--   * One active workspace per account (as before): an account whose only workspace is its own
--     empty one (no channels, no other members, no paid subscription) leaves it — the rows are
--     kept, nothing is deleted — and joins; an account with a workspace in use is refused.
--
-- Security:
--   * Row-level security on, NO policies, and no table privileges for anon/authenticated: no
--     browser session can read invitations (not even token hashes) or write them. Only the
--     server reads them, scoped to the caller's workspace.
--   * accept_workspace_invitation is SECURITY INVOKER with a fixed search_path; EXECUTE is
--     revoked from PUBLIC, anon and authenticated (service_role only).
--
-- Also: handle_new_user() no longer joins a new account to a pending invite by email alone. That
-- happened when the auth user was CREATED, before the address was confirmed, so anyone could
-- sign up with an invited address and be attached to that workspace. New accounts now always get
-- their own workspace; joining another requires accepting an invitation with a confirmed email.
-- (Older pending rows in workspace_members are left as they are; the Team page offers to turn
-- each into a link.)
--
-- Rollback (restores the previous handle_new_user exactly; nothing else references the table):
--   begin;
--   drop function if exists public.accept_workspace_invitation(text, uuid, text);
--   drop table if exists public.workspace_invitations;
--   -- then re-run the handle_new_user definition from 202609170004_workspaces_signup.sql
--   commit;

begin;

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Stored lower-case: comparisons are case-insensitive, like email addresses.
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
  role text not null check (role in ('owner', 'manager', 'setter', 'editor')),
  revenue_visible boolean not null default false,
  lead_share integer not null default 0 check (lead_share between 0 and 100),
  commission integer not null default 0 check (commission between 0 and 100),
  job_title text check (job_title is null or char_length(job_title) <= 80),
  cost_amount numeric(12, 2) not null default 0 check (cost_amount >= 0),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete set null,
  membership_id uuid references public.workspace_members(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  check (expires_at > created_at),
  check ((status = 'accepted') = (accepted_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

-- One open invitation per address per workspace (a second one is a regenerate, not a new row).
create unique index workspace_invitations_pending_email_idx
  on public.workspace_invitations (workspace_id, email) where status = 'pending';
create index workspace_invitations_workspace_idx
  on public.workspace_invitations (workspace_id, created_at desc);

create trigger workspace_invitations_updated_at before update on public.workspace_invitations
  for each row execute function public.set_updated_at();

alter table public.workspace_invitations enable row level security;
revoke all on public.workspace_invitations from anon, authenticated;
grant select, insert, update, delete on public.workspace_invitations to service_role;

-- Accepts an invitation for an authenticated person whose confirmed email the server has read
-- from Supabase Auth. Returns one row: outcome, workspace_id, membership_id.
--
--   accepted          joined now
--   already_member    already an active member of that workspace (the invitation is used up)
--   invalid           no invitation has this token
--   revoked | expired | used    the invitation can no longer be accepted
--   wrong_account     signed in with a different email than the invitation's
--   inviter_not_allowed   the inviter is no longer an owner/manager allowed to give this role
--   has_own_workspace the account belongs to a workspace in use (its own with data, or another)
create or replace function public.accept_workspace_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
returns table (outcome text, workspace_id uuid, membership_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  inv public.workspace_invitations%rowtype;
  inviter_role text;
  current_member record;
  own_member record;
  other_active integer;
  existing_id uuid;
  joined_id uuid;
begin
  select * into inv from public.workspace_invitations i
  where i.token_hash = p_token_hash
  for update;
  if not found then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if inv.status = 'revoked' then
    return query select 'revoked'::text, null::uuid, null::uuid;
    return;
  end if;
  if inv.status = 'accepted' then
    -- The same person clicking again gets the same answer; anyone else is refused.
    if inv.accepted_by = p_user_id then
      return query select 'already_member'::text, inv.workspace_id, inv.membership_id;
    else
      return query select 'used'::text, null::uuid, null::uuid;
    end if;
    return;
  end if;
  if inv.expires_at <= timezone('utc', now()) then
    return query select 'expired'::text, null::uuid, null::uuid;
    return;
  end if;
  if p_email is null or lower(btrim(p_email)) <> inv.email then
    return query select 'wrong_account'::text, null::uuid, null::uuid;
    return;
  end if;

  -- The inviter must still be an active owner or manager of the workspace, and a manager may
  -- only have given a setter or editor role (lib/team-policy.ts canManageRole).
  select m.role into inviter_role from public.workspace_members m
  where m.workspace_id = inv.workspace_id and m.user_id = inv.invited_by and m.status = 'active';
  if inviter_role is null
     or inviter_role not in ('owner', 'manager')
     or (inviter_role = 'manager' and inv.role not in ('setter', 'editor')) then
    return query select 'inviter_not_allowed'::text, null::uuid, null::uuid;
    return;
  end if;

  -- The account's memberships, locked so two acceptances for one account run one at a time.
  perform 1 from public.workspace_members m where m.user_id = p_user_id for update;

  select m.id, m.status into current_member from public.workspace_members m
  where m.workspace_id = inv.workspace_id and m.user_id = p_user_id;
  if found and current_member.status = 'active' then
    update public.workspace_invitations
    set status = 'accepted', accepted_at = timezone('utc', now()), accepted_by = p_user_id,
        membership_id = current_member.id
    where id = inv.id;
    return query select 'already_member'::text, inv.workspace_id, current_member.id;
    return;
  end if;
  existing_id := current_member.id; -- a removed (or legacy pending) row in this workspace, if any

  -- Any other active membership must be the account's own, unused workspace.
  select count(*) into other_active from public.workspace_members m
  where m.user_id = p_user_id and m.status = 'active' and m.workspace_id <> inv.workspace_id;
  if other_active > 1 then
    return query select 'has_own_workspace'::text, null::uuid, null::uuid;
    return;
  end if;
  if other_active = 1 then
    select m.id, m.workspace_id, m.role into own_member from public.workspace_members m
    where m.user_id = p_user_id and m.status = 'active' and m.workspace_id <> inv.workspace_id;
    if own_member.role <> 'owner'
       or exists (select 1 from public.youtube_channels c where c.workspace_id = own_member.workspace_id)
       or exists (
         select 1 from public.workspace_members o
         where o.workspace_id = own_member.workspace_id and o.id <> own_member.id
           and o.status in ('active', 'invited')
       )
       or exists (
         select 1 from public.subscriptions s
         where s.user_id = p_user_id and s.status in ('active', 'trialing', 'past_due')
       )
       or exists (
         select 1 from public.subscription_grants g
         where g.user_id = p_user_id and g.status = 'active'
           and (g.expires_at is null or g.expires_at > timezone('utc', now()))
       ) then
      return query select 'has_own_workspace'::text, null::uuid, null::uuid;
      return;
    end if;
    -- Leaves its own empty workspace. Nothing is deleted.
    update public.workspace_members set status = 'removed' where id = own_member.id;
  end if;

  if existing_id is not null then
    update public.workspace_members
    set status = 'active', role = inv.role, revenue_visible = inv.revenue_visible,
        lead_share = inv.lead_share, commission = inv.commission, job_title = inv.job_title,
        cost_amount = inv.cost_amount, invited_email = inv.email, invited_by = inv.invited_by,
        joined_at = timezone('utc', now())
    where id = existing_id
    returning id into joined_id;
  else
    insert into public.workspace_members
      (workspace_id, user_id, invited_email, role, revenue_visible, status, lead_share,
       commission, job_title, cost_amount, invited_by, invited_at, joined_at)
    values
      (inv.workspace_id, p_user_id, inv.email, inv.role, inv.revenue_visible, 'active',
       inv.lead_share, inv.commission, inv.job_title, inv.cost_amount, inv.invited_by,
       inv.created_at, timezone('utc', now()))
    returning id into joined_id;
  end if;

  update public.workspace_invitations
  set status = 'accepted', accepted_at = timezone('utc', now()), accepted_by = p_user_id,
      membership_id = joined_id
  where id = inv.id;

  return query select 'accepted'::text, inv.workspace_id, joined_id;
end;
$$;

revoke execute on function public.accept_workspace_invitation(text, uuid, text) from public;
revoke execute on function public.accept_workspace_invitation(text, uuid, text) from anon, authenticated;
grant execute on function public.accept_workspace_invitation(text, uuid, text) to service_role;

-- New accounts always get their own workspace. (Before: a pending invite with the same email
-- was joined at account creation, before the address was confirmed.) Everything else is as in
-- 202609170004_workspaces_signup.sql.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  new_workspace_id uuid;
begin
  insert into public.profiles (id, email, name, avatar, referral_code, referred_by)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data ->> 'avatar_url',
    lower(substr(replace(new.id::text, '-', ''), 1, 10)),
    (select id from public.profiles where referral_code = new.raw_user_meta_data ->> 'referred_by_code')
  );

  insert into public.workspaces (name, owner_id)
  values (
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), new.email, 'My Workspace'),
    new.id
  )
  returning id into new_workspace_id;

  insert into public.workspace_members
    (workspace_id, user_id, invited_email, role, status, invited_by, invited_at, joined_at)
  values (
    new_workspace_id, new.id, coalesce(new.email, ''), 'owner', 'active', new.id,
    timezone('utc', now()), timezone('utc', now())
  );

  return new;
end;
$$;

commit;
