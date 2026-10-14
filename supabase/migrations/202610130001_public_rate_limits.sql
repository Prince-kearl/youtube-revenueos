-- Rate-limit counters for the public (unauthenticated) endpoints: lead-magnet opt-in and view,
-- support contact, referral click and the tracked-link redirect. See
-- src/lib/server/rate-limit.ts for the rules; this file is only the counter.
--
-- Safe to apply before the application code that uses it (nothing calls it until then), and safe
-- to re-run. It changes no existing table, function, policy or privilege.
--
-- Who can reach it: the service role, through the two functions below, and nobody else.
--   * The table has row-level security enabled and NO policies, and every table privilege is
--     revoked from the API roles — including the service role, so the functions are the only
--     path to it.
--   * PostgreSQL grants EXECUTE on a new function to PUBLIC by default. That is revoked here, in
--     the same transaction that creates the functions, so they are never callable through the
--     public API, even for an instant.
--   * The functions are SECURITY DEFINER with an empty search_path and schema-qualified names;
--     their SQL is fixed and their arguments are only ever used as values.
--
-- What it stores: a bucket key (a label plus keyed hashes — never an IP address, an email or any
-- other personal value), the start of the window, a hit count and an expiry time.
--
-- NOTE for later migrations: dropping and re-creating either function restores EXECUTE to
-- PUBLIC. `create or replace` keeps the privileges set here.

begin;

create table if not exists public.rate_limit_buckets (
  bucket_key   text        not null check (char_length(bucket_key) between 1 and 200),
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits >= 0),
  expires_at   timestamptz not null,
  primary key (bucket_key, window_start)
);

create index if not exists rate_limit_buckets_expires_idx
  on public.rate_limit_buckets (expires_at);

alter table public.rate_limit_buckets enable row level security;

revoke all on table public.rate_limit_buckets from public, anon, authenticated, service_role;

-- Counts one hit against `p_key` in the current fixed window of `p_window_seconds`, and reports
-- whether the bucket is still within `p_limit` (true) or over it (false).
--
-- Atomic: a single INSERT ... ON CONFLICT DO UPDATE. Concurrent callers for the same bucket
-- queue on its row, so every caller gets a distinct count and none is lost, however many server
-- instances are calling.
create or replace function public.consume_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 200 then
    raise exception 'invalid rate limit key' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit window' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 1000000 then
    raise exception 'invalid rate limit' using errcode = '22023';
  end if;

  v_window := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_buckets as b (bucket_key, window_start, hits, expires_at)
  values (
    p_key,
    v_window,
    1,
    v_window + pg_catalog.make_interval(secs => p_window_seconds * 2)
  )
  on conflict (bucket_key, window_start)
  -- Saturates far below the integer maximum, so the counter can never overflow.
  do update set hits = case when b.hits >= 1000000000 then b.hits else b.hits + 1 end
  returning b.hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

-- Deletes at most `p_max_rows` expired buckets and returns how many it deleted. Bounded, and it
-- skips rows another transaction holds, so it never waits on live traffic.
create or replace function public.purge_rate_limit_buckets(p_max_rows integer default 5000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_max_rows is null or p_max_rows not between 1 and 50000 then
    raise exception 'invalid purge size' using errcode = '22023';
  end if;

  with doomed as (
    select bucket_key, window_start
    from public.rate_limit_buckets
    where expires_at < pg_catalog.now()
    order by expires_at
    limit p_max_rows
    for update skip locked
  )
  delete from public.rate_limit_buckets b
  using doomed d
  where b.bucket_key = d.bucket_key and b.window_start = d.window_start;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.purge_rate_limit_buckets(integer)
  from public, anon, authenticated;

grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.purge_rate_limit_buckets(integer) to service_role;

commit;
