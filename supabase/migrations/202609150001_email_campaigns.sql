-- Real backing for the Email page's campaign composer, reusing the existing `campaigns` table
-- (created in the initial schema, referenced by leads.campaign_id, but never actually written to
-- by any route) rather than creating a duplicate. There is no real sending pipeline yet — see the
-- scoping decision on this task — so campaigns are composed and saved for later; audience size is
-- computed live from real leads with an email on file at read time, never stored/stale here.
alter table public.campaigns add column if not exists subject text;
alter table public.campaigns add column if not exists body text;
