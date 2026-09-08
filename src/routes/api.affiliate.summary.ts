import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { activePriceFor, listPlans } from "@/lib/server/billing-plans";

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

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthlySeries(dates: string[]): Array<{ month: string; count: number }> {
  const map = new Map<string, number>();
  for (const date of dates) map.set(monthKey(date), (map.get(monthKey(date)) ?? 0) + 1);
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
}

// Aligns two independently-bucketed monthly count series onto the same set of months (union),
// filling any month missing from one side with 0 — needed since a month can have clicks with zero
// signups (or, in principle, the reverse) and both series must share identical x-axis points to
// compute a meaningful per-month ratio.
function alignedRatioSeries(
  numerator: Array<{ month: string; count: number }>,
  denominator: Array<{ month: string; count: number }>,
): Array<{ month: string; ratePct: number | null }> {
  const months = [...new Set([...numerator, ...denominator].map((r) => r.month))].sort();
  const numByMonth = new Map(numerator.map((r) => [r.month, r.count]));
  const denByMonth = new Map(denominator.map((r) => [r.month, r.count]));
  return months.map((month) => {
    const den = denByMonth.get(month) ?? 0;
    const num = numByMonth.get(month) ?? 0;
    return { month, ratePct: den > 0 ? (num / den) * 100 : null };
  });
}

export const Route = createFileRoute("/api/affiliate/summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);

          // Lazily backfill referral_code for accounts created before this column existed —
          // handle_new_user only sets it for signups going forward.
          const { data: profile } = await client
            .from("profiles")
            .select("referral_code")
            .eq("id", user.id)
            .maybeSingle();
          let referralCode = profile?.referral_code ?? null;
          if (!referralCode) {
            referralCode = user.id.replace(/-/g, "").slice(0, 10);
            await client.from("profiles").update({ referral_code: referralCode }).eq("id", user.id);
          }

          const [
            { data: clickRows },
            { data: signupRows },
            { data: commissions },
            { data: recentSignups },
          ] = await Promise.all([
            client.from("referral_clicks").select("created_at").eq("referrer_id", user.id),
            client.from("profiles").select("id, created_at").eq("referred_by", user.id),
            client
              .from("referral_commissions")
              .select("id, referred_user_id, amount_cents, commission_cents, status, created_at")
              .eq("referrer_id", user.id)
              .order("created_at", { ascending: false })
              .limit(500),
            // The display list: every real signup via this referral link, not just ones that
            // paid — a signup that hasn't converted yet is real too and belongs in the list as
            // "Pending", the same distinction the page has always drawn.
            client
              .from("profiles")
              .select("id, name, email, created_at")
              .eq("referred_by", user.id)
              .order("created_at", { ascending: false })
              .limit(20),
          ]);

          const rows = commissions ?? [];
          const totalEarningsCents = rows.reduce(
            (sum, r) => sum + (r.commission_cents as number),
            0,
          );
          const pendingPayoutCents = rows
            .filter((r) => r.status === "pending")
            .reduce((sum, r) => sum + (r.commission_cents as number), 0);
          const referredClientIds = [...new Set(rows.map((r) => r.referred_user_id as string))];
          const commissionsByUser = new Map<string, number>();
          for (const row of rows) {
            const uid = row.referred_user_id as string;
            commissionsByUser.set(
              uid,
              (commissionsByUser.get(uid) ?? 0) + (row.commission_cents as number),
            );
          }

          const monthlyMap = new Map<string, number>();
          const monthlyPendingMap = new Map<string, number>();
          for (const row of rows) {
            const key = monthKey(row.created_at as string);
            monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + (row.commission_cents as number));
            if (row.status === "pending") {
              monthlyPendingMap.set(
                key,
                (monthlyPendingMap.get(key) ?? 0) + (row.commission_cents as number),
              );
            }
          }
          const monthlyCommission = [...monthlyMap.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, cents]) => ({ month, cents }));
          const monthlyPending = [...monthlyPendingMap.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, cents]) => ({ month, cents }));

          const totalClicks = (clickRows ?? []).length;
          const totalSignups = (signupRows ?? []).length;
          const clicksByMonth = monthlySeries((clickRows ?? []).map((r) => r.created_at as string));
          const signupsByMonth = monthlySeries(
            (signupRows ?? []).map((r) => r.created_at as string),
          );
          const conversionRateByMonth = alignedRatioSeries(signupsByMonth, clicksByMonth);

          // A referred user's "conversion month" is when they first generated a commission — used
          // to build a real month-over-month new-paying-client series, distinct from when they
          // merely signed up.
          const firstCommissionByUser = new Map<string, string>();
          for (const row of rows) {
            const uid = row.referred_user_id as string;
            const existing = firstCommissionByUser.get(uid);
            const createdAt = row.created_at as string;
            if (!existing || createdAt < existing) firstCommissionByUser.set(uid, createdAt);
          }
          const referredClientsByMonth = monthlySeries([...firstCommissionByUser.values()]);

          // subscriptions.plan_id is the plan slug, not a plans.id uuid (see the webhook's
          // upsertSubscriptionRow) — fetch the current plan catalog once and key off slug.
          const allPlans = await listPlans(client);
          const planBySlug = new Map(allPlans.map((p) => [p.slug, p]));
          // A subscriber's actual price is whatever Stripe price their row references, which can
          // be an older, now-retired price if a Superadmin has since changed this plan's pricing —
          // matched against ALL of the plan's prices (not just the currently active one) so MRR
          // reflects what they're really being charged, not today's list price.
          function priceCentsFor(planSlug: string, stripePriceId: string | null): number {
            const plan = planBySlug.get(planSlug);
            if (!plan) return 0;
            const byStripeId = stripePriceId
              ? plan.prices.find((p) => p.stripePriceId === stripePriceId)
              : undefined;
            const monthly = byStripeId ?? activePriceFor(plan, "month");
            return monthly?.amountCents ?? 0;
          }
          function annualToMonthlyCents(planSlug: string, stripePriceId: string | null): number {
            const plan = planBySlug.get(planSlug);
            if (!plan) return 0;
            const byStripeId = stripePriceId
              ? plan.prices.find((p) => p.stripePriceId === stripePriceId)
              : undefined;
            const annual = byStripeId ?? activePriceFor(plan, "year");
            return annual ? Math.round(annual.amountCents / 12) : 0;
          }

          let activeSubscriptions: Array<{
            planId: string;
            name: string;
            count: number;
            mrrCents: number;
          }> = [];
          if (referredClientIds.length > 0) {
            const { data: subs } = await client
              .from("subscriptions")
              .select("user_id, plan_id, billing_interval, stripe_price_id, status, created_at")
              .in("user_id", referredClientIds)
              .in("status", ["active", "trialing"])
              .order("created_at", { ascending: false });
            const latestByUser = new Map<
              string,
              { plan_id: string; billing_interval: string; stripe_price_id: string | null }
            >();
            for (const sub of subs ?? []) {
              if (!latestByUser.has(sub.user_id as string)) {
                latestByUser.set(sub.user_id as string, {
                  plan_id: sub.plan_id as string,
                  billing_interval: sub.billing_interval as string,
                  stripe_price_id: sub.stripe_price_id as string | null,
                });
              }
            }
            const grouped = new Map<string, { count: number; mrrCents: number }>();
            for (const { plan_id, billing_interval, stripe_price_id } of latestByUser.values()) {
              const mrr =
                billing_interval === "year"
                  ? annualToMonthlyCents(plan_id, stripe_price_id)
                  : priceCentsFor(plan_id, stripe_price_id);
              const entry = grouped.get(plan_id) ?? { count: 0, mrrCents: 0 };
              entry.count += 1;
              entry.mrrCents += mrr;
              grouped.set(plan_id, entry);
            }
            activeSubscriptions = [...grouped.entries()].map(([planId, v]) => ({
              planId,
              name: planBySlug.get(planId)?.name ?? planId,
              ...v,
            }));
          }

          const signups = recentSignups ?? [];
          let planByUser = new Map<string, string>();
          if (signups.length > 0) {
            const { data: signupSubs } = await client
              .from("subscriptions")
              .select("user_id, plan_id, status, created_at")
              .in(
                "user_id",
                signups.map((s) => s.id),
              )
              .in("status", ["active", "trialing"])
              .order("created_at", { ascending: false });
            planByUser = new Map();
            for (const sub of signupSubs ?? []) {
              const uid = sub.user_id as string;
              if (!planByUser.has(uid)) {
                const slug = sub.plan_id as string;
                planByUser.set(uid, planBySlug.get(slug)?.name ?? slug);
              }
            }
          }

          // A signup counts as "Converted" once they've generated at least one real commission —
          // even if their subscription later lapsed, the commission they generated while paying
          // was real and stays on the record, unlike flipping the label back to "Pending".
          const recentReferrals = signups.map((signup) => {
            const commissionCents = commissionsByUser.get(signup.id as string) ?? 0;
            return {
              id: signup.id,
              client: signup.name ?? signup.email ?? "Unknown",
              plan: planByUser.get(signup.id as string) ?? null,
              commissionCents,
              date: signup.created_at,
              status: commissionCents > 0 ? "converted" : "pending",
            };
          });

          const origin = new URL(request.url).origin;
          return json({
            data: {
              referralCode,
              referralLink: `${origin}/signup?ref=${referralCode}`,
              totalEarningsCents,
              pendingPayoutCents,
              referredClients: referredClientIds.length,
              totalSignups,
              totalClicks,
              conversionRatePct: totalClicks > 0 ? (totalSignups / totalClicks) * 100 : null,
              monthlyCommission,
              monthlyPending,
              referredClientsByMonth,
              conversionRateByMonth,
              activeSubscriptions,
              recentReferrals,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          console.error("Affiliate summary failed");
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
