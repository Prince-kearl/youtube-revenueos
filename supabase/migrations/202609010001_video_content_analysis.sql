-- AI-generated content analysis (summary/topics/audience/searchIntent/strengths/opportunities)
-- from the Analyze Video workspace, saved alongside the video so it doesn't have to be
-- regenerated every visit. Nullable: most videos won't have been analyzed yet.
alter table public.videos add column if not exists content_analysis jsonb;
