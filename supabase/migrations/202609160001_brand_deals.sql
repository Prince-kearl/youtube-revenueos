-- Real backing for the Brand Deal Board, reusing the existing `deals` table (created in the
-- initial schema, referenced by leads/campaigns, but never actually written to by any route)
-- rather than creating a duplicate. Adds the few UI fields the real table didn't have yet —
-- progress is deliberately NOT one of them: it's derived from `stage` in the app (a fixed
-- mapping) rather than tracked as a separate value that could drift out of sync with it.
alter table public.deals add column if not exists contact_name text;
alter table public.deals add column if not exists tag text;
alter table public.deals add column if not exists next_action text;
