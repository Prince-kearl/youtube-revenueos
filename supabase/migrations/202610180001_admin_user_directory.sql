-- Admin console → Users at scale (Phase 1A), step 1 of 3: the directory, its indexes and its
-- functions. No triggers yet and no backfill — this step never locks auth.users and holds a lock
-- on public.profiles only for the instant it takes to add a foreign key to an EMPTY table.
--
-- Deployment sequence (each file is run ON ITS OWN in the Supabase SQL editor — the editor runs
-- a script as one transaction, so these steps must not be pasted together):
--
--   1. 202610180001_admin_user_directory.sql            (this file)   short, retryable
--   2. 202610180002_admin_user_directory_triggers.sql                 short, retryable
--   3. Backfill: repeat `select * from public.admin_user_directory_backfill_step(2000);` (or use
--      the admin console's "Build directory") until it reports status 'complete'. Each call is
--      one bounded batch in its own short transaction; progress is stored, so it resumes after
--      any interruption.
--   4. 202610180003_admin_audit_log_target_index.sql   a single CREATE INDEX CONCURRENTLY
--      statement, run alone (it cannot run inside a transaction).
--
-- Until step 3 completes, the Users list answers 503 ADMIN_USERS_DIRECTORY_INCOMPLETE (with
-- progress) — the database itself refuses to list, count or total a partial directory — and the
-- deployed code keeps working, because nothing here changes an existing object.
--
-- Why a directory at all. The Users page used to load every profiles row (silently capped at
-- PostgREST's 1,000 rows) and every auth.users row (capped at 2,000 by our own loop) into
-- memory, then search and count in the browser. The account-status fields live in auth.users,
-- which this project cannot index, so they are mirrored here, with the account's email.
--
-- Authoritative identity. The email in the directory comes from auth.users.email — the address
-- the person actually signs in with — never from profiles.email, which the profiles_self_update
-- policy lets a user rewrite. Name and role come from profiles (role is protected there).
--
-- Access. All three tables have row-level security enabled with no policies and every privilege
-- revoked from every API role, service_role included. Only the SECURITY DEFINER functions below
-- (fixed empty search_path) touch them; EXECUTE on the read and maintenance functions is granted
-- to service_role only, and the server calls them after its own platform-role check.

begin;
-- Fail fast instead of queueing behind a long transaction (a queued lock request would itself
-- block every later writer of public.profiles). On a timeout, simply run this file again.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------

create table if not exists public.admin_user_directory (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null,
  -- From auth.users.email. email_lower is never null ('' when missing) so ordering and keyset
  -- comparisons are total; the "C" collation lets one btree serve ORDER BY and LIKE 'prefix%'.
  email text,
  email_lower text collate "C" not null default '',
  name_lower text collate "C" not null default '',
  role text not null default 'user',
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  creator_verified boolean not null default false,
  -- When this row was last written, and by whom: a trigger, the backfill, or a repair. Repairs
  -- never overwrite a row a trigger wrote after the repair started.
  synced_at timestamptz not null default clock_timestamp(),
  synced_by text not null default 'trigger' check (synced_by in ('trigger', 'backfill', 'repair'))
);

-- One row: where the initial backfill stands.
create table if not exists public.admin_user_directory_state (
  id boolean primary key default true check (id),
  status text not null default 'pending'
    check (status in ('pending', 'backfilling', 'complete', 'failed')),
  backfill_cursor uuid,
  processed bigint not null default 0,
  inserted bigint not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.admin_user_directory_state (id) values (true) on conflict (id) do nothing;

-- A trigger that could not update the directory records the account id and the error code here
-- (never the message or any personal data) so the gap is visible and can be repaired.
create table if not exists public.admin_user_directory_sync_failures (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  source text not null check (source in ('profile', 'auth')),
  sqlstate text not null,
  occurred_at timestamptz not null default clock_timestamp()
);

alter table public.admin_user_directory enable row level security;
alter table public.admin_user_directory_state enable row level security;
alter table public.admin_user_directory_sync_failures enable row level security;
revoke all on table public.admin_user_directory from public, anon, authenticated, service_role;
revoke all on table public.admin_user_directory_state from public, anon, authenticated, service_role;
revoke all on table public.admin_user_directory_sync_failures
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Indexes — built now, on the empty table, so the backfill never needs a long index build
-- ---------------------------------------------------------------------------------------------

create index if not exists admin_user_directory_created_idx
  on public.admin_user_directory (created_at desc, user_id desc);
create index if not exists admin_user_directory_email_idx
  on public.admin_user_directory (email_lower, user_id);
create index if not exists admin_user_directory_name_idx
  on public.admin_user_directory (name_lower, user_id);
create index if not exists admin_user_directory_role_idx
  on public.admin_user_directory (role, created_at desc, user_id desc);
create index if not exists admin_user_directory_banned_idx
  on public.admin_user_directory (created_at desc, user_id desc)
  where banned_until is not null;
create index if not exists admin_user_directory_unconfirmed_idx
  on public.admin_user_directory (created_at desc, user_id desc)
  where email_confirmed_at is null;
create index if not exists admin_user_directory_sync_failures_time_idx
  on public.admin_user_directory_sync_failures (occurred_at desc);

-- ---------------------------------------------------------------------------------------------
-- What a directory row should contain, computed from the sources (internal)
-- ---------------------------------------------------------------------------------------------

-- The expected directory rows for one window of accounts, in id order after p_after. The one
-- definition the backfill, the drift check and the repair all share. Email and account status
-- from auth.users; created_at, name and role from profiles.
--
-- PL/pgSQL with EXECUTE ... USING on purpose: a SECURITY DEFINER SQL function cannot be inlined,
-- and its body is planned without knowing p_after — measured at 1.7 million accounts, that plan
-- scanned and sorted the whole table on every call (31 s per batch). EXECUTE plans each call with
-- the actual cursor value: a primary-key range read of p_limit rows (~40 ms). p_after is a bound
-- parameter, never spliced into the SQL text.
create or replace function public.admin_user_directory_expected(p_after uuid, p_limit integer)
returns table (
  user_id uuid,
  created_at timestamptz,
  email text,
  email_lower text,
  name_lower text,
  role text,
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
begin
  return query execute
    'select
       p.id,
       p.created_at,
       u.email,
       coalesce(lower(u.email), ''''),
       coalesce(lower(p.name), ''''),
       p.role::text,
       u.email_confirmed_at,
       u.banned_until,
       u.last_sign_in_at,
       coalesce(u.raw_user_meta_data ->> ''creator_verified'', '''') = ''true''
     from public.profiles as p
     left join auth.users as u on u.id = p.id
     where p.id > $1
     order by p.id
     limit $2'
  using coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid), p_limit;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Keeping it current (the triggers themselves are created by migration 202610180002)
-- ---------------------------------------------------------------------------------------------

-- A profiles row was created, or its name or role changed. Its email is NEVER taken from
-- profiles: on creation it is read from auth.users; on an update only name and role change.
create or replace function public.admin_user_directory_sync_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_user_directory as d (
    user_id, created_at, email, email_lower, name_lower, role,
    email_confirmed_at, banned_until, last_sign_in_at, creator_verified, synced_at, synced_by
  )
  select
    new.id,
    new.created_at,
    u.email,
    coalesce(lower(u.email), ''),
    coalesce(lower(new.name), ''),
    new.role::text,
    u.email_confirmed_at,
    u.banned_until,
    u.last_sign_in_at,
    coalesce(u.raw_user_meta_data ->> 'creator_verified', '') = 'true',
    clock_timestamp(),
    'trigger'
  from (select 1) as one
  left join auth.users as u on u.id = new.id
  on conflict (user_id) do update
    set name_lower = excluded.name_lower,
        role = excluded.role,
        synced_at = clock_timestamp(),
        synced_by = 'trigger';
  return new;
exception when others then
  begin
    insert into public.admin_user_directory_sync_failures (user_id, source, sqlstate)
    values (new.id, 'profile', sqlstate);
  exception when others then
    null;
  end;
  raise warning 'admin_user_directory_sync_profile(%) failed: SQLSTATE %', new.id, sqlstate;
  return new;
end;
$$;

-- An auth.users row's email, verification, ban, last sign-in or metadata changed. Upserts, so an
-- account the backfill has not reached yet gets its row now.
create or replace function public.admin_user_directory_sync_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_user_directory as d (
    user_id, created_at, email, email_lower, name_lower, role,
    email_confirmed_at, banned_until, last_sign_in_at, creator_verified, synced_at, synced_by
  )
  select
    p.id,
    p.created_at,
    new.email,
    coalesce(lower(new.email), ''),
    coalesce(lower(p.name), ''),
    p.role::text,
    new.email_confirmed_at,
    new.banned_until,
    new.last_sign_in_at,
    coalesce(new.raw_user_meta_data ->> 'creator_verified', '') = 'true',
    clock_timestamp(),
    'trigger'
  from public.profiles as p
  where p.id = new.id
  on conflict (user_id) do update
    set email = excluded.email,
        email_lower = excluded.email_lower,
        email_confirmed_at = excluded.email_confirmed_at,
        banned_until = excluded.banned_until,
        last_sign_in_at = excluded.last_sign_in_at,
        creator_verified = excluded.creator_verified,
        synced_at = clock_timestamp(),
        synced_by = 'trigger';
  return new;
exception when others then
  begin
    insert into public.admin_user_directory_sync_failures (user_id, source, sqlstate)
    values (new.id, 'auth', sqlstate);
  exception when others then
    null;
  end;
  raise warning 'admin_user_directory_sync_auth(%) failed: SQLSTATE %', new.id, sqlstate;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Initial backfill: bounded, resumable, never overwrites a trigger's newer data
-- ---------------------------------------------------------------------------------------------

-- One batch of at most p_limit accounts (in id order, after the stored cursor), in the caller's
-- transaction. Inserts only rows that do not exist yet (ON CONFLICT DO NOTHING): any row already
-- there was written by a trigger with data at least as new, so it is never overwritten. Accounts
-- created during the backfill get their row from the profiles trigger (installed first, by
-- 202610180002). The state row is locked for the batch, so two callers never run batches at once.
-- A failing batch is rolled back, recorded as 'failed', and the next call resumes from the same
-- cursor. 'complete' is set only when a batch finds fewer accounts than its limit.
create or replace function public.admin_user_directory_backfill_step(p_limit integer default 1000)
returns table (
  status text,
  batch_processed integer,
  batch_inserted integer,
  total_processed bigint,
  done boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_state public.admin_user_directory_state;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_last uuid;
  v_complete boolean;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'admin_user_directory_backfill_step: invalid limit' using errcode = '22023';
  end if;

  select * into v_state from public.admin_user_directory_state as s where s.id for update;
  if v_state.status = 'complete' then
    return query select 'complete'::text, 0, 0, v_state.processed, true;
    return;
  end if;

  begin
    -- One statement: read the window, insert what is missing, and report. ON CONFLICT DO NOTHING
    -- keeps any row a trigger already wrote. The batch's profiles rows are locked FOR KEY SHARE
    -- (ordinary profile edits are not blocked by it): an account deleted concurrently either
    -- waits for this batch or, if its deletion committed first, is dropped from the batch — so
    -- the foreign key can never fail mid-batch.
    with
      batch as materialized (
        select * from public.admin_user_directory_expected(v_state.backfill_cursor, p_limit)
      ),
      live as (
        select p.id from public.profiles as p
        where p.id in (select b.user_id from batch as b)
        for key share of p
      ),
      ins as (
        insert into public.admin_user_directory (
          user_id, created_at, email, email_lower, name_lower, role,
          email_confirmed_at, banned_until, last_sign_in_at, creator_verified, synced_at, synced_by
        )
        select
          b.user_id, b.created_at, b.email, b.email_lower, b.name_lower, b.role,
          b.email_confirmed_at, b.banned_until, b.last_sign_in_at, b.creator_verified,
          clock_timestamp(), 'backfill'
        from batch as b
        join live as l on l.id = b.user_id
        on conflict (user_id) do nothing
        returning 1
      )
    select
      (select count(*)::integer from batch),
      (select count(*)::integer from ins),
      (select b.user_id from batch as b order by b.user_id desc limit 1)
    into v_seen, v_inserted, v_last;
    v_complete := v_seen < p_limit;

    update public.admin_user_directory_state as s
    set status = case when v_complete then 'complete' else 'backfilling' end,
        backfill_cursor = coalesce(v_last, s.backfill_cursor),
        processed = s.processed + v_seen,
        inserted = s.inserted + v_inserted,
        started_at = coalesce(s.started_at, clock_timestamp()),
        completed_at = case when v_complete then clock_timestamp() end,
        updated_at = clock_timestamp()
    where s.id
    returning s.processed into v_state.processed;
  exception when others then
    update public.admin_user_directory_state as s
    set status = 'failed', last_error_code = sqlstate, last_error_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where s.id;
    return query select 'failed'::text, 0, 0, v_state.processed, false;
    return;
  end;

  return query select
    case when v_complete then 'complete' else 'backfilling' end::text,
    v_seen, v_inserted, v_state.processed, v_complete;
end;
$$;

-- Where the backfill stands, and how many trigger failures were recorded in the last day.
create or replace function public.admin_user_directory_status()
returns table (
  status text,
  processed bigint,
  inserted bigint,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  sync_failures_24h bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.status, s.processed, s.inserted, s.started_at, s.completed_at, s.last_error_code,
         s.last_error_at,
         (select count(*) from public.admin_user_directory_sync_failures as f
           where f.occurred_at > now() - interval '24 hours')
  from public.admin_user_directory_state as s
  where s.id;
$$;

-- ---------------------------------------------------------------------------------------------
-- Drift detection and repair: one bounded window per call
-- ---------------------------------------------------------------------------------------------

-- Read-only. Compares one window of accounts (id order, after p_after) with the directory.
create or replace function public.admin_user_directory_check(p_after uuid, p_limit integer)
returns table (
  checked integer,
  missing integer,
  stale_email integer,
  stale_profile integer,
  stale_status integer,
  next_after uuid,
  done boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'admin_user_directory_check: invalid limit' using errcode = '22023';
  end if;
  return query
  with e as (select * from public.admin_user_directory_expected(p_after, p_limit))
  select
    count(*)::integer,
    count(*) filter (where d.user_id is null)::integer,
    count(*) filter (
      where d.user_id is not null
        and (d.email is distinct from e.email or d.email_lower is distinct from e.email_lower)
    )::integer,
    count(*) filter (
      where d.user_id is not null
        and (d.name_lower is distinct from e.name_lower or d.role is distinct from e.role
             or d.created_at is distinct from e.created_at)
    )::integer,
    count(*) filter (
      where d.user_id is not null
        and (d.email_confirmed_at is distinct from e.email_confirmed_at
             or d.banned_until is distinct from e.banned_until
             or d.last_sign_in_at is distinct from e.last_sign_in_at
             or d.creator_verified is distinct from e.creator_verified)
    )::integer,
    (select e2.user_id from e as e2 order by e2.user_id desc limit 1),
    count(*) < p_limit
  from e
  left join public.admin_user_directory as d on d.user_id = e.user_id;
end;
$$;

-- Repairs one window: inserts missing rows and corrects stale ones from the sources. Never
-- touches auth.users or profiles. A row a trigger wrote after this call started is left alone
-- (it is newer than what this call read); the next check will look at it again.
create or replace function public.admin_user_directory_repair(p_after uuid, p_limit integer)
returns table (checked integer, inserted integer, updated integer, next_after uuid, done boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_checked integer;
  v_inserted integer;
  v_updated integer;
  v_last uuid;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'admin_user_directory_repair: invalid limit' using errcode = '22023';
  end if;

  with
    w as materialized (select * from public.admin_user_directory_expected(p_after, p_limit)),
    live as (
      select p.id from public.profiles as p
      where p.id in (select w.user_id from w)
      for key share of p
    ),
    ins as (
      insert into public.admin_user_directory (
        user_id, created_at, email, email_lower, name_lower, role,
        email_confirmed_at, banned_until, last_sign_in_at, creator_verified, synced_at, synced_by
      )
      select
        w.user_id, w.created_at, w.email, w.email_lower, w.name_lower, w.role,
        w.email_confirmed_at, w.banned_until, w.last_sign_in_at, w.creator_verified,
        clock_timestamp(), 'repair'
      from w
      join live as l on l.id = w.user_id
      on conflict (user_id) do nothing
      returning 1
    ),
    upd as (
      update public.admin_user_directory as d
      set created_at = w.created_at,
          email = w.email,
          email_lower = w.email_lower,
          name_lower = w.name_lower,
          role = w.role,
          email_confirmed_at = w.email_confirmed_at,
          banned_until = w.banned_until,
          last_sign_in_at = w.last_sign_in_at,
          creator_verified = w.creator_verified,
          synced_at = clock_timestamp(),
          synced_by = 'repair'
      from w
      where d.user_id = w.user_id
        -- A row a trigger wrote after this call started holds newer data than this call read.
        and d.synced_at < v_started
        and (d.created_at, d.email, d.email_lower, d.name_lower, d.role, d.email_confirmed_at,
             d.banned_until, d.last_sign_in_at, d.creator_verified)
            is distinct from
            (w.created_at, w.email, w.email_lower, w.name_lower, w.role, w.email_confirmed_at,
             w.banned_until, w.last_sign_in_at, w.creator_verified)
      returning 1
    )
  select
    (select count(*)::integer from w),
    (select count(*)::integer from ins),
    (select count(*)::integer from upd),
    (select w2.user_id from w as w2 order by w2.user_id desc limit 1)
  into v_checked, v_inserted, v_updated, v_last;
  return query select v_checked, v_inserted, v_updated, v_last, v_checked < p_limit;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Reading it — refused until the initial backfill is complete
-- ---------------------------------------------------------------------------------------------

create or replace function public.admin_user_directory_assert_complete()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.admin_user_directory_state as s where s.id and s.status = 'complete'
  ) then
    raise exception 'admin_user_directory_incomplete' using errcode = '55000';
  end if;
end;
$$;

-- The WHERE clause shared by the list and the count. Caller values are checked against fixed
-- lists or passed as quoted literals (%L); search is a prefix match only, with LIKE's own
-- wildcards escaped.
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

-- One page. p_limit is at most 101 (the API asks for one more than it shows). The cursor is the
-- last row of the previous page in the same ordering: (created_at, user_id) for newest/oldest,
-- (email_lower, user_id) for email. user_id breaks every tie, so the order is total.
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
  perform public.admin_user_directory_assert_complete();
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

  -- Email is the directory's (auth.users); name and avatar are the profile's display values.
  return query execute format(
    'select p.id, p.name, d.email, p.avatar, d.role, d.created_at, d.email_lower,
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
  perform public.admin_user_directory_assert_complete();
  execute format(
    'select count(*) from public.admin_user_directory as d where %s',
    public.admin_user_directory_where(p_search_kind, p_search, p_role, p_status)
  )
  into v_count;
  return v_count;
end;
$$;

create or replace function public.admin_user_stats()
returns table (total bigint, active bigint, pending bigint, banned bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_user_directory_assert_complete();
  return query
  with
    all_users as (select count(*) as n from public.admin_user_directory),
    banned_users as (
      select count(*) as n from public.admin_user_directory as d
      where d.banned_until is not null and d.banned_until > now()
    ),
    pending_users as (
      select count(*) as n from public.admin_user_directory as d
      where d.email_confirmed_at is null and (d.banned_until is null or d.banned_until <= now())
    )
  select all_users.n, all_users.n - banned_users.n - pending_users.n, pending_users.n,
         banned_users.n
  from all_users, banned_users, pending_users;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------------------------

-- Internal: callable by no API role at all.
revoke all on function public.admin_user_directory_expected(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_user_directory_sync_profile()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_user_directory_sync_auth()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_user_directory_assert_complete()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_user_directory_where(text, text, text, text)
  from public, anon, authenticated, service_role;

-- Read and maintenance: service_role only (the server checks the caller's platform role first).
revoke all on function public.admin_list_users(
  integer, text, text, text, text, text, timestamptz, text, uuid
) from public, anon, authenticated;
revoke all on function public.admin_count_users(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_user_stats() from public, anon, authenticated;
revoke all on function public.admin_user_directory_status() from public, anon, authenticated;
revoke all on function public.admin_user_directory_backfill_step(integer)
  from public, anon, authenticated;
revoke all on function public.admin_user_directory_check(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.admin_user_directory_repair(uuid, integer)
  from public, anon, authenticated;

grant execute on function public.admin_list_users(
  integer, text, text, text, text, text, timestamptz, text, uuid
) to service_role;
grant execute on function public.admin_count_users(text, text, text, text) to service_role;
grant execute on function public.admin_user_stats() to service_role;
grant execute on function public.admin_user_directory_status() to service_role;
grant execute on function public.admin_user_directory_backfill_step(integer) to service_role;
grant execute on function public.admin_user_directory_check(uuid, integer) to service_role;
grant execute on function public.admin_user_directory_repair(uuid, integer) to service_role;

commit;
