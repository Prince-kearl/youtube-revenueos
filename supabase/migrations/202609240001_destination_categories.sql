-- Splits destinations into "conversion" (course/newsletter/coaching/lead-magnet/affiliate links —
-- the only kind that existed before) and "social" (a creator's own social profiles: Instagram,
-- TikTok, X, Facebook, YouTube, LinkedIn) so the Destinations page can group them into two
-- visually separate sections instead of one undifferentiated grid.
alter table public.destinations
  add column if not exists category text not null default 'conversion'
    check (category in ('conversion', 'social'));
