import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getWorkspaceContext } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { workspaceFileExists } from "@/lib/server/storage";
import {
  generatePrePublishVideoAnalysis,
  sanitizeChapters,
  PRE_PUBLISH_ANALYSIS_PROMPT_VERSION,
  getActiveProviderInfo,
  type PrePublishAnalysisInput,
  type PrePublishAnalysisResult,
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

const TASK = "pre_publish_analysis";

const inputSchema = z.object({ id: z.string().uuid() });

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

export const Route = createFileRoute("/api/pre-publish-videos/analyze")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Declared here (not inside the try) only so the catch block below can still record a
        // "failed" status against the right row/workspace — every one is assigned on the try
        // block's first lines, matching this codebase's usual getWorkspaceContext-inside-try
        // convention (see api.deals.ts, api.destinations.ts, etc.) so an auth/workspace failure
        // still returns this route's own JSON error shape instead of an unhandled rejection.
        let service: SupabaseClient | null = null;
        let workspaceId: string | null = null;
        let rowId: string | null = null;
        try {
          const ctx = await getWorkspaceContext(request);
          const { client, user } = ctx;
          workspaceId = ctx.workspaceId;
          service = createServiceSupabaseClient();
          const input = inputSchema.parse(await parseJson(request));
          rowId = input.id;

          const { data: row, error: rowError } = await client
            .from("pre_publish_videos")
            .select(
              "id, workspace_id, channel_id, file_path, file_name, duration_seconds, topic, audience, tone, goal, transcript, status",
            )
            .eq("id", input.id)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (rowError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!row) return json({ error: "NOT_FOUND" }, { status: 404 });

          // Confirms the browser really finished the direct-to-storage upload before this route
          // trusts the client's "ready to analyze" signal and spends AI usage on it.
          const { exists } = await workspaceFileExists(row.file_path);
          if (!exists) return json({ error: "UPLOAD_NOT_FOUND" }, { status: 409 });

          const providerInfo = getActiveProviderInfo();
          if (!providerInfo) return json({ error: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503 });
          const { provider, model } = providerInfo;

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

          let channel: { name: string | null; subscriberCount: number | null } | null = null;
          if (row.channel_id) {
            const { data: channelRow } = await client
              .from("youtube_channels")
              .select("channel_name, subscriber_count")
              .eq("id", row.channel_id)
              .eq("workspace_id", workspaceId)
              .maybeSingle();
            if (channelRow) {
              channel = {
                name: channelRow.channel_name,
                subscriberCount: channelRow.subscriber_count,
              };
            }
          }

          await client
            .from("pre_publish_videos")
            .update({ status: "analyzing", error: null, updated_at: new Date().toISOString() })
            .eq("id", row.id);

          const aiInput: PrePublishAnalysisInput = {
            video: { fileName: row.file_name, durationSeconds: row.duration_seconds },
            transcript: row.transcript,
            context: {
              topic: row.topic,
              audience: row.audience,
              tone: row.tone,
              goal: row.goal,
            },
            channel,
          };

          const cacheKey = await hashForCacheKey([
            TASK,
            PRE_PUBLISH_ANALYSIS_PROMPT_VERSION,
            provider,
            model,
            row.id,
            row.transcript,
            row.topic,
            row.audience,
            row.tone,
            row.goal,
            channel?.name ?? null,
          ]);

          let result: PrePublishAnalysisResult;
          let cached = false;
          const cachedResult = await getCachedAiResult<PrePublishAnalysisResult>(service, cacheKey);
          if (cachedResult) {
            result = cachedResult;
            cached = true;
            await recordAiUsage(service, {
              userId: user.id,
              provider,
              model,
              task: TASK,
              cacheHit: true,
            });
          } else {
            const generation = await generatePrePublishVideoAnalysis(aiInput);
            result = generation.result;
            await recordAiUsage(service, {
              userId: user.id,
              provider,
              model,
              task: TASK,
              cacheHit: false,
              inputTokens: generation.usage?.inputTokens ?? null,
              outputTokens: generation.usage?.outputTokens ?? null,
              estimatedCost: generation.usage?.costUsd ?? null,
            });
            await setCachedAiResult(service, cacheKey, TASK, result);
          }

          const sanitized = {
            ...result,
            chapters: sanitizeChapters(result.chapters, row.duration_seconds),
          };

          const { data: updated, error: updateError } = await client
            .from("pre_publish_videos")
            .update({
              status: "completed",
              analysis_result: sanitized,
              analysis_model: `${provider}:${model}`,
              error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", row.id)
            .select(
              "id, workspace_id, channel_id, file_name, file_size, mime_type, duration_seconds, width, height, status, topic, audience, tone, goal, transcript, analysis_result, analysis_model, error, created_at, updated_at",
            )
            .single();
          if (updateError) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          return json({ data: updated, cached });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          const message = error instanceof Error ? error.message : "";
          const failureCode =
            message === "AI_PROVIDER_NOT_CONFIGURED"
              ? "AI_PROVIDER_NOT_CONFIGURED"
              : message.startsWith("AI_PROVIDER_FAILED:")
                ? message.endsWith(":429")
                  ? "AI_PROVIDER_RATE_LIMITED"
                  : "AI_PROVIDER_FAILED"
                : "AI_ANALYSIS_FAILED";
          // Best-effort — never let a failure recording the failure mask the real error response.
          if (rowId && service && workspaceId) {
            try {
              await service
                .from("pre_publish_videos")
                .update({
                  status: "failed",
                  error: failureCode,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", rowId)
                .eq("workspace_id", workspaceId);
            } catch {
              // Swallowed — the response below still reports the real failure to the client.
            }
          }
          console.error("Pre-publish video analysis failed", { reason: failureCode });
          return json(
            { error: failureCode },
            { status: failureCode === "AI_PROVIDER_NOT_CONFIGURED" ? 503 : 502 },
          );
        }
      },
    },
  },
});
