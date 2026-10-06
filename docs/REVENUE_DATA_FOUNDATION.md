# Revenue data foundation (P0)

The stored layer every revenue feature reads from. Before this, all YouTube numbers were fetched live on each page load and nothing was kept.

## What is stored

| Table | Role |
| --- | --- |
| `channel_daily_stats` | Authoritative channel totals, one row per channel per day. |
| `video_daily_stats` | Per-video attribution layer, one row per video per day. |
| `youtube_sync_state` | Progress markers that make the sync bounded and resumable. |

Three rules that must not be broken by later work:

1. **`SUM(video_daily_stats)` is not guaranteed to equal `channel_daily_stats`.** Channel totals include videos that no longer exist; YouTube's per-video report omits them. Show the difference as "videos no longer available". Never spread it across other videos. Use `reconcileDay` in `src/lib/server/youtube-stats-sync.ts`.
2. **All YouTube revenue is estimated and revisable.** Google states it is "subject to month-end adjustment" and exposes no finalized flag. Rows are replaced on refresh; `fetched_at` is when a row was last refreshed, not when it became final.
3. **All stored YouTube revenue is USD**, requested explicitly. Column names end in `_usd`. `NULL` means revenue was unavailable; `0` means YouTube reported zero.

## Applying it

1. Run `supabase/migrations/202610060001_revenue_data_foundation.sql` in the Supabase SQL editor **before** deploying the code. It only adds tables, one nullable column and a no-op click backfill; it changes no existing data.
2. Deploy.
3. The existing daily cron (`/api/youtube/sync`) now also runs one bounded batch of the new sync. Nothing else needs configuring.

If the code is deployed before the migration, the existing sync keeps working and the new step reports a failure in its `revenueData` result until the migration is applied.

## How the sync works

One invocation does a bounded amount of work per channel (`requestBudget`, default 60 Google requests) and records where it stopped. Channels are taken least-recently-run first.

1. **Catalogue.** First run and then weekly: page through the whole uploads playlist, then mark videos not seen as `deleted` (rows and history are kept). Other runs: read from the newest page and stop at the first page with nothing new.
2. **Channel totals.** One request per 365 days with `dimensions=day`.
3. **Per-video rows.** Known video ids in batches of 50, using `dimensions=day,video` with an id filter. Each batch is checked against per-video view totals; a video that does not match, or the whole batch if Google rejects the query, is re-fetched with the documented one-video query.
4. **Refresh windows.** Ordinary run: last 7 days. Every 7 days: last 62 days, to absorb revenue adjustments. First run: up to 1,095 days. All are settings in `DEFAULT_STATS_SYNC_CONFIG`.

To run more often than daily, schedule `GET /api/youtube/stats-sync` with the `CRON_SECRET` bearer header. `STATS_SYNC_TIME_BUDGET_MS` (default 40000) sets how long one invocation keeps working.

`npx tsx scripts/verify-stats-sync.ts <connection id>` runs the real sync against the real YouTube API with an in-memory store and prints what would be stored. It writes nothing.

## Verified API behavior (2026-10-06)

- The unfiltered per-video report is capped at 200 rows, cannot be paged (`startIndex=201` is rejected), and deleted videos use up its slots. It is never used for ingestion.
- A video id filter accepts up to 500 ids; 501 is rejected. Batch size is 50 because the number of rows one response can carry could not be established on a small channel.
- `dimensions=day,video` works with an id filter but is not in Google's published report list, hence the verification and fallback.
- Watch minutes are rounded per day and do not sum to the period total, so verification compares views only.
- Data lags about 3 days.
- `currency` defaults to USD; some codes are rejected (`GHS`).
- Revenue for an unmonetized channel is returned as `0`, not as missing.

## Impressions and CTR: not active

These exist only in the YouTube Reporting API. Jobs were created on 2026-10-06 for one channel, with its owner's approval:

| Channel | Report type | Job ID | Created (UTC) |
| --- | --- | --- | --- |
| Kearl (`UC2roMGKqF6EJq5AOTrCHOqQ`) | `channel_reach_basic_a1` | `de7dac6c-9585-4d34-8924-d4f1bdaf876f` | 2026-10-06 16:07:58 |
| Kearl (`UC2roMGKqF6EJq5AOTrCHOqQ`) | `channel_basic_a3` | `1123ba61-2aeb-4e93-af0b-6a05fe91b369` | 2026-10-06 16:07:58 |

No jobs exist for any other connected channel.

`src/lib/server/youtube-reporting.ts` contains job, listing, download and parsing code written from Google's documentation. It has **no code that writes to the database**, and `video_daily_stats.impressions` / `impression_ctr` stay `NULL`.

Before enabling ingestion, with a real report file (available up to 48 hours after job creation):

1. Download it and compare the header row with `REACH_REPORT_COLUMNS`.
2. Confirm the date format and that the day matches the same Pacific-time day in `video_daily_stats`.
3. Confirm video ids match the catalogue.
4. Establish whether CTR is a 0–1 fraction or a 0–100 percentage.
5. Confirm a revised report has the same start and end time with a later `createTime`.
6. Run `parseReachReportCsv` on the real file and adapt it if the file differs.
7. Only then add the write path, behind `YOUTUBE_REPORTING_INGESTION_ENABLED=true`.

## Click attribution

`/r/:slug` now copies the link's video, that video's channel, and the link's campaign onto each click. Previously those columns were never written. The migration backfills existing clicks from their own link only, filling empty columns and overwriting nothing; the table held zero rows when checked.

## Not done here

Lead, deal and opt-in attribution; sales integrations; revenue rollups; dashboard changes; alerts; AI revenue context; multi-workspace; pricing. Video content type (Short, live) is not stored; it can be read reliably from the API with a `creatorContentType` filter when needed.
