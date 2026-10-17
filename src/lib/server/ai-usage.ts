import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveProviderInfo } from "./ai-generation";
import { createServiceSupabaseClient } from "./supabase";
import { aiMonthStart, subscriptionRequired, type WorkspacePlan } from "./plan-access";
import { resolvePlanTier, type PlanTier } from "./subscription-tier";

// Two separate controls (Phase 4B-2):
//
//   * the plan's MONTHLY allowance of AI analyses — the limit customers buy (Starter 5, Pro 50,
//     Scale 250; lib/server/plan-access.ts). It belongs to the WORKSPACE: every AI request by any
//     of its members, through any AI route, draws on the same allowance (reserveAiAnalysis);
//   * a short per-minute BURST limit per user and task, against double-clicks and retry loops
//     (checkAiRateLimit). It is not the allowance and resets every minute.
//
// ai_usage is the store for both: one row per request that reached the provider (cache_hit
// false) or was answered from the cache (cache_hit true, never counted against the allowance).
export const AI_LIMITS: Record<PlanTier, { perMinute: number }> = {
  free: { perMinute: 3 },
  starter: { perMinute: 5 },
  pro: { perMinute: 10 },
  scale: { perMinute: 20 },
};
// The caller's OWN subscription tier, for the burst limit (subscription-tier.ts).
export { resolvePlanTier, type PlanTier } from "./subscription-tier";

export class AiRateLimitError extends Error {
  constructor(public readonly window: "minute") {
    super(`AI_RATE_LIMITED:${window}`);
  }
}

// The burst limit. Fails OPEN when ai_usage cannot be read: it only smooths bursts — the monthly
// allowance, which fails closed, is the control that matters.
let warnedMissingTable = false;
export async function checkAiRateLimit(
  service: SupabaseClient,
  userId: string,
  task: string,
  tier: PlanTier,
): Promise<void> {
  const limits = AI_LIMITS[tier];
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  try {
    const { count: perMinute } = await service
      .from("ai_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("task", task)
      .gte("created_at", oneMinuteAgo);
    if ((perMinute ?? 0) >= limits.perMinute) throw new AiRateLimitError("minute");
  } catch (error) {
    if (error instanceof AiRateLimitError) throw error;
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.warn("ai_usage table unavailable — the AI burst limit is not enforced");
    }
  }
}

export async function recordAiUsage(
  service: SupabaseClient,
  entry: {
    userId: string | null;
    provider: string;
    model: string;
    task: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    estimatedCost?: number | null;
    cacheHit?: boolean;
  },
): Promise<void> {
  try {
    await service.from("ai_usage").insert({
      user_id: entry.userId,
      provider: entry.provider,
      model: entry.model,
      task: entry.task,
      input_tokens: entry.inputTokens ?? null,
      output_tokens: entry.outputTokens ?? null,
      estimated_cost: entry.estimatedCost ?? null,
      cache_hit: entry.cacheHit ?? false,
    });
  } catch {
    // Usage tracking is best-effort — never block a real AI response over it (same convention as
    // logAdminAudit/logPlanAudit). Cache hits only: the allowance goes through reserveAiAnalysis.
  }
}

// ---------- the monthly allowance ----------

/**
 * The AI operations that are an "analysis": each explicit request a customer makes for an AI
 * analysis or a generated result — of a video, a channel's content, a description, a lead, a
 * project or a lead magnet. Each takes one from the plan's monthly allowance; a cached answer and
 * a failed generation take none.
 *
 * Ordinary assistant chat ("assistant_chat") is not an analysis and never counts: it has its own
 * per-minute and per-day limits instead (enforceChatLimit). Only the tasks listed here are counted,
 * so no other kind of AI request can use up — or be mistaken for — the allowance, and reserving a
 * task that is not listed is refused as a programming error rather than counted or let through.
 */
export const ANALYSIS_TASKS = [
  "analyze_video",
  "pre_publish_analysis",
  "content_analysis",
  "video_optimize",
  "lead_summary",
  "project_concept",
  "freebie_content",
] as const;
export type AnalysisTask = (typeof ANALYSIS_TASKS)[number];

export const CHAT_TASK = "assistant_chat";

/** Who is asking, resolved by the server: the caller, their workspace and its plan. */
export interface AiQuotaContext {
  userId: string;
  workspaceId: string;
  plan: WorkspacePlan;
}

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });

const QUOTA_UNAVAILABLE = () =>
  jsonResponse(
    {
      error: "AI_QUOTA_UNAVAILABLE",
      message: "We couldn't check your AI allowance. Please try again.",
    },
    503,
  );

/**
 * Takes one AI analysis from the workspace's monthly allowance, or refuses — before the provider
 * is called. Returns the usage row's id (completeAiAnalysis adds the tokens once known;
 * releaseAiAnalysis gives the analysis back if the provider fails).
 *
 * Reserve, then count: the request's own row is written FIRST, then every non-cached row of the
 * workspace's members since the start of the month (UTC, see aiMonthStart) is counted, its own
 * included. Over the allowance, its row is removed and the request refused (429
 * AI_QUOTA_EXCEEDED). Requests made at the same moment therefore can never take more than the
 * allowance between them — at worst, at the very last analysis, both are refused. Anything that
 * cannot be read or written refuses the request (503): the allowance never fails open.
 */
export async function reserveAiAnalysis(
  service: SupabaseClient,
  ctx: AiQuotaContext,
  entry: { provider: string; model: string; task: string },
  now: Date = new Date(),
): Promise<string> {
  if (!(ANALYSIS_TASKS as readonly string[]).includes(entry.task))
    throw new Error(`NOT_AN_ANALYSIS_TASK:${entry.task}`);
  if (!ctx.plan.limits) throw subscriptionRequired(ctx.plan);
  const limit: number = ctx.plan.limits.aiAnalysesPerMonth;

  const { data: members, error: membersError } = await service
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", ctx.workspaceId)
    .not("user_id", "is", null);
  if (membersError) throw QUOTA_UNAVAILABLE();
  const memberIds = [
    ...new Set([ctx.userId, ...(members ?? []).map((row) => row.user_id as string)]),
  ];

  const { data: reserved, error: reserveError } = await service
    .from("ai_usage")
    .insert({
      user_id: ctx.userId,
      provider: entry.provider,
      model: entry.model,
      task: entry.task,
      cache_hit: false,
    })
    .select("id")
    .single();
  if (reserveError || !reserved?.id) throw QUOTA_UNAVAILABLE();
  const id = reserved.id as string;

  const monthStart = aiMonthStart(now);
  const { count, error: countError } = await service
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .in("user_id", memberIds)
    .eq("cache_hit", false)
    .in("task", [...ANALYSIS_TASKS])
    .gte("created_at", monthStart.toISOString());
  if (countError || count === null) {
    await releaseAiAnalysis(service, id);
    throw QUOTA_UNAVAILABLE();
  }
  if (count > limit) {
    await releaseAiAnalysis(service, id);
    const resetsAt = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1),
    ).toISOString();
    throw jsonResponse(
      {
        error: "AI_QUOTA_EXCEEDED",
        limit,
        resetsAt,
        message: `Your plan includes ${limit} AI ${limit === 1 ? "analysis" : "analyses"} a month, and this month's are used. They reset on the 1st (UTC), or upgrade in Billing.`,
      },
      429,
    );
  }
  return id;
}

/** Records the provider's real usage on a reserved analysis. Best-effort. */
export async function completeAiAnalysis(
  service: SupabaseClient,
  id: string,
  usage: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    estimatedCost?: number | null;
  },
): Promise<void> {
  try {
    await service
      .from("ai_usage")
      .update({
        input_tokens: usage.inputTokens ?? null,
        output_tokens: usage.outputTokens ?? null,
        estimated_cost: usage.estimatedCost ?? null,
      })
      .eq("id", id);
  } catch {
    // The analysis still counts; only its token figures are missing.
  }
}

/** Gives a reserved analysis back (the provider failed, or the allowance was exceeded). */
export async function releaseAiAnalysis(service: SupabaseClient, id: string): Promise<void> {
  try {
    await service.from("ai_usage").delete().eq("id", id);
  } catch {
    // Left counted: errs on the side of the allowance, never against it.
  }
}

// One-call guard for AI routes that have no caching or token accounting of their own (everything
// except analyze-video and pre-publish analysis, which reserve and complete directly). Throws a
// Response — 429 over the burst limit or the monthly allowance, 503 when the allowance cannot be
// checked — which every route handler returns as-is. Otherwise the analysis is counted up front,
// so a burst of parallel requests cannot exceed the allowance between them. The returned handle
// gives it back when the provider then fails (`run` wraps the provider call; `release` is for a
// route that catches the failure itself): Tubify's provider failing never uses up a customer's
// allowance, while the burst limit still stops a retry loop. Does nothing when no AI provider is
// configured: the route reports that itself and nothing is spent.
export interface AiAllowance {
  /** Runs the provider call; if it throws, the analysis is given back and the error rethrown. */
  run<T>(call: () => Promise<T>): Promise<T>;
  /** Gives the analysis back (the provider failed). */
  release(): Promise<void>;
}

const NOTHING_RESERVED: AiAllowance = {
  run: (call) => call(),
  release: async () => {},
};

export async function enforceAiQuota(
  ctx: AiQuotaContext,
  task: AnalysisTask,
): Promise<AiAllowance> {
  const providerInfo = getActiveProviderInfo();
  if (!providerInfo) return NOTHING_RESERVED;
  const service = createServiceSupabaseClient();
  const tier = await resolvePlanTier(service, ctx.userId);
  try {
    await checkAiRateLimit(service, ctx.userId, task, tier);
  } catch (error) {
    if (!(error instanceof AiRateLimitError)) throw error;
    throw jsonResponse({ error: "RATE_LIMIT_EXCEEDED", window: error.window }, 429);
  }
  const id = await reserveAiAnalysis(service, ctx, {
    provider: providerInfo.provider,
    model: providerInfo.model,
    task,
  });
  const release = () => releaseAiAnalysis(service, id);
  return {
    release,
    run: async (call) => {
      try {
        return await call();
      } catch (error) {
        await release();
        throw error;
      }
    },
  };
}

// ---------- assistant chat: its own limits, never the allowance ----------

/** Chat messages a USER may send a day, by their workspace's plan (abuse and cost protection). */
export const CHAT_DAILY_LIMITS = { starter: 30, pro: 100, scale: 300 } as const;

/**
 * The limits of ordinary assistant chat: the per-minute burst limit every AI task has, and a
 * per-day cap by the workspace's plan. Neither touches the monthly analysis allowance. Each
 * message is logged in ai_usage (task "assistant_chat", which the allowance never counts) — that
 * is the usage record and the daily counter both. The handle gives a message back when the
 * provider fails. Like the burst limit, the daily cap only protects against abuse: if it cannot
 * be read it lets the message through rather than blocking chat (the allowance, which customers
 * pay for, is the control that fails closed).
 */
export async function enforceChatLimit(ctx: AiQuotaContext): Promise<AiAllowance> {
  const providerInfo = getActiveProviderInfo();
  if (!providerInfo) return NOTHING_RESERVED;
  if (!ctx.plan.plan) throw subscriptionRequired(ctx.plan);
  const service = createServiceSupabaseClient();
  try {
    await checkAiRateLimit(service, ctx.userId, CHAT_TASK, ctx.plan.plan);
  } catch (error) {
    if (!(error instanceof AiRateLimitError)) throw error;
    throw jsonResponse({ error: "RATE_LIMIT_EXCEEDED", window: error.window }, 429);
  }
  const { count, error: countError } = await service
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .eq("task", CHAT_TASK)
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString());
  const dailyLimit = CHAT_DAILY_LIMITS[ctx.plan.plan];
  if (!countError && count !== null && count >= dailyLimit)
    throw jsonResponse(
      {
        error: "CHAT_LIMIT_EXCEEDED",
        limit: dailyLimit,
        message: "You've sent a lot of messages today. Please try again tomorrow.",
      },
      429,
    );
  const { data: logged } = await service
    .from("ai_usage")
    .insert({
      user_id: ctx.userId,
      provider: providerInfo.provider,
      model: providerInfo.model,
      task: CHAT_TASK,
      cache_hit: false,
    })
    .select("id")
    .single();
  const id = (logged?.id as string | undefined) ?? null;
  const release = async () => {
    if (id) await releaseAiAnalysis(service, id);
  };
  return {
    release,
    run: async (call) => {
      try {
        return await call();
      } catch (error) {
        await release();
        throw error;
      }
    },
  };
}

// SHA-256 via Web Crypto (not node:crypto) — same runtime-portability reasoning as crypto.ts's
// token encryption, so this module works identically on Vercel's Node runtime, Cloudflare
// Workers, and Vite dev.
export async function hashForCacheKey(parts: Array<string | number | null>): Promise<string> {
  const raw = parts.map((p) => p ?? "").join("\u0000");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const DEFAULT_CACHE_TTL_SECONDS = 6 * 3600; // 6 hours — long enough to absorb re-runs/duplicate
// submissions of an unchanged video, short enough that a creator who edits their
// title/description/transcript and re-analyzes soon after gets a fresh result well within a day.

export async function getCachedAiResult<T>(
  service: SupabaseClient,
  cacheKey: string,
): Promise<T | null> {
  try {
    const { data } = await service
      .from("ai_response_cache")
      .select("result, expires_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (!data) return null;
    if (new Date(data.expires_at).getTime() <= Date.now()) return null;
    return data.result as T;
  } catch {
    return null;
  }
}

export async function setCachedAiResult(
  service: SupabaseClient,
  cacheKey: string,
  task: string,
  result: unknown,
  ttlSeconds: number = DEFAULT_CACHE_TTL_SECONDS,
): Promise<void> {
  try {
    await service.from("ai_response_cache").upsert({
      cache_key: cacheKey,
      task,
      result,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    });
  } catch {
    // Caching is an optimization, never a requirement for the request to succeed.
  }
}
