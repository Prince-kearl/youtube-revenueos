import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken } from "@/lib/server/youtube-tokens";
import { fetchPublicYoutubeVideoById, queryYoutubeAnalytics } from "@/lib/server/google-oauth";
import {
  generateVideoAnalysis,
  getActiveProviderInfo,
  ANALYZE_VIDEO_PROMPT_VERSION,
  type AnalyzeVideoInput,
  type AnalyzeVideoResult,
} from "@/lib/server/ai-generation";
import {
  resolvePlanTier,
  checkAiRateLimit,
  AiRateLimitError,
  recordAiUsage,
  hashForCacheKey,
  getCachedAiResult,
  setCachedAiResult,
} from "@/lib/server/ai-usage";

const TASK = "analyze_video";

// Exported so tests can exercise validation directly without a full HTTP request/response cycle.
export const inputSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  channelId: z.string().uuid().optional(),
  // Both optional client-supplied overrides — legitimate user input (the page already lets a
  // creator paste/edit a transcript and edit the description before analyzing), never trusted as
  // a substitute for the real YouTube-sourced title/metrics, which are always re-fetched below.
  transcript: z.string().trim().max(30_000).nullable().optional(),
  description: z.string().trim().max(12_000).nullable().optional(),
});

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

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

function safeReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  return error.message.match(/:(\d{3})(?::|$)/)?.[1] ?? error.message.split(":")[0].slice(0, 80);
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type PerformanceSummary = AnalyzeVideoInput["performance"];

const EMPTY_PERFORMANCE: Omit<PerformanceSummary, "views" | "likes" | "comments"> = {
  watchTimeMinutes: null,
  averageViewDurationSeconds: null,
  averageViewPercentage: null,
  estimatedRevenueUsd: null,
};

// Only called for a video on the caller's own connected channel — the YouTube Analytics API is
// private/owner-only, unlike the public snippet data fetchPublicYoutubeVideoById returns. A
// single summary-level report (no day-by-day breakdown, no traffic-source/demographic
// granularity — see the code comment in the analyze-video route for why) is enough context for
// the AI without duplicating api.youtube.video.ts's full multi-report dashboard logic. Revenue is
// requested alongside the activity metrics first, and only kept if YouTube actually returned it —
// same "never fabricate a metric YouTube didn't grant" fallback pattern as api.youtube.video.ts.
async function fetchPerformanceSummary(
  accessToken: string,
  channelYoutubeId: string,
  videoId: string,
): Promise<Omit<PerformanceSummary, "views" | "likes" | "comments">> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  const range = {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
  };
  const activityMetrics = [
    "estimatedMinutesWatched",
    "averageViewDuration",
    "averageViewPercentage",
  ];

  try {
    const payload = (await queryYoutubeAnalytics(accessToken, {
      channelId: channelYoutubeId,
      ...range,
      metrics: [...activityMetrics, "estimatedRevenue"],
      filters: `video==${videoId}`,
    })) as { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<string | number>> };
    const names = (payload.columnHeaders ?? []).map((h) => h.name);
    const row = payload.rows?.[0];
    if (!row) return EMPTY_PERFORMANCE;
    const get = (metric: string) => numberOrNull(row[names.indexOf(metric)]);
    return {
      watchTimeMinutes: get("estimatedMinutesWatched"),
      averageViewDurationSeconds: get("averageViewDuration"),
      averageViewPercentage: get("averageViewPercentage"),
      estimatedRevenueUsd: names.includes("estimatedRevenue") ? get("estimatedRevenue") : null,
    };
  } catch {
    // Revenue metric can be rejected outright for accounts without monetization access — retry
    // once without it rather than losing the activity metrics too.
    try {
      const payload = (await queryYoutubeAnalytics(accessToken, {
        channelId: channelYoutubeId,
        ...range,
        metrics: activityMetrics,
        filters: `video==${videoId}`,
      })) as { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<string | number>> };
      const names = (payload.columnHeaders ?? []).map((h) => h.name);
      const row = payload.rows?.[0];
      if (!row) return EMPTY_PERFORMANCE;
      const get = (metric: string) => numberOrNull(row[names.indexOf(metric)]);
      return {
        watchTimeMinutes: get("estimatedMinutesWatched"),
        averageViewDurationSeconds: get("averageViewDuration"),
        averageViewPercentage: get("averageViewPercentage"),
        estimatedRevenueUsd: null,
      };
    } catch {
      return EMPTY_PERFORMANCE;
    }
  }
}

export const Route = createFileRoute("/api/ai/analyze-video")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          // 1-2. Authentication + authorization. There is no separate feature flag for this page
          // today (matches /api/videos/analyze-content and /api/videos/optimize, the two AI
          // routes this page already calls) — any signed-in Tubify user may analyze a public
          // video; per-plan limits below are the actual usage control, not an all-or-nothing gate.
          const { client, user } = await requireSessionUser(request);
          // 3. Validate input.
          const input = inputSchema.parse(await parseJson(request));

          const service = createServiceSupabaseClient();

          // 4-5. Never accept an OAuth token from the client — resolve the caller's own connected
          // channel/token server-side, exactly like /api/youtube/analyze-video does. The initial
          // lookup MUST go through the session-scoped `client` (RLS-filtered to this user's own
          // channels) rather than the service-role client — otherwise a caller could pass any
          // channelId and read another user's channel/token metadata.
          let channelQuery = client
            .from("youtube_channels")
            .select("id, youtube_channel_id, channel_name, channel_handle, subscriber_count")
            .order("connected_at", { ascending: false });
          if (input.channelId) channelQuery = channelQuery.eq("id", input.channelId);
          const { data: channel, error: channelError } = await channelQuery.limit(1).maybeSingle();
          if (channelError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const { data: secretRow, error: secretError } = await service
            .from("youtube_channels")
            .select("id, access_token_ciphertext, refresh_token_ciphertext, token_expiry")
            .eq("id", channel.id)
            .single();
          if (secretError || !secretRow) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const accessToken = await getValidAccessToken(service, secretRow);

          const video = await fetchPublicYoutubeVideoById(accessToken, input.videoId);
          if (video.privacyStatus !== "public") {
            return json({ error: "YOUTUBE_VIDEO_NOT_PUBLIC" }, { status: 422 });
          }
          const isConnectedChannelVideo = video.channelId === channel.youtube_channel_id;

          const { data: savedVideo } = isConnectedChannelVideo
            ? await client
                .from("videos")
                .select("id")
                .eq("channel_id", channel.id)
                .eq("youtube_video_id", input.videoId)
                .maybeSingle()
            : { data: null };
          const { data: savedTranscript } = savedVideo
            ? await client
                .from("transcripts")
                .select("transcript")
                .eq("video_id", savedVideo.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle()
            : { data: null };

          // 6. Build the AI input from verified application data — transcript/description accept
          // a legitimate user override (see inputSchema comment); everything else is server-truth.
          const transcript =
            input.transcript?.trim() || savedTranscript?.transcript?.trim() || null;
          const description = input.description?.trim() || video.description?.trim() || null;

          const performanceSummary = isConnectedChannelVideo
            ? await fetchPerformanceSummary(accessToken, channel.youtube_channel_id, input.videoId)
            : EMPTY_PERFORMANCE;

          const aiInput: AnalyzeVideoInput = {
            video: {
              videoId: input.videoId,
              title: video.title,
              description,
              publishedAt: video.publishedAt,
              durationSeconds: video.durationSeconds,
              channelName: channel.channel_name,
            },
            transcript,
            performance: {
              views: video.views,
              likes: video.likes,
              comments: video.comments,
              ...performanceSummary,
            },
            channel: {
              subscriberCount: channel.subscriber_count ?? null,
            },
          };

          // Resolved once, from the same provider-selection logic generateVideoAnalysis itself
          // uses — never duplicated/hard-coded here, and lets us fail fast with a clean 503
          // before spending a rate-limit slot or a cache lookup on a request that can't succeed.
          const providerInfo = getActiveProviderInfo();
          if (!providerInfo) return json({ error: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503 });
          const { provider, model } = providerInfo;

          // 7. Usage limits, checked before touching the provider at all.
          const tier = await resolvePlanTier(service, user.id);
          try {
            await checkAiRateLimit(service, user.id, TASK, tier);
          } catch (rateLimitError) {
            if (rateLimitError instanceof AiRateLimitError) {
              return json(
                { error: "RATE_LIMIT_EXCEEDED", window: rateLimitError.window },
                { status: 429 },
              );
            }
            throw rateLimitError;
          }

          // 8. Cache check — keyed on every input that affects the result, plus prompt version
          // and model, so a prompt/model change or a materially different input never serves a
          // stale-shaped or stale-content cached analysis.
          const cacheKey = await hashForCacheKey([
            TASK,
            ANALYZE_VIDEO_PROMPT_VERSION,
            provider,
            model,
            input.videoId,
            transcript,
            description,
            video.title,
            JSON.stringify(aiInput.performance),
          ]);
          const cached = await getCachedAiResult<AnalyzeVideoResult>(service, cacheKey);
          if (cached) {
            // A cache hit never calls the provider, so there's no real per-call cost/tokens to
            // record — recordAiUsage still logs the request (cacheHit: true) so usage history and
            // rate-limit counts reflect every request that reached this far, not just paid ones.
            await recordAiUsage(service, {
              userId: user.id,
              provider,
              model,
              task: TASK,
              cacheHit: true,
            });
            return json({ data: cached, cached: true });
          }

          // 9-10. Call the provider and validate its response.
          const { result: analysis, usage } = await generateVideoAnalysis(aiInput);

          // 11-12. Real token/cost usage when the provider reported it (OpenRouter does); null
          // otherwise, which the table allows rather than a fabricated estimate.
          await recordAiUsage(service, {
            userId: user.id,
            provider,
            model,
            task: TASK,
            cacheHit: false,
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            estimatedCost: usage?.costUsd ?? null,
          });
          await setCachedAiResult(service, cacheKey, TASK, analysis);

          // 13. Structured JSON to the client.
          return json({ data: analysis, cached: false });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (error instanceof Error && error.message === "AI_PROVIDER_NOT_CONFIGURED") {
            return json({ error: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503 });
          }
          if (error instanceof Error && error.message.startsWith("AI_PROVIDER_FAILED:")) {
            const isRateLimited = error.message.endsWith(":429");
            return json(
              { error: isRateLimited ? "AI_PROVIDER_RATE_LIMITED" : "AI_PROVIDER_FAILED" },
              { status: isRateLimited ? 429 : 502 },
            );
          }
          if (error instanceof Error && error.message === "YOUTUBE_VIDEO_NOT_FOUND") {
            return json({ error: "YOUTUBE_VIDEO_NOT_FOUND" }, { status: 404 });
          }
          console.error("AI video analysis request failed", { reason: safeReason(error) });
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
