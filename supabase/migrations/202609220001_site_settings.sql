-- Real backing store for the Superadmin Customization/Design Studio settings
-- (src/lib/stores.ts useSiteContent), replacing the Cloudflare KV mechanism in
-- src/routes/api.settings.ts that is inert on this project's actual Vercel deployment (see
-- wrangler.jsonc: "INERT while the app targets Vercel") — every Customization change was
-- silently failing to persist anywhere shared, so it only ever applied in the browser that made
-- it, never propagating to other devices/browsers/users as intended.
--
-- Single row (id fixed to 'default') rather than a real table of many rows — there is exactly
-- one site-wide configuration, not a per-user or per-record setting.
create table public.site_settings (
  id text primary key default 'default',
  content jsonb not null,
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger site_settings_updated_at before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.site_settings enable row level security;

-- Every visitor (including a signed-out one on the public landing page) needs to read branding/
-- theme settings to render the app consistently — this is not sensitive data. Only the
-- service-role client (after the API route verifies Superadmin/Owner access) may write.
create policy site_settings_public_read on public.site_settings for select using (true);
