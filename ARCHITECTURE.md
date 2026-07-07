# Architecture & Next Steps

This document analyzes the current repository and recommends the next course of action to evolve this UI prototype into an MVP for the YouTube-Themed AI Product Design Platform.

## Current architecture (summary)
- Frontend: React + TypeScript, built with Vite.
- Routing: TanStack Router under `src/routes` (file-based routes).
- Components: Custom UI primitives in `src/components` with Radix usage.
- Styling: Tailwind + CSS variables (`src/styles.css`) controlling theme tokens.
- Charts: Recharts with a `Chart` wrapper (`src/components/ui/chart.tsx`).
- Data: `src/lib/data.ts` contains mock datasets used across pages.
- Server: `server.ts` and `start.ts` exist (Nitro-compatible server builds present in the repo scripts/build outputs).

## Observations
- The project is a strong visual shell and playground for UI/UX work — a good foundation for an AI design tool front-end.
- Key interactive pages (dashboard, analytics, brand-deals) already exist and demonstrate data binding and components.
- Recent work fixed theme tokens, chart palette, and responsive overflow issues — UX polish is underway.

## Gaps vs target product
To become an AI product design platform, this repo needs backend services and features not yet present:
- Prompt orchestration & LLM integration (OpenAI/Anthropic/etc.)
- Long-running job processing (image parsing, multi-stage design generation)
- Storage for user projects, assets (images, exports)
- Authentication + multi-tenant/project model
- Export/Handoff integration (Figma, codegen, GitHub sync)
- Project/version management and collaboration features

## Recommended tech decisions
- Keep the current frontend stack (React + Vite + TypeScript + TanStack Router).
- Backend: Node.js + TypeScript using the existing Nitro setup for edge compatibility.
- LLM + multimodal: adopt a hosted LLM provider (OpenAI, Anthropic, or Azure) and use an orchestration layer:
  - Worker queue: Redis + BullMQ (or a managed jobs service)
  - Storage: S3-compatible (AWS S3 / Cloudflare R2)
  - DB: PostgreSQL (with Prisma) for projects, users, versions
- Auth: Use Clerk or Auth0 for quick SaaS-ready auth + social logins.
- API contracts: REST endpoints with request/response validation using `zod`.
- CI/CD: GitHub Actions to run lint, tests, build and deploy to chosen platform (Cloudflare Workers, Vercel, or Nitro prebuilt).

## Component & data flow mapping
- UI Input (Prompts & Uploads) -> Frontend form -> API `POST /api/generate` -> Job queued
- Worker consumes job -> calls LLMs / image processors -> writes artifacts to S3 and DB
- Worker updates job status -> Frontend polls or subscribes via WebSocket / SSE
- Completed artifacts available for review and export (Figma, code, assets)

## Minimum Viable Product (MVP) recommendation
Core features for first delivery (3–6 sprints):
1. Project creation and simple auth
2. Prompt-based idea generation (text-only LLM output -> UI preview)
3. Upload references + basic image parsing
4. Automated wireframe output (templated components) with edit UI
5. Export to JSON + basic frontend code scaffold
6. Background worker + job queue to handle generation

## Immediate next course of action (implementable now)
1. Add documentation (README + ARCHITECTURE) — Done.
2. Add ISSUE / PR templates + CI workflow skeleton.
3. Scaffold a backend API route `POST /api/generate` that enqueues jobs (mock implementation).
4. Add a simple worker script that processes jobs (mock): simulates generation and saves mock artifacts to `./storage` or a temp S3 bucket.
5. Implement a basic Projects data model (Postgres/Prisma schema skeleton) and a local persistence fallback (JSON) for early dev.
6. Create UI pages for project creation and a simple prompt editor (form + history list).

## Short-term roadmap (next 4 weeks)
- Week 1: Docs, CI, issue templates, basic auth + projects scaffold
- Week 2: `POST /api/generate` + worker queue (mock) + storage path
- Week 3: LLM integration (token-driven), file uploads, image parsing pipeline
- Week 4: Wireframe generation UI, preview, and export endpoints

## Suggested immediate tickets (high priority)
- `docs/README.md` (done) and `ARCHITECTURE.md` (done)
- Add `.github/ISSUE_TEMPLATE/feature_request.md` and `bug_report.md`
- Add `.github/workflows/ci.yml` to run `npm ci`, `npm run lint`, `npm run build`
- Create `src/server/api/generate.ts` (mock enqueue)
- Create `worker/processor.ts` (mock job processor)

## Contribution & governance
- Use feature branches named `feature/<short-desc>` and PRs against `main`.
- Run ESLint/Prettier in CI and require PR reviews.

---

If you want, I can implement the top-priority engineering pieces now:
- Create ISSUE/PR templates and a CI workflow, or
- Scaffold the `POST /api/generate` API + worker mock and a basic `Projects` UI.

Which should I start with?