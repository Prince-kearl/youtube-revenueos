-- Executive Dashboard growth charts at scale, step 2 of 2: the index behind "Subscription Growth".
-- /api/admin/dashboard/growth counts subscriptions in the deployment's Stripe mode that are active
-- or trialing, by created_at. The index holds exactly those rows (its predicate is the query's
-- status filter), keyed by mode then creation time, so each count is a short index-only range scan.
--
-- CREATE INDEX CONCURRENTLY builds the index without blocking Stripe webhooks writing
-- subscriptions. It cannot run inside a transaction, so this file holds exactly one statement and
-- must be run ON ITS OWN in the Supabase SQL editor (never pasted together with anything else).
--
-- If it is interrupted it can leave an INVALID index behind; check with
--   select indexrelid::regclass, indisvalid from pg_index
--   where indexrelid = 'public.subscriptions_growth_idx'::regclass;
-- and, if indisvalid is false, run `drop index concurrently public.subscriptions_growth_idx;`
-- (also on its own) before running this file again.
create index concurrently if not exists subscriptions_growth_idx
  on public.subscriptions (livemode, created_at)
  where status in ('active', 'trialing');
