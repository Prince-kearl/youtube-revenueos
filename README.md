# YouTube-Themed AI Product Design Platform

A prototype UI (YouTube-inspired theme) for an AI-powered product design platform that generates wireframes, high-fidelity UIs, UX flows, and developer handoff assets from prompts or uploaded references.

This repository contains a front-end demo and UI components used as the visual shell and playground for the product.

## Quick summary
- Framework: React + TypeScript
- Bundler: Vite
- Router: TanStack Router
- Charts: Recharts
- Styling: Tailwind + CSS variables
- UI primitives: Radix + custom components in `src/components`

## Project structure
- `src/` — application source
  - `components/` — shared UI components and primitives
  - `routes/` — route pages and views (dashboard, analytics, brand-deals, etc.)
  - `lib/` — shared data, utils, mock data
  - `server.ts`, `start.ts` — app server/entry (Nitro integration)
- `public/` — static assets

## Local development
Install dependencies and run dev server:

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
npm run preview
```

Useful scripts (from `package.json`):
- `dev` — start Vite dev server
- `build` — build production bundle
- `preview` — preview the production build
- `lint` — run ESLint
- `format` — run Prettier

## Where to start exploring
- UI shell and layout: `src/components/DashboardLayout.tsx`
- Global styles and theme tokens: `src/styles.css`
- Charts and chart wrapper: `src/components/ui/chart.tsx`
- Mock/shared data: `src/lib/data.ts`
- Example pages: `src/routes/dashboard.tsx`, `src/routes/analytics.tsx`, `src/routes/brand-deals.tsx`

## Current status & recent changes
- Visual rebrand applied (YouTube-inspired theme token updates).
- Chart palette updated to use distinct cool pastel colors.
- Brand Deals board made responsive to remove horizontal scrolling.

## Recommended next steps (short-term)
1. Add `ARCHITECTURE.md` (analysis, stack, roadmap) — added.
2. Scaffold backend AI API and job queue (worker + Redis) for prompt processing.
3. Implement file upload + storage (S3-compatible) for reference assets.
4. Add CI (lint/build) + ISSUE/PR templates.

## How to contribute
- Open issues for bugs or feature requests.
- Use the `main` branch for stable work; create feature branches for PRs.

---

For design and product details, see `ARCHITECTURE.md`.
