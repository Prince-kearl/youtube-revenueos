import { createFileRoute } from "@tanstack/react-router";
import { requireMinimumRole } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { listAllAuthUsers } from "@/lib/server/auth-users";

// Same documented constant as api.youtube.quota.ts — Google's default YouTube Data API v3 quota
// per project, not something queryable per-request.
const YOUTUBE_DAILY_QUOTA_UNITS = 10_000;
const MONTHS_BACK = 6;
const DAYS_BACK = 14;

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

function monthKey(d: Date) {
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}
function startOfMonthsAgo(n: number) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}
function dayKey(d: Date) {
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}
function startOfDaysAgo(n: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// Buckets a list of ISO timestamps into cumulative monthly counts for the last MONTHS_BACK
// months — "cumulative" because we only have creation dates, not point-in-time snapshots, so a
// running total is the only honest trend line (no fabricated ups/downs from churn we can't see).
function cumulativeByMonth(timestamps: string[]): { month: string; count: number }[] {
  const buckets: { start: Date; month: string }[] = [];
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const start = startOfMonthsAgo(i);
    buckets.push({ start, month: monthKey(start) });
  }
  return buckets.map((bucket, i) => {
    const cutoff = i < buckets.length - 1 ? buckets[i + 1].start : new Date();
    const count = timestamps.filter((t) => new Date(t) < cutoff).length;
    return { month: bucket.month, count };
  });
}

export const Route = createFileRoute("/api/admin/dashboard")({
  server: {
    handlers: {
      // Every number here is a real aggregate over real tables — see the comment above each
      // section for exactly which table/column it comes from and why. Nothing on this page is
      // fabricated; a metric with no real backing (creator earnings, storage quota, error rate,
      // active-session count, device/geo analytics) was dropped instead of faked.
      GET: async ({ request }) => {
        try {
          // Console access (Superadmin/Owner), not "view_dashboard" — every role has that
          // permission for their own personal dashboard, but this reads across every user.
          await requireMinimumRole(request, "owner");
          const service = createServiceSupabaseClient();
          const startOfToday = startOfDaysAgo(0);
          const startOf30DaysAgo = startOfDaysAgo(30);

          const [
            profilesResult,
            projectsCount,
            videosResult,
            subscriptionsResult,
            planPricesResult,
            quotaEventsResult,
            openTicketsCount,
            linkClicksCount,
          ] = await Promise.all([
            service.from("profiles").select("id, role, location, created_at"),
            service.from("projects").select("id", { count: "exact", head: true }),
            service.from("videos").select("id, content_analysis"),
            service
              .from("subscriptions")
              .select("id, status, stripe_price_id, billing_interval, created_at")
              .in("status", ["active", "trialing"]),
            service.from("plan_prices").select("stripe_price_id, amount_cents"),
            service
              .from("youtube_quota_events")
              .select("quota_units, created_at")
              .eq("succeeded", true)
              .gte("created_at", startOfDaysAgo(DAYS_BACK - 1).toISOString()),
            service
              .from("support_tickets")
              .select("id", { count: "exact", head: true })
              .eq("status", "Open"),
            service.from("link_click_events").select("id", { count: "exact", head: true }),
          ]);

          const profiles = profilesResult.data ?? [];
          const videos = videosResult.data ?? [];
          const activeSubs = subscriptionsResult.data ?? [];
          const priceByStripeId = new Map(
            (planPricesResult.data ?? []).map((p) => [p.stripe_price_id, p.amount_cents as number]),
          );
          const quotaEvents = quotaEventsResult.data ?? [];

          const authUsers = await listAllAuthUsers(service);
          const dau = [...authUsers.values()].filter(
            (u) => u.last_sign_in_at && new Date(u.last_sign_in_at) >= startOfToday,
          ).length;
          const mau = [...authUsers.values()].filter(
            (u) => u.last_sign_in_at && new Date(u.last_sign_in_at) >= startOf30DaysAgo,
          ).length;

          const mrrCents = activeSubs.reduce((sum, sub) => {
            const cents = priceByStripeId.get(sub.stripe_price_id as string) ?? 0;
            return sum + (sub.billing_interval === "year" ? cents / 12 : cents);
          }, 0);

          const roleCounts = new Map<string, number>();
          for (const p of profiles) roleCounts.set(p.role, (roleCounts.get(p.role) ?? 0) + 1);

          const locationCounts = new Map<string, number>();
          for (const p of profiles) {
            const key = (p.location as string | null)?.trim() || "Not set";
            locationCounts.set(key, (locationCounts.get(key) ?? 0) + 1);
          }
          const topLocations = [...locationCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([label, count]) => ({
              label,
              pct: profiles.length ? Math.round((count / profiles.length) * 100) : 0,
            }));

          const quotaByDay: { day: string; units: number }[] = [];
          for (let i = DAYS_BACK - 1; i >= 0; i--) {
            const start = startOfDaysAgo(i);
            const end = startOfDaysAgo(i - 1);
            const units = quotaEvents
              .filter((e) => new Date(e.created_at) >= start && new Date(e.created_at) < end)
              .reduce((sum, e) => sum + (e.quota_units as number), 0);
            quotaByDay.push({ day: dayKey(start), units });
          }
          const quotaToday = quotaByDay[quotaByDay.length - 1]?.units ?? 0;

          return json({
            data: {
              totalUsers: profiles.length,
              newUsersToday: profiles.filter((p) => new Date(p.created_at) >= startOfToday).length,
              dau,
              mau,
              totalProjects: projectsCount.count ?? 0,
              totalVideos: videos.length,
              videosAnalyzed: videos.filter((v) => v.content_analysis != null).length,
              mrrCents: Math.round(mrrCents),
              activeSubscriptions: activeSubs.length,
              youtubeQuotaToday: quotaToday,
              youtubeQuotaMax: YOUTUBE_DAILY_QUOTA_UNITS,
              openSupportTickets: openTicketsCount.count ?? 0,
              totalLinkClicks: linkClicksCount.count ?? 0,
              userGrowth: cumulativeByMonth(profiles.map((p) => p.created_at as string)),
              subscriptionGrowth: cumulativeByMonth(
                (subscriptionsResult.data ?? []).map((s) => s.created_at as string),
              ),
              quotaByDay,
              roleDistribution: [...roleCounts.entries()].map(([label, count]) => ({
                label,
                pct: profiles.length ? Math.round((count / profiles.length) * 100) : 0,
              })),
              topLocations,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
