-- Admin-granted subscriptions: platform staff can give a user a paid plan (Starter, Pro or Scale)
-- for a number of days, or with no end, without any payment. Nothing here touches Stripe.
--
-- How it is used (src/lib/server/subscription-grants.ts, plan-access.ts):
--   * A grant gives its user's OWN workspaces the plan, exactly like a paid subscription does
--     (plans belong to a workspace through its owner). A real Stripe subscription that is active
--     or trialing always takes precedence.
--   * A grant counts while status = 'active', starts_at <= now() and (expires_at is null or
--     expires_at > now()). Expiry is therefore exact at read time; the daily sweep
--     (expire_subscription_grants) only records it.
--   * One active grant per user (a partial unique index). The server also refuses a grant to a
--     user with a live Stripe subscription, and refuses Checkout while a grant is active.
--
-- Security:
--   * Row-level security on both tables and NO policies: no browser session can read or write
--     them. Only the server, with the service role, reads them; the reason and the granting
--     admin are internal and never returned to the user.
--   * Every change goes through one of the functions below, which write the grant, its history
--     row and the admin audit row in one transaction (the audit cannot be skipped or lost). They
--     are SECURITY INVOKER with a fixed search_path, and EXECUTE is revoked from PUBLIC, anon and
--     authenticated: only service_role may call them, from the admin API after its own
--     permission check (manage_billing).
--
-- Rollback (nothing else references these objects):
--   drop function if exists public.expire_subscription_grants();
--   drop function if exists public.admin_revoke_subscription_grant(uuid, uuid, uuid, text);
--   drop function if exists public.admin_extend_subscription_grant(uuid, uuid, uuid, timestamptz, text);
--   drop function if exists public.admin_grant_subscription(uuid, uuid, text, timestamptz, text);
--   drop table if exists public.subscription_grant_events;
--   drop table if exists public.subscription_grants;

create table public.subscription_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null check (plan_id in ('starter', 'pro', 'scale')),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  starts_at timestamptz not null default timezone('utc', now()),
  -- null = no end ("lifetime")
  expires_at timestamptz,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  granted_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 3 and 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (expires_at is null or expires_at > starts_at),
  check ((status = 'revoked') = (revoked_at is not null))
);

-- Only one active grant per user.
create unique index subscription_grants_one_active_idx
  on public.subscription_grants(user_id) where status = 'active';
create index subscription_grants_user_idx on public.subscription_grants(user_id, created_at desc);
create index subscription_grants_expiry_idx
  on public.subscription_grants(expires_at) where status = 'active' and expires_at is not null;

create trigger subscription_grants_updated_at before update on public.subscription_grants
  for each row execute function public.set_updated_at();

-- The history of every grant: granted, extended, revoked and expired (the last with no actor).
create table public.subscription_grant_events (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.subscription_grants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (event in ('granted', 'extended', 'revoked', 'expired')),
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default timezone('utc', now())
);
create index subscription_grant_events_user_idx
  on public.subscription_grant_events(user_id, created_at desc);
create index subscription_grant_events_grant_idx
  on public.subscription_grant_events(grant_id, created_at desc);

alter table public.subscription_grants enable row level security;
alter table public.subscription_grant_events enable row level security;
revoke all on table public.subscription_grants from public, anon, authenticated;
revoke all on table public.subscription_grant_events from public, anon, authenticated;
grant select, insert, update on table public.subscription_grants to service_role;
grant select, insert on table public.subscription_grant_events to service_role;

-- ---------------------------------------------------------------------------------------------
-- Grant: a new active grant. Fails with a unique violation (23505) when the user already has one.
-- A previous active grant whose end has passed but that the sweep has not recorded yet is
-- recorded as expired first, so it never blocks a new grant.
create or replace function public.admin_grant_subscription(
  p_admin_id uuid,
  p_user_id uuid,
  p_plan_id text,
  p_expires_at timestamptz,
  p_reason text
) returns public.subscription_grants
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_grant public.subscription_grants;
  v_stale public.subscription_grants;
begin
  if p_expires_at is not null and p_expires_at <= v_now then
    raise exception 'GRANT_END_IN_PAST' using errcode = '22023';
  end if;

  for v_stale in
    update public.subscription_grants
       set status = 'expired'
     where user_id = p_user_id and status = 'active'
       and expires_at is not null and expires_at <= v_now
    returning *
  loop
    insert into public.subscription_grant_events (grant_id, user_id, event, old_value, new_value)
    values (v_stale.id, v_stale.user_id, 'expired',
            jsonb_build_object('status', 'active'),
            jsonb_build_object('status', 'expired', 'expires_at', v_stale.expires_at));
  end loop;

  insert into public.subscription_grants (user_id, plan_id, starts_at, expires_at, reason, granted_by)
  values (p_user_id, p_plan_id, v_now, p_expires_at, btrim(p_reason), p_admin_id)
  returning * into v_grant;

  insert into public.subscription_grant_events (grant_id, user_id, event, actor_id, reason, new_value)
  values (v_grant.id, p_user_id, 'granted', p_admin_id, v_grant.reason,
          jsonb_build_object('plan', v_grant.plan_id, 'expires_at', v_grant.expires_at));

  insert into public.admin_audit_log (admin_user_id, action, target, new_value)
  values (p_admin_id, 'subscription_grant_created', p_user_id::text,
          jsonb_build_object('grant_id', v_grant.id, 'plan', v_grant.plan_id,
                             'expires_at', v_grant.expires_at, 'reason', v_grant.reason));
  return v_grant;
end;
$$;

-- Extend: a new, later end for the user's current active grant, or no end (null).
create or replace function public.admin_extend_subscription_grant(
  p_admin_id uuid,
  p_grant_id uuid,
  p_user_id uuid,
  p_expires_at timestamptz,
  p_reason text
) returns public.subscription_grants
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_old public.subscription_grants;
  v_grant public.subscription_grants;
begin
  select * into v_old from public.subscription_grants
   where id = p_grant_id and user_id = p_user_id and status = 'active'
     and (expires_at is null or expires_at > v_now)
   for update;
  if not found then
    raise exception 'GRANT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.expires_at is null then
    raise exception 'GRANT_ALREADY_LIFETIME' using errcode = '22023';
  end if;
  if p_expires_at is not null and p_expires_at <= v_old.expires_at then
    raise exception 'GRANT_NOT_LATER' using errcode = '22023';
  end if;

  update public.subscription_grants set expires_at = p_expires_at
   where id = v_old.id returning * into v_grant;

  insert into public.subscription_grant_events
    (grant_id, user_id, event, actor_id, reason, old_value, new_value)
  values (v_grant.id, p_user_id, 'extended', p_admin_id, btrim(p_reason),
          jsonb_build_object('expires_at', v_old.expires_at),
          jsonb_build_object('expires_at', v_grant.expires_at));

  insert into public.admin_audit_log (admin_user_id, action, target, old_value, new_value)
  values (p_admin_id, 'subscription_grant_extended', p_user_id::text,
          jsonb_build_object('grant_id', v_grant.id, 'expires_at', v_old.expires_at),
          jsonb_build_object('grant_id', v_grant.id, 'expires_at', v_grant.expires_at,
                             'reason', btrim(p_reason)));
  return v_grant;
end;
$$;

-- Revoke: ends the user's active grant now.
create or replace function public.admin_revoke_subscription_grant(
  p_admin_id uuid,
  p_grant_id uuid,
  p_user_id uuid,
  p_reason text
) returns public.subscription_grants
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_grant public.subscription_grants;
begin
  update public.subscription_grants
     set status = 'revoked', revoked_at = v_now, revoked_by = p_admin_id,
         revoke_reason = btrim(p_reason)
   where id = p_grant_id and user_id = p_user_id and status = 'active'
     and (expires_at is null or expires_at > v_now)
  returning * into v_grant;
  if not found then
    raise exception 'GRANT_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.subscription_grant_events
    (grant_id, user_id, event, actor_id, reason, old_value, new_value)
  values (v_grant.id, p_user_id, 'revoked', p_admin_id, v_grant.revoke_reason,
          jsonb_build_object('status', 'active'), jsonb_build_object('status', 'revoked'));

  insert into public.admin_audit_log (admin_user_id, action, target, old_value, new_value)
  values (p_admin_id, 'subscription_grant_revoked', p_user_id::text,
          jsonb_build_object('grant_id', v_grant.id, 'plan', v_grant.plan_id,
                             'expires_at', v_grant.expires_at),
          jsonb_build_object('grant_id', v_grant.id, 'status', 'revoked',
                             'reason', v_grant.revoke_reason));
  return v_grant;
end;
$$;

-- The daily sweep: records every grant whose end has passed as expired (bounded per run).
create or replace function public.expire_subscription_grants()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_grant public.subscription_grants;
  v_count integer := 0;
begin
  for v_grant in
    update public.subscription_grants
       set status = 'expired'
     where id in (
       select id from public.subscription_grants
        where status = 'active' and expires_at is not null and expires_at <= v_now
        order by expires_at
        limit 500
        for update skip locked
     )
    returning *
  loop
    insert into public.subscription_grant_events (grant_id, user_id, event, old_value, new_value)
    values (v_grant.id, v_grant.user_id, 'expired',
            jsonb_build_object('status', 'active'),
            jsonb_build_object('status', 'expired', 'expires_at', v_grant.expires_at));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.admin_grant_subscription(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.admin_extend_subscription_grant(uuid, uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.admin_revoke_subscription_grant(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.expire_subscription_grants() from public, anon, authenticated;
grant execute on function public.admin_grant_subscription(uuid, uuid, text, timestamptz, text)
  to service_role;
grant execute on function public.admin_extend_subscription_grant(uuid, uuid, uuid, timestamptz, text)
  to service_role;
grant execute on function public.admin_revoke_subscription_grant(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.expire_subscription_grants() to service_role;
