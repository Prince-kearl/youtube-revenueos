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
  updateYoutubeVideoDetails,
  YoutubeInsufficientScopeError,
  YoutubeQuotaExceededError,
  YoutubeVideoUpdateRefusedError,
  type YoutubeVideoDetailChanges,
  type YoutubeVideoSnippet,
} from "@/lib/server/google-oauth";
import { quotaDayStart } from "@/lib/server/youtube-quota";
import {
  canPublishDescription,
  cleanTags,
  DESCRIPTION_PUBLISH_DAILY_LIMIT,
  descriptionProblem,
  tagsProblem,
  titleProblem,
} from "@/lib/youtube-description";

// Publishing a video's title, description and/or tags to YouTube from the AI Description Lab and
// Analyze Video (chapters and calls to action are published as part of the description), and
// undoing the last publish.
//
//   GET  ?channelId&videoId   whether this person may publish, and whether an undo is available
//   POST { action: "publish", channelId, videoId, changes: {title?, description?, tags?}, expected }
//   POST { action: "undo",    channelId, videoId, expected }
//
// `expected` is {title, description, tags} as the page last saw them on YouTube.
//
// Who: workspace owners, managers and editors, with the ai_lab feature and a paid plan; the
// channel must be one of the caller's workspace's connected channels and the video must be on
// that channel at YouTube. Anything else is the same 404 as a video that does not exist.
//
// Safety:
//   - videos.update replaces the whole snippet, so the current snippet is read first and every
//     field not being changed (and the category and languages) is sent back as it is;
//   - if YouTube now holds anything other than `expected` (edited in Studio meanwhile), nothing is
//     written: 409 CHANGED_ON_YOUTUBE;
//   - before writing, the values being replaced are recorded in audit_events (who, when, which
//     video, which fields), which is also what an undo restores. If that record cannot be
//     written, nothing is sent to YouTube; if YouTube refuses, the record is withdrawn;
//   - an undo restores only over exactly what the publish wrote;
//   - at most DESCRIPTION_PUBLISH_DAILY_LIMIT publishes and undos per workspace per quota day.

const RESOURCE_TYPE = "youtube_video_description";
const PUBLISHED = "youtube_description.published";
const RESTORED = "youtube_description.restored";

type Field = "title" | "description" | "tags";
const FIELDS: Field[] = ["title", "description", "tags"];
type Values = { title?: string; description?: string; tags?: string[] };

const channelIdSchema = z.string().uuid();
const videoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
// What YouTube holds today is compared, not validated, so these are wider than YouTube's limits.
const expectedSchema = z
  .object({
    title: z.string().max(1_000),
    description: z.string().max(20_000),
    tags: z.array(z.string().max(1_000)).max(500),
  })
  .strict();

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("publish"),
      channelId: channelIdSchema,
      videoId: videoIdSchema,
      changes: z
        .object({
          title: z.string().max(1_000).optional(),
          description: z.string().max(10_000).optional(),
          tags: z.array(z.string().max(500)).max(100).optional(),
        })
        .strict(),
      expected: expectedSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("undo"),
      channelId: channelIdSchema,
      videoId: videoIdSchema,
      expected: expectedSchema,
    })
    .strict(),
]);

type AuditMetadata = {
  workspaceId?: string;
  videoId?: string;
  fields?: Field[];
  previous?: Values;
  writtenSha256?: string;
  // Records made before titles and tags could be published (description only).
  previousDescription?: string;
  newDescriptionSha256?: string;
};
type AuditRow = { id: number; action: string; created_at: string; metadata: AuditMetadata | null };

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
const sameTags = (a: string[], b: string[]) =>
  a.length === b.length && a.every((tag, i) => tag === b[i]);

function valuesOf(snippet: YoutubeVideoSnippet): Required<Values> {
  return {
    title: snippet.title,
    description: normalize(snippet.description),
    tags: snippet.tags ?? [],
  };
}

/** A fingerprint of exactly what a publish wrote. A description-only publish is fingerprinted
 * as the description itself, as records made before titles and tags could be published were. */
function fingerprint(fields: Field[], values: Values): string {
  if (fields.length === 1 && fields[0] === "description") return sha256(values.description ?? "");
  return sha256(JSON.stringify(fields.map((field) => [field, values[field] ?? null])));
}

/** What an undo of this publish record restores, and the fingerprint it must find on YouTube. */
function undoOf(
  row: AuditRow | null,
): { previous: Values; fields: Field[]; written: string } | null {
  const m = row?.action === PUBLISHED ? row.metadata : null;
  if (!m) return null;
  if (m.fields?.length && m.previous && m.writtenSha256)
    return { previous: m.previous, fields: m.fields, written: m.writtenSha256 };
  if (typeof m.previousDescription === "string" && m.newDescriptionSha256)
    return {
      previous: { description: m.previousDescription },
      fields: ["description"],
      written: m.newDescriptionSha256,
    };
  return null;
}

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

/** The requested changes, cleaned, or the reason YouTube would refuse one of them. */
function checkedChanges(
  changes: Values,
): { values: Values; fields: Field[] } | { problem: string } {
  const values: Values = {};
  if (changes.title !== undefined) {
    const problem = titleProblem(changes.title);
    if (problem) return { problem };
    values.title = changes.title.trim();
  }
  if (changes.description !== undefined) {
    const description = normalize(changes.description);
    const problem = descriptionProblem(description);
    if (problem) return { problem };
    values.description = description;
  }
  if (changes.tags !== undefined) {
    const tags = cleanTags(changes.tags);
    const problem = tagsProblem(tags);
    if (problem) return { problem };
    values.tags = tags;
  }
  const fields = FIELDS.filter((field) => values[field] !== undefined);
  if (!fields.length) return { problem: "NOTHING_TO_PUBLISH" };
  return { values, fields };
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
    console.warn("YouTube refused a video details update", { action, reason: error.reason });
    return json({ error: "YOUTUBE_REFUSED" }, { status: 422 });
  }
  if (error instanceof Error && error.message === "YOUTUBE_VIDEO_NOT_FOUND")
    return json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
  console.error("Video details update failed", { action, reason: safeReason(error) });
  return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
}

export const Route = createFileRoute("/api/youtube/video-details")({
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
          const undo = canPublish
            ? undoOf(
                await latestEvent(
                  createServiceSupabaseClient(),
                  ctx.workspaceId,
                  channel.id,
                  videoId,
                ),
              )
            : null;
          return json({
            data: { canPublish, undoAvailable: Boolean(undo), undoFields: undo?.fields ?? [] },
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

          let next: { values: Values; fields: Field[] } | null = null;
          if (input.action === "publish") {
            const checked = checkedChanges(input.changes);
            if ("problem" in checked) return json({ error: checked.problem }, { status: 422 });
            next = checked;
          }

          const channel = await workspaceChannel(ctx, input.channelId);
          if (!channel) return json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });

          const service = createServiceSupabaseClient();
          let undo: ReturnType<typeof undoOf> = null;
          if (input.action === "undo") {
            undo = undoOf(await latestEvent(service, ctx.workspaceId, channel.id, input.videoId));
            if (!undo) return json({ error: "NOTHING_TO_UNDO" }, { status: 409 });
            next = { values: undo.previous, fields: undo.fields };
          }
          const { values, fields } = next as { values: Values; fields: Field[] };

          if ((await usedToday(service, ctx)) >= DESCRIPTION_PUBLISH_DAILY_LIMIT)
            return json({ error: "DAILY_LIMIT_REACHED" }, { status: 429 });

          const accessToken = await accessTokenFor(service, channel.id);
          const snippet = await fetchYoutubeVideoSnippet(accessToken, input.videoId);
          if (!snippet || snippet.channelId !== channel.youtube_channel_id)
            return json({ error: "VIDEO_NOT_FOUND" }, { status: 404 });

          const current = valuesOf(snippet);
          const expected = input.expected;
          if (
            current.title !== expected.title ||
            current.description !== normalize(expected.description) ||
            !sameTags(current.tags, expected.tags)
          )
            return json({ error: "CHANGED_ON_YOUTUBE" }, { status: 409 });
          // An undo only restores over exactly what the publish wrote.
          if (undo && fingerprint(fields, current) !== undo.written)
            return json({ error: "CHANGED_ON_YOUTUBE" }, { status: 409 });

          const after = { ...current, ...values };
          const unchanged = fields.every((field) =>
            field === "tags"
              ? sameTags(current.tags, values.tags ?? [])
              : current[field] === values[field],
          );
          if (unchanged)
            return json({ data: { status: "unchanged", current: after, undoAvailable: false } });

          // Recorded first: if the record cannot be written, YouTube is not touched.
          const previous: Values = Object.fromEntries(fields.map((f) => [f, current[f]]));
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
                fields,
                previous,
                writtenSha256: fingerprint(fields, after),
              },
            })
            .select("id")
            .single();
          if (auditError || !event) {
            console.error("Video details publish record failed", { code: auditError?.code });
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }

          try {
            const changes: YoutubeVideoDetailChanges = Object.fromEntries(
              fields.map((f) => [f, values[f]]),
            );
            await updateYoutubeVideoDetails(accessToken, input.videoId, snippet, changes);
          } catch (error) {
            // YouTube kept the old values, so the record of a change is withdrawn.
            await service
              .from("audit_events")
              .delete()
              .eq("id", (event as { id: number }).id);
            throw error;
          }

          return json({
            data: {
              status: input.action === "publish" ? "published" : "restored",
              fields,
              current: after,
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
