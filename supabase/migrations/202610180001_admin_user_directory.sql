-- Admin console → Users at scale (Phase 1A).
--
-- Before this, the Users page loaded every profiles row (silently capped by PostgREST's default
-- 1,000-row limit) and every auth.users row (capped at 2,000 by our own pagination loop) into the
-- server, merged them in memory, and filtered and counted in the browser. None of that works past
-- a few thousand accounts.
--
-- What this adds:
--
--   * public.admin_user_directory — one narrow row per account holding exactly what the admin
--     list sorts, searches, filters and counts on. It exists because the account-status fields
--     (email_confirmed_at, banned_until, last_sign_in_at) live in auth.users, which this project's
--     roles do not own and cannot index; copying them here is what makes "Pending" and "Banned"
--     indexable. It is kept current by triggers on public.profiles and auth.users and backfilled
--     once below. It is NOT a metrics snapshot: every value is the account's current value.
--
--   * public.admin_list_users / public.admin_count_users / public.admin_user_stats — the only way
--     to read it. Keyset (cursor) pagination over indexed orderings, prefix search, role and
--     status filters, and exact counts, all inside Postgres.
--
-- Access. The table has row-level security enabled with no policies, and every privilege is
-- revoked from every API role — including service_role — so nothing can read or write it
-- directly through PostgREST. The three read functions are SECURITY DEFINER with a fixed, empty
-- search_path; EXECUTE is revoked from PUBLIC, anon and authenticated and granted to service_role
-- only. The server calls them with the service-role client after its own platform-permission
-- check (requirePermission(request, "manage_users") in api.admin.users.ts), exactly like every
-- other admin read. The trigger functions are not callable by any API role.
--
-- Safety for sign-in and sign-up. The two trigger functions catch every error and only raise a
-- WARNING: a failure to update this directory can never block a sign-up (the profiles insert in
-- handle_new_user) or a sign-in (the last_sign_in_at update on auth.users). The cost is one small
-- indexed update per sign-in.
--
-- Compatibility. Purely additive: no existing table, column, policy or function changes, so the
-- deployed code is unaffected. The new Users API needs these functions; it answers
-- 503 ADMIN_USERS_MIGRATION_REQUIRED until they exist, so apply this migration before deploying
-- that code.
--
-- Index builds. The indexes are created after the backfill with plain CREATE INDEX, which briefly
-- blocks writes to admin_user_directory only (a new table nothing else writes yet). On a future
-- table of millions of rows, new indexes should be added with CREATE INDEX CONCURRENTLY in a
-- migration of their own (it cannot run inside a transaction).

-- ---------------------------------------------------------------------------------------------
-- 1. The directory table
-- ---------------------------------------------------------------------------------------------

create table if not exists public.admin_user_directory (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null,
  -- Lower-cased, never null ('' when missing) so ordering and keyset comparisons are total. The
  -- "C" collation makes btree indexes serve both ORDER BY and LIKE 'prefix%' searches.
  email_lower text collate "C" not null default '',
  name_lower text collate "C" not null default '',
  role text not null default 'user',
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  creator_verified boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.admin_user_directory enable row level security;
revoke all on table public.admin_user_directory from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Keeping it current
-- ---------------------------------------------------------------------------------------------

-- A profiles row was created or its email, name or role changed. On creation, the account-status
-- fields are read from auth.users once; after that the auth.users trigger keeps them current.
create or replace function public.admin_user_directory_sync_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_user_directory as d (
    user_id, created_at, email_lower, name_lower, role,
    email_confirmed_at, banned_until, last_sign_in_at, creator_verified
  )
  select
    new.id,
    new.created_at,
    coalesce(lower(new.email), ''),
    coalesce(lower(new.name), ''),
    new.role::text,
    u.email_confirmed_at,
    u.banned_until,
    u.last_sign_in_at,
    coalesce(u.raw_user_meta_data ->> 'creator_verified', '') = 'true'
  from (select 1) as one
  left join auth.users as u on u.id = new.id
  on conflict (user_id) do update
    set email_lower = excluded.email_lower,
        name_lower = excluded.name_lower,
        role = excluded.role,
        updated_at = timezone('utc', now());
  return new;
exception when others then
  raise warning 'admin_user_directory_sync_profile(%): %', new.id, sqlerrm;
  return new;
end;
$$;

-- An auth.users row's verification, ban, last sign-in or metadata changed.
create or replace function public.admin_user_directory_sync_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.admin_user_directory
  set email_confirmed_at = new.email_confirmed_at,
      banned_until = new.banned_until,
      last_sign_in_at = new.last_sign_in_at,
      creator_verified = coalesce(new.raw_user_meta_data ->> 'creator_verified', '') = 'true',
      updated_at = timezone('utc', now())
  where user_id = new.id;
  return new;
exception when others then
  raise warning 'admin_user_directory_sync_auth(%): %', new.id, sqlerrm;
  return new;
end;
$$;

revoke all on function public.admin_user_directory_sync_profile() from public, anon, authenticated, service_role;
revoke all on function public.admin_user_directory_sync_auth() from public, anon, authenticated, service_role;

drop trigger if exists admin_user_directory_profile_sync on public.profiles;
create trigger admin_user_directory_profile_sync
  after insert or update of email, name, role on public.profiles
  for each row execute function public.admin_user_directory_sync_profile();

drop trigger if exists admin_user_directory_auth_sync on auth.users;
create trigger admin_user_directory_auth_sync
  after update of email_confirmed_at, banned_until, last_sign_in_at, raw_user_meta_data on auth.users
  for each row execute function public.admin_user_directory_sync_auth();

-- ---------------------------------------------------------------------------------------------
-- 3. Backfill (after the triggers, so nothing changed meanwhile is missed; idempotent)
-- ---------------------------------------------------------------------------------------------

insert into public.admin_user_directory (
  user_id, created_at, email_lower, name_lower, role,
  email_confirmed_at, banned_until, last_sign_in_at, creator_verified
)
select
  p.id,
  p.created_at,
  coalesce(lower(p.email), ''),
  coalesce(lower(p.name), ''),
  p.role::text,
  u.email_confirmed_at,
  u.banned_until,
  u.last_sign_in_at,
  coalesce(u.raw_user_meta_data ->> 'creator_verified', '') = 'true'
from public.profiles as p
left join auth.users as u on u.id = p.id
on conflict (user_id) do update
  set email_lower = excluded.email_lower,
      name_lower = excluded.name_lower,
      role = excluded.role,
      email_confirmed_at = excluded.email_confirmed_at,
      banned_until = excluded.banned_until,
      last_sign_in_at = excluded.last_sign_in_at,
      creator_verified = excluded.creator_verified,
      updated_at = timezone('utc', now());

-- ---------------------------------------------------------------------------------------------
-- 4. Indexes — one per ordering the list offers, plus the filters
-- ---------------------------------------------------------------------------------------------

-- Newest / oldest (the default list), and its keyset cursor.
create index if not exists admin_user_directory_created_idx
  on public.admin_user_directory (created_at desc, user_id desc);
-- Email A–Z, its keyset cursor, and email prefix search (C collation: LIKE 'abc%' is a range).
create index if not exists admin_user_directory_email_idx
  on public.admin_user_directory (email_lower, user_id);
-- Name prefix search.
create index if not exists admin_user_directory_name_idx
  on public.admin_user_directory (name_lower, user_id);
-- Role filter, newest first.
create index if not exists admin_user_directory_role_idx
  on public.admin_user_directory (role, created_at desc, user_id desc);
-- Status filters: both sets are a small part of all accounts, so partial indexes keep them cheap.
create index if not exists admin_user_directory_banned_idx
  on public.admin_user_directory (created_at desc, user_id desc)
  where banned_until is not null;
create index if not exists admin_user_directory_unconfirmed_idx
  on public.admin_user_directory (created_at desc, user_id desc)
  where email_confirmed_at is null;

-- The user detail view's "recent admin actions on this account" (admin_audit_log.target holds the
-- account's email or id). Bounded by LIMIT in the API.
create index if not exists admin_audit_log_target_created_idx
  on public.admin_audit_log (target, created_at desc);

-- ---------------------------------------------------------------------------------------------
-- 5. Reading it
-- ---------------------------------------------------------------------------------------------

-- The WHERE clause shared by the list and the count. Every value that comes from a caller is
-- either checked against a fixed list here or passed as a quoted literal (%L), so no caller text
-- is ever interpreted as SQL. Search is a prefix match only (never a leading wildcard): LIKE's
-- own wildcards in the search text are escaped, so "a%b" searches for those three characters.
create or replace function public.admin_user_directory_where(
  p_search_kind text,
  p_search text,
  p_role text,
  p_status text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_where text := 'true';
  v_pattern text;
begin
  if p_search_kind is not null then
    if p_search is null or length(p_search) < 2 or length(p_search) > 100 then
      raise exception 'admin_user_directory: invalid search' using errcode = '22023';
    end if;
    v_pattern := replace(replace(replace(lower(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    if p_search_kind = 'id' then
      v_where := v_where || format(' and d.user_id = %L::uuid', p_search);
    elsif p_search_kind = 'email' then
      v_where := v_where || format(' and d.email_lower like %L', v_pattern);
    elsif p_search_kind = 'text' then
      v_where := v_where || format(
        ' and (d.email_lower like %L or d.name_lower like %L)', v_pattern, v_pattern
      );
    else
      raise exception 'admin_user_directory: invalid search kind' using errcode = '22023';
    end if;
  end if;

  if p_role is not null then
    if p_role not in ('user', 'editor', 'setter', 'manager', 'owner', 'superadmin') then
      raise exception 'admin_user_directory: invalid role' using errcode = '22023';
    end if;
    v_where := v_where || format(' and d.role = %L', p_role);
  end if;

  -- The same precedence the app has always shown: Banned, then Pending, then Active.
  if p_status = 'banned' then
    v_where := v_where || ' and d.banned_until is not null and d.banned_until > now()';
  elsif p_status = 'pending' then
    v_where := v_where
      || ' and d.email_confirmed_at is null and (d.banned_until is null or d.banned_until <= now())';
  elsif p_status = 'active' then
    v_where := v_where
      || ' and d.email_confirmed_at is not null and (d.banned_until is null or d.banned_until <= now())';
  elsif p_status is not null then
    raise exception 'admin_user_directory: invalid status' using errcode = '22023';
  end if;

  return v_where;
end;
$$;

-- One page of accounts. p_limit is at most 101 (the API asks for one more than it shows, to know
-- whether there is a next page). The cursor is the last row of the previous page in the same
-- ordering: (created_at, user_id) for newest/oldest, (email_lower, user_id) for email.
create or replace function public.admin_list_users(
  p_limit integer,
  p_sort text,
  p_search_kind text default null,
  p_search text default null,
  p_role text default null,
  p_status text default null,
  p_cursor_created timestamptz default null,
  p_cursor_email text default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  name text,
  email text,
  avatar text,
  role text,
  created_at timestamptz,
  email_lower text,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  creator_verified boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_where text;
  v_cursor text := '';
  v_order text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'admin_list_users: invalid limit' using errcode = '22023';
  end if;
  v_where := public.admin_user_directory_where(p_search_kind, p_search, p_role, p_status);

  if p_sort = 'newest' then
    v_order := 'd.created_at desc, d.user_id desc';
    if p_cursor_id is not null then
      if p_cursor_created is null then
        raise exception 'admin_list_users: invalid cursor' using errcode = '22023';
      end if;
      v_cursor := ' and (d.created_at, d.user_id) < ($1, $3)';
    end if;
  elsif p_sort = 'oldest' then
    v_order := 'd.created_at asc, d.user_id asc';
    if p_cursor_id is not null then
      if p_cursor_created is null then
        raise exception 'admin_list_users: invalid cursor' using errcode = '22023';
      end if;
      v_cursor := ' and (d.created_at, d.user_id) > ($1, $3)';
    end if;
  elsif p_sort = 'email' then
    v_order := 'd.email_lower asc, d.user_id asc';
    if p_cursor_id is not null then
      if p_cursor_email is null then
        raise exception 'admin_list_users: invalid cursor' using errcode = '22023';
      end if;
      v_cursor := ' and (d.email_lower, d.user_id) > ($2 collate "C", $3)';
    end if;
  else
    raise exception 'admin_list_users: invalid sort' using errcode = '22023';
  end if;

  return query execute format(
    'select p.id, p.name, p.email, p.avatar, d.role, d.created_at, d.email_lower,
            d.email_confirmed_at, d.banned_until, d.last_sign_in_at, d.creator_verified
       from public.admin_user_directory as d
       join public.profiles as p on p.id = d.user_id
      where %s%s
      order by %s
      limit $4',
    v_where, v_cursor, v_order
  )
  using p_cursor_created, p_cursor_email, p_cursor_id, p_limit;
end;
$$;

-- The exact number of accounts matching the same filters (no cursor).
create or replace function public.admin_count_users(
  p_search_kind text default null,
  p_search text default null,
  p_role text default null,
  p_status text default null
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count bigint;
begin
  execute format(
    'select count(*) from public.admin_user_directory as d where %s',
    public.admin_user_directory_where(p_search_kind, p_search, p_role, p_status)
  )
  into v_count;
  return v_count;
end;
$$;

-- The four totals at the top of the Users page. Banned and Pending come from the partial
-- indexes; Active is what is left, with Banned taking precedence over Pending as in the list.
create or replace function public.admin_user_stats()
returns table (total bigint, active bigint, pending bigint, banned bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with
    all_users as (select count(*) as n from public.admin_user_directory),
    banned_users as (
      select count(*) as n from public.admin_user_directory
      where banned_until is not null and banned_until > now()
    ),
    pending_users as (
      select count(*) as n from public.admin_user_directory
      where email_confirmed_at is null and (banned_until is null or banned_until <= now())
    )
  select
    all_users.n,
    all_users.n - banned_users.n - pending_users.n,
    pending_users.n,
    banned_users.n
  from all_users, banned_users, pending_users;
$$;

revoke all on function public.admin_user_directory_where(text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_users(
  integer, text, text, text, text, text, timestamptz, text, uuid
) from public, anon, authenticated;
revoke all on function public.admin_count_users(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_user_stats() from public, anon, authenticated;

grant execute on function public.admin_list_users(
  integer, text, text, text, text, text, timestamptz, text, uuid
) to service_role;
grant execute on function public.admin_count_users(text, text, text, text) to service_role;
grant execute on function public.admin_user_stats() to service_role;
