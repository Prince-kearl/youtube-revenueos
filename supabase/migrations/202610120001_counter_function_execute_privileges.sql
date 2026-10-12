-- The two public counters are SECURITY DEFINER, and PostgreSQL grants EXECUTE on a new function
-- to PUBLIC, so anyone could call them through the API and raise a tracked link's click counter
-- or a lead magnet's view counter. Only the application's own server calls them, with the
-- service role (routes/r.$slug.ts and routes/api.freebies.public.ts).
--
-- Safe to apply at any time and to re-run: it needs no application change, it changes no data
-- and no function definition, and every statement is a no-op when already in effect.
--
-- NOTE for later migrations: dropping and re-creating either function restores EXECUTE to
-- PUBLIC. `create or replace` keeps these privileges.

REVOKE EXECUTE ON FUNCTION public.increment_link_clicks(uuid)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.increment_lead_magnet_views(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_link_clicks(uuid)
TO service_role;

GRANT EXECUTE ON FUNCTION public.increment_lead_magnet_views(uuid)
TO service_role;
