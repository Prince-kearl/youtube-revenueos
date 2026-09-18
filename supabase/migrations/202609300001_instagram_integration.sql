-- Adds Instagram to the same generic external-integration OAuth flow already used for Google
-- Analytics/Stripe/Kit (see src/lib/server/provider-oauth.ts, api.integrations.ts, and the new
-- api.integrations.instagram.callback.ts) — same "shows as not-configured until real
-- INSTAGRAM_CLIENT_ID/SECRET/REDIRECT_URI env vars are set" degrade-gracefully behavior as those.
alter table public.connected_integrations
  drop constraint if exists connected_integrations_provider_check;

alter table public.connected_integrations
  add constraint connected_integrations_provider_check
  check (provider in ('google_analytics', 'stripe', 'kit', 'instagram'));
