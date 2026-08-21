# YouTube Revenue OS Backend Feature Map

## Current state

The existing app is a TanStack Start/React frontend deployed for the Cloudflare Workers preset. Domain data is currently seeded in `src/lib/data.ts` and persisted in browser localStorage through `src/lib/local-store.ts`. The existing server routes are limited to mock generation and global design settings.

No production authentication, database, OAuth, external API, queue, billing, or email integration is currently wired.

## Frontend to backend map

| Existing surface | Current source of truth | Backend contract |
| --- | --- | --- |
| Dashboard, analytics, reports | `src/lib/data.ts` | `/api/analytics`, `/api/reports`; YouTube and platform metric aggregation |
| Videos, add video, projects | local stores and seeded data | `/api/youtube/videos`, `/api/videos`, `/api/projects` |
| Destinations | `useDestinations()` | `/api/destinations` CRUD |
| Link tracking | `useLinks()` | `/api/links` CRUD and `/r/{tracking_code}` redirect event ingestion |
| Leads and comments | `useLeads()`, `useCommentRules()` | `/api/leads`, `/api/comments`, `/api/rules`; compliant reply workflow |
| Brand deals | `useDeals()` | `/api/deals` CRUD, stage transitions, search/filter/sort |
| Email campaigns | campaign store and email route | `/api/campaigns`, `/api/email`; Resend-backed delivery jobs |
| Notifications | `useNotifications()` | `/api/notifications` read/update/delete |
| Settings/profile/team | local stores | Supabase Auth, profiles, memberships, settings APIs |
| AI Lab/freebie | `src/lib/llm.ts`, mock generation | `/api/ai/descriptions`, `/api/ai/insights`; queued Anthropic jobs |
| Billing/affiliate | UI mocks | `/api/billing`, Stripe Checkout and signed webhook processing |
| Admin console | local admin stores/audit logger | protected admin APIs, audit events, quota and job dashboards |

## Implementation order

1. Supabase schema, Auth session middleware, and RLS.
2. Shared API response/error helpers and Zod request schemas.
3. Core CRUD: destinations, links, campaigns, leads, deals, rules, notifications.
4. Tracking redirect and attribution event ingestion.
5. Google OAuth, encrypted token storage, YouTube sync and quota accounting.
6. Analytics service with freshness metadata and measured-vs-attributed dimensions.
7. Anthropic service and Redis-backed idempotent jobs.
8. Stripe, Resend, reporting, and admin observability.
9. Replace local-store reads/writes module by module with API-backed query/mutation state.

## Non-goals for MVP

- `youtubepartner` scope
- Instagram cold-DM automation
- unofficial YouTube transcript extraction
- GA4, Meta Conversions API, and automatic Skool attribution
- heavy Puppeteer/Chromium work inside a serverless request

## Deployment decision

Cloudflare Workers can serve the request/response API and tracking redirect, but BullMQ workers and scheduled synchronization should run as a separate Node-compatible worker process (for example Hetzner) using the same Supabase and Upstash contracts. OAuth and service credentials remain server-side.
