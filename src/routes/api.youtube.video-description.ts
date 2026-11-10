import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { z } from "zod";

import { requireWorkspaceFeature, type WorkspaceContext } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  getValidAccessToken,
  isYoutubeTokenRefreshReauthError,
  normalizeYoutubeConnectionRow,
} from "@/lib/server/youtube-tokens";
import {
  fetchYoutubeVideoSnippet,
  updateYoutubeVideoDescription,
  YoutubeInsufficientScopeError,
  YoutubeQuotaExceededError,
  YoutubeVideoUpdateRefusedError,
} from "@/lib/server/google-oauth";
import { quotaDayStart } from "@/lib/server/youtube-quota";
import {
  canPublishDescription,
  DESCRIPTION_PUBLISH_DAILY_LIMIT,
  descriptionProblem,
} from "@/lib/youtube-description";

// Publishing a description from the AI Description Lab straight to YouTube, and undoing it.
//
//   GET  ?channelId&videoId          whether an undo is available for that video (no YouTube call)
//   POST { action: "publish", channelId, videoId, description, expectedDescription }
//   POST { action: "undo",    channelId, videoId, expectedDescription }
//
// Who: workspace owners, managers and editors, with the ai_lab feature and a paid plan; the
// channel must be one of the caller's workspace's connected channels and the video must be on
// that channel at YouTube. Anything else is the same 404 as a video that does not exist.
//
// Safety:
//   - videos.update replaces the whole snippet, so the current snippet is read first and its
//     title, category, tags and languages are sent back unchanged (google-oauth.ts);
//   - `expectedDescription` is what the page last saw on YouTube. If YouTube now holds something
//     else (edited in Studio meanwhile), nothing is written: 409 DESCRIPTION_CHANGED_ON_YOUTUBE;
//   - before writing, the description being replaced is recorded in audit_events (who, when,
//     which video), which is also what an undo restores. If that record cannot be written,
//     nothing is sent to YouTube;
//   - at most DESCRIPTION_PUBLISH_DAILY_LIMIT publishes and undos per workspace per quota day.
//
// Responses never include another workspace's data; descriptions are the caller's own channel's.

const RESOURCE_TYPE = "youtube_video_description";
const PUBLISHED = "youtube_description.published";
const RESTORED = "youtube_description.restored";

const channelIdSchema = z.string().uuid();
const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
// Wider than YouTube's limit on purpose: what YouTube holds today is compared, not validated.
const seenSchema = z.string().max(20_000);

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("publish"),
      channelId: channelIdSchema,
      videoId: videoIdSchema,
      description: z.string().max(10_000),
      expectedDescription: seenSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("undo"),
      channelId: channelIdSchema,
      videoId: videoIdSchema,
      expectedDescription: seenSchema,
    })
    .strict(),
]);

type AuditRow = {
  id: number;
  action: string;
  created_at: string;
  metadata: {
    workspaceId?: string;
    videoId?: string;
    previousDescription?: string;
    newDescriptionSha256?: string;
  } | null;
};

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

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
// YouTube stores descriptions with \n line endings; a browser textarea may hand back \r\n.
const normalize = (text: string) => text.replace(/\r\n?/g, "\n");

function safeReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  return error.message.match(/:(\d{3})(?::|$)/)?.[1] ?? error.message.split(":")[0].slice(0, 80);
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

/** The caller's workspace's connected channel with this id, or null. */
async function workspaceChannel(ctx: WorkspaceContext, channelId: string) {
  const { data, error } = await ctx.client
    .from("youtube_channels")
    .select("id, youtube_channel_id")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", channelId)
    .not("connection_id", "is", null)
    .maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  return (data as { id: string; youtube_channel_id: string } | null) ?? null;
}

type Service = ReturnType<typeof createServiceSupabaseClient>;

/** The latest publish/undo record for this video of this workspace's channel. */
async function latestEvent(
  service: Service,
  workspaceId: string,
  channelId: string,
  videoId: string,
): Promise<AuditRow | null> {
  const { data, error } = await service
    .from("audit_events")
    .select("id, action, metadata, created_at")
    .eq("resource_type", RESOURCE_TYPE)
    .eq("resource_id", channelId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200);
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  return (
    ((data ?? []) as AuditRow[]).find(
      (row) => row.metadata?.videoId === videoId && row.metadata?.workspaceId === workspaceId,
    ) ?? null
  );
}

async function usedToday(service: Service, ctx: WorkspaceContext): Promise<number> {
  const { data: channels, error } = await ctx.client
    .from("youtube_channels")
    .select("id")
    .eq("workspace_id", ctx.workspaceId);
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  const ids = (channels ?? []).map((c) => c.id as string);
  if (!ids.length) return 0;
  const { data, error: countError } = await service
    .from("audit_events")
    .select("id, metadata")
    .eq("resource_type", RESOURCE_TYPE)
    .in("resource_id", ids)
    .gte("created_at", quotaDayStart().toISOString())
    .limit(DESCRIPTION_PUBLISH_DAILY_LIMIT * 5);
  if (countError) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  return ((data ?? []) as Pick<AuditRow, "metadata">[]).filter(
    (row) => row.metadata?.workspaceId === ctx.workspaceId,
  ).length;
}

async function accessTokenFor(service: Service, channelId: string): Promise<string> {
  const { data: secretRow, error } = await service
    .from("youtube_channels")
    .select(
      "id, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
    )
    .eq("id", channelId)
    .single();
  const connection = normalizeYoutubeConnectionRow(secretRow?.connection);
  if (error || !connection) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  return getValidAccessToken(service, connection);
}

function failure(error: unknown, action: string): Response {
  if (error instanceof Response) return error;
  if (error instanceof z.ZodError) return json({ error: "VALIDATION_ERROR" }, { status: 422 });
  if (isYoutubeTokenRefreshReauthError(error))
    return json({ error: "YOUTUBE_REAUTH_REQUIRED" }, { status: 401 });
  if (error instanceof YoutubeQuotaExceededError)
    return json({ error: "YOUTUBE_QUOTA_EXCEEDED" }, { status: 429 });
  if (error instanceof YoutubeInsufficientScopeError)
    return json({ error: "YOUTUBE_INSUFFICIENT_SCOPE" }, { status: 403 });
  if (error instanceof YoutubeVideoUpdateRefusedError) {
    console.warn("YouTube refused a description update", { action, reason: error.reason });
    return json({ error: "YOUTUBE_REFUSED" }, { status: 422 });
  }
  if (error instanceof Error && error.message === "YOUTUBE_VIDEO_NOT_FOUND")
    return json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
  console.error("Video description update failed", { action, reason: safeReason(error) });
  return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
}

export const Route = createFileRoute("/api/youtube/video-description")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await requireWorkspaceFeature(request, "ai_lab");
          const url = new URL(request.url);
          const channelId = channelIdSchema.parse(url.searchParams.get("channelId"));
          const videoId = videoIdSchema.parse(url.searchParams.get("videoId"));
          const canPublish = canPublishDescription(ctx.workspaceRole);
          const channel = await workspaceChannel(ctx, channelId);
          if (!channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
          const last = canPublish
            ? await latestEvent(createServiceSupabaseClient(), ctx.workspaceId, channel.id, videoId)
            : null;
          return json({
            data: {
              canPublish,
              undoAvailable: last?.action === PUBLISHED,
              lastPublishedAt: last?.action === PUBLISHED ? last.created_at : null,
            },
          });
        } catch (error) {
          return failure(error, "status");
        }
      },

      POST: async ({ request }) => {
        let action = "unknown";
        try {
          const ctx = await requireWorkspaceFeature(request, "ai_lab");
          if (!canPublishDescription(ctx.workspaceRole))
            return json({ error: "ROLE_NOT_ALLOWED" }, { status: 403 });
          const input = bodySchema.parse(await parseJson(request));
          action = input.action;

          let next: string | null = null;
          if (input.action === "publish") {
            next = normalize(input.description);
            const problem = descriptionProblem(next);
            if (problem) return json({ error: problem }, { status: 422 });
          }

          const channel = await workspaceChannel(ctx, input.channelId);
          if (!channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const service = createServiceSupabaseClient();
          const previousEvent =
            input.action === "undo"
              ? await latestEvent(service, ctx.workspaceId, channel.id, input.videoId)
              : null;
          if (input.action === "undo") {
            if (
              previousEvent?.action !== PUBLISHED ||
              previousEvent.metadata?.previousDescription === undefined
            )
              return json({ error: "NOTHING_TO_UNDO" }, { status: 409 });
            next = previousEvent.metadata.previousDescription;
          }

          if ((await usedToday(service, ctx)) >= DESCRIPTION_PUBLISH_DAILY_LIMIT)
            return json({ error: "DAILY_LIMIT_REACHED" }, { status: 429 });

          const accessToken = await accessTokenFor(service, channel.id);
          const snippet = await fetchYoutubeVideoSnippet(accessToken, input.videoId);
          if (!snippet || snippet.channelId !== channel.youtube_channel_id)
            return json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });

          const current = normalize(snippet.description);
          if (current !== normalize(input.expectedDescription))
            return json({ error: "DESCRIPTION_CHANGED_ON_YOUTUBE" }, { status: 409 });
          // An undo only restores over the exact text that publish wrote.
          if (
            input.action === "undo" &&
            sha256(current) !== previousEvent?.metadata?.newDescriptionSha256
          )
            return json({ error: "DESCRIPTION_CHANGED_ON_YOUTUBE" }, { status: 409 });

          const description = next as string;
          if (current === description)
            return json({ data: { status: "unchanged", description, undoAvailable: false } });

          // Recorded first: if the record cannot be written, YouTube is not touched.
          const { data: event, error: auditError } = await service
            .from("audit_events")
            .insert({
              user_id: ctx.user.id,
              action: input.action === "publish" ? PUBLISHED : RESTORED,
              resource_type: RESOURCE_TYPE,
              resource_id: channel.id,
              metadata: {
                workspaceId: ctx.workspaceId,
                videoId: input.videoId,
                previousDescription: current,
                newDescriptionSha256: sha256(description),
              },
            })
            .select("id")
            .single();
          if (auditError || !event) {
            console.error("Description publish record failed", { code: auditError?.code });
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }

          try {
            await updateYoutubeVideoDescription(accessToken, input.videoId, snippet, description);
          } catch (error) {
            // YouTube kept the old description, so the record of a change is withdrawn.
            await service
              .from("audit_events")
              .delete()
              .eq("id", (event as { id: number }).id);
            throw error;
          }

          return json({
            data: {
              status: input.action === "publish" ? "published" : "restored",
              description,
              undoAvailable: input.action === "publish",
            },
          });
        } catch (error) {
          return failure(error, action);
        }
      },
    },
  },
});
