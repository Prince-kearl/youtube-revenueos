-- Lets a creator generate one short link per destination automatically when AI Lab writes a
-- description, instead of manually creating each one on the Link Tracking page (see
-- api.tracking-links.ensure.ts). The unique constraint is what makes that safe to call on every
-- "Generate" click: re-generating reuses the same link per (video, destination) instead of
-- creating duplicates. Postgres treats each null video_id as distinct from every other null, so
-- general-purpose links with no video attached are unaffected.
alter table public.tracking_links
  add constraint tracking_links_video_destination_unique unique (video_id, destination_id);

-- Custom domain for short links (e.g. go.mybrand.com instead of the default app host). Verified
-- via a real DNS CNAME lookup server-side (see api.workspace.domain.ts) — this only records what
-- the workspace configured and whether that DNS check has ever passed. Actually routing traffic
-- on the domain still requires the creator to add it in their hosting provider's dashboard, which
-- this app has no API access to automate.
alter table public.workspaces
  add column if not exists custom_domain text,
  add column if not exists custom_domain_verified_at timestamptz;

create unique index if not exists workspaces_custom_domain_idx
  on public.workspaces (lower(custom_domain))
  where custom_domain is not null;
