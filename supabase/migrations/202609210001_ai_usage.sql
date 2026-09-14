-- Real backing store for AI provider usage (server-side accounting + rate limiting) and a
-- response cache for repeat/duplicate AI requests, starting with the Analyze Video feature
-- (OpenRouter). Both tables are admin/system-managed — no client-writable RLS policy is granted,
-- same pattern as admin_audit_log/plan_audit_log: all writes go through the service-role client
-- from server routes, after requireSessionUser has already authenticated the caller.

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  provider text not null,
  model text not null,
  task text not null,
  -- Token counts are nullable — not every provider/response reliably reports them.
  input_tokens integer,
  output_tokens integer,
  -- Numeric, not float, to avoid floating-point cost drift over many rows; nullable since cost
  -- isn't always computable (e.g. a free-tier model with no published per-token pricing).
  estimated_cost numeric(10, 6),
  cache_hit boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index ai_usage_user_created_idx on public.ai_usage(user_id, created_at desc);
create index ai_usage_task_created_idx on public.ai_usage(task, created_at desc);

alter table public.ai_usage enable row level security;

-- A signed-in user may see their own usage history (e.g. a future "AI usage this month" display).
-- All inserts happen server-side via the service-role client, so no insert policy is needed here.
create policy ai_usage_owner_read on public.ai_usage for select
  using (user_id = auth.uid());

-- Generic response cache, reusable by any future AI task (not just Analyze Video) — cache_key is
-- expected to be a hash incorporating every input that affects the result (task, model, prompt
-- version, and a hash of the actual content sent), computed by the calling server code, plus its
-- own expiry so a stale cache entry stops being served without a background sweep job.
create table public.ai_response_cache (
  cache_key text primary key,
  task text not null,
  result jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null
);

create index ai_response_cache_expires_idx on public.ai_response_cache(expires_at);

alter table public.ai_response_cache enable row level security;
-- No policies: this table is never read/written by a session-scoped client, only the
-- service-role client from server routes (the cached "result" may include another user's
-- analysis inputs reflected back, so it must never be directly queryable by any signed-in user).
