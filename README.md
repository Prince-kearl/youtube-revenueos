# Tubify (YouTube Revenue OS)

Tubify turns a YouTube channel into a sales engine. It connects a creator's channel and uses the channel data to track revenue, drive viewers to offers, capture leads, and manage brand deals.

## Stack

- **App:** TanStack Start (React 19, TypeScript), Vite, file-based routes in `src/routes`
- **UI:** Tailwind CSS v4, Radix / shadcn primitives (`src/components/ui`), Recharts
- **Backend:** TanStack Start server routes (`src/routes/api.*.ts`) running on Nitro
- **Data & auth:** Supabase (Postgres + RLS + Auth); migrations in `supabase/migrations`
- **Integrations:** Google/YouTube OAuth and Data/Analytics APIs, Stripe, Kit, Instagram, Google Analytics
- **AI:** OpenRouter, OpenAI or Anthropic, selected with `AI_PROVIDER`
- **Hosting:** Vercel (`nitro.preset: "vercel"` in `vite.config.ts`, with a daily cron in `vercel.json`)

## Project layout

```
src/
  routes/            Pages (*.tsx) and API endpoints (api.*.ts), file-based routing
  components/        App components; ui/ = design-system primitives, admin/ = admin console
  lib/               Client-side helpers, stores, Supabase browser client, demo data
  lib/server/        Server-only code (env, Supabase service client, OAuth, crypto, billing, AI)
  server.ts          SSR entry (error normalisation)
  start.ts           TanStack Start instance
  routeTree.gen.ts   Auto-generated — do not edit
supabase/migrations/ Ordered SQL migrations (apply in filename order)
tests/               node:test suites (run with tsx)
docs/                Design notes for specific subsystems
public/              Static assets served as-is
```

## Getting started

```bash
npm ci
cp .env.example .env     # fill in real values
npm run dev              # http://localhost:8080
```

To browse every page with realistic demo data and no backend, set `VITE_DEMO_MODE=true`.

## Scripts

| Script              | Purpose                             |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Start the dev server                |
| `npm run build`     | Production build (`.vercel/output`) |
| `npm run preview`   | Preview the production build        |
| `npm run typecheck` | TypeScript check                    |
| `npm run lint`      | ESLint + Prettier check             |
| `npm run format`    | Format everything with Prettier     |
| `npm test`          | Run all test suites in `tests/`     |

## Deploying

1. Apply `supabase/migrations/*` to the production Supabase project in order.
2. Set every variable in `.env.example` in the Vercel project. Use production values: `APP_URL`, `GOOGLE_REDIRECT_URI` and the other `*_REDIRECT_URI` values must match the production domain and the URIs registered with each OAuth provider.
3. Set `CRON_SECRET`, or the daily YouTube sync is rejected.
4. Make sure `VITE_DEMO_MODE` is unset or `false`.

This repo is connected to [Lovable](https://lovable.dev). Do not force-push or rewrite pushed history on `main` (see `AGENTS.md`).

More detail: [ARCHITECTURE.md](ARCHITECTURE.md), [docs/YOUTUBE_AUTH_RELIABILITY.md](docs/YOUTUBE_AUTH_RELIABILITY.md).
