import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireMinimumRole } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { trustedLivemode } from "@/lib/server/stripe-mode";

// One growth series for the Executive Dashboard's charts, for the range the admin picked:
// user sign-ups (profiles.created_at) or subscriptions (active/trialing subscriptions in the
// deployment's trusted Stripe mode, by created_at — the same population as the dashboard's
// subscription totals; no mode means no subscriptions).
//
// Each point is a bucket (a day for 30 days, a week for 90 days, a month for longer) with the
// running total at its end and how many were added in it. Every read is a COUNT bounded by
// created_at — never a row listing — at most MAX_BUCKETS + 1 of them: one for everything before
// the range and one per bucket, each served by the created_at indexes (migrations
// 202610190001/2) as an index-only range scan.
// Counts only: no money, no identities. Same access as the dashboard: Superadmin/Owner.

const RANGES = ["30d", "90d", "6m", "12m", "all"] as const;
type Range = (typeof RANGES)[number];
const MAX_BUCKETS = 36;

const querySchema = z
  .object({
    metric: z.enum(["users", "subscriptions"]),
    range: z.enum(RANGES),
  })
  .strict();

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

type Bucket = { label: string; start: Date; end: Date };

const dayLabel = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const monthLabel = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const utcMonth = (d: Date, add = 0) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));

/** Buckets in UTC, oldest first; the last one ends now. `earliest` is only used for "all". */
export function growthBuckets(range: Range, now: Date, earliest: Date | null): Bucket[] {
  const buckets: Bucket[] = [];
  if (range === "30d" || range === "90d") {
    const step = range === "30d" ? 1 : 7;
    const count = range === "30d" ? 30 : 13;
    const today = utcDay(now);
    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(today.getTime() - i * step * 86_400_000);
      buckets.push({
        label: dayLabel(start),
        start,
        end: new Date(start.getTime() + step * 86_400_000),
      });
    }
  } else if (range === "all") {
    // From the earliest record's month to now, in steps of whole months wide enough to keep the
    // series to MAX_BUCKETS points.
    const first = utcMonth(earliest && earliest < now ? earliest : now);
    const span =
      (now.getUTCFullYear() - first.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - first.getUTCMonth()) +
      1;
    const step = Math.ceil(span / MAX_BUCKETS);
    for (let start = first; start <= now; start = utcMonth(start, step))
      buckets.push({ label: monthLabel(start), start, end: utcMonth(start, step) });
  } else {
    const months = range === "6m" ? 6 : 12;
    for (let i = months - 1; i >= 0; i--) {
      const start = utcMonth(now, -i);
      buckets.push({ label: monthLabel(start), start, end: utcMonth(start, 1) });
    }
  }
  buckets[buckets.length - 1].end = now;
  return buckets;
}

class QueryFailed extends Error {}

export const Route = createFileRoute("/api/admin/dashboard/growth")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          await requireMinimumRole(request, "owner");
          const parsed = querySchema.safeParse(
            Object.fromEntries(new URL(request.url).searchParams),
          );
          if (!parsed.success) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const { metric, range } = parsed.data;

          const livemode = trustedLivemode();
          const now = new Date();
          if (metric === "subscriptions" && livemode === null) {
            const buckets = growthBuckets(range, now, null);
            return json({
              data: {
                metric,
                range,
                startTotal: 0,
                points: buckets.map((b) => ({ label: b.label, total: 0, added: 0 })),
              },
            });
          }

          const service = createServiceSupabaseClient();
          // The population being counted; subscriptions are scoped exactly as the dashboard's.
          const rows = (columns: string, options?: { count: "exact"; head: true }) =>
            metric === "users"
              ? service.from("profiles").select(columns, options)
              : service
                  .from("subscriptions")
                  .select(columns, options)
                  .eq("livemode", livemode)
                  .in("status", ["active", "trialing"]);

          let earliest: Date | null = null;
          if (range === "all") {
            const first = await rows("created_at")
              .order("created_at", { ascending: true })
              .limit(1)
              .maybeSingle();
            if (first.error) throw new QueryFailed();
            const createdAt = (first.data as { created_at?: string } | null)?.created_at;
            earliest = createdAt ? new Date(createdAt) : null;
          }
          const buckets = growthBuckets(range, now, earliest);

          // One count of everything before the range, then one count per bucket bounded on both
          // sides, so the table's index is walked about once in total — not once per point.
          const counted = async (query: ReturnType<typeof rows>): Promise<number> => {
            const { count, error } = await query;
            if (error || count === null) throw new QueryFailed();
            return count;
          };
          const head = { count: "exact", head: true } as const;
          const [startTotal, ...added] = await Promise.all([
            counted(rows("id", head).lt("created_at", buckets[0].start.toISOString())),
            ...buckets.map((b) =>
              counted(
                rows("id", head)
                  .gte("created_at", b.start.toISOString())
                  .lt("created_at", b.end.toISOString()),
              ),
            ),
          ]);

          let total = startTotal;
          return json({
            data: {
              metric,
              range,
              startTotal,
              points: buckets.map((b, i) => {
                total += added[i];
                return { label: b.label, total, added: added[i] };
              }),
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof QueryFailed)
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
