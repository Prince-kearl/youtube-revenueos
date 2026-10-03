# Architecture

## Request flow

```
Browser ──► TanStack Start (SSR pages, src/routes/*.tsx)
        └─► Server routes (src/routes/api.*.ts) ──► src/lib/server/* ──► Supabase / Google / Stripe / AI provider
```

- **Pages** are React components rendered by TanStack Start. They fetch data from the app's own `/api/*` endpoints.
- **API endpoints** are TanStack Start server routes. Each file name maps to a URL: `api.youtube.sync.ts` → `/api/youtube/sync`. They validate input with `zod` and call helpers in `src/lib/server`.
- **`src/lib/server`** holds server-only code. It must never be imported from client components.
  - `env.ts`: reads runtime env (`getServerEnv` / `requireServerEnv`)
  - `supabase.ts`, `supabase-ssr.ts`: service-role client and cookie-based user session client
  - `google-oauth.ts`, `youtube-tokens.ts`, `youtube-connection-resolution.ts`: YouTube OAuth, encrypted token storage (`crypto.ts`, `TOKEN_ENCRYPTION_KEY`), multi-channel connection handling
  - `provider-oauth.ts`: Stripe Connect, Kit, Instagram and Google Analytics integrations
  - `stripe.ts`, `billing-plans.ts`: subscriptions and webhook handling
  - `ai-generation.ts`, `ai-usage.ts`: provider-agnostic AI calls with rate limiting and caching
  - `roles.ts`, `feature-access.ts`, `workspace.ts`, `admin-audit.ts`: RBAC, feature gating, multi-tenant workspaces, audit log

## Data

Supabase Postgres is the source of truth. Row-level security is enforced per workspace. The schema is built up by the ordered files in `supabase/migrations/`; never edit a migration after it has been applied, add a new one instead.

## Background work

`vercel.json` schedules `GET /api/youtube/sync` daily at 00:00 UTC. The endpoint only runs with `Authorization: Bearer $CRON_SECRET`, which Vercel sends automatically.

## Demo mode

When `VITE_DEMO_MODE=true`, `src/lib/demo-api.ts` installs a `window.fetch` interceptor that answers `/api/*` calls with client-side demo data. Production code paths are unchanged. It is meant for local previews only.

## Deployment targets

- **Vercel** (current): `nitro: { preset: "vercel" }` in `vite.config.ts`.
- **Cloudflare Workers** (inactive): `wrangler.jsonc` is only read by the `cloudflare-module` preset.
- Moving to a plain Node host should only require changing the Nitro preset and environment variables.

## Tests

`tests/*.test.ts` use `node:test` with `tsx`, covering AI analysis and YouTube auth/connection resolution. Run them with `npm test`.
