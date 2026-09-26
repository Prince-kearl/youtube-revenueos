import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { getWorkspaceContext } from "@/lib/server/workspace";
import {
  createWorkspaceSignedUploadUrl,
  deleteWorkspaceFile,
  workspaceFilePath,
} from "@/lib/server/storage";

const idSchema = z.string().uuid();

// Validated against BOTH extension and declared MIME type — a client-supplied MIME type is never
// trusted alone (it's just a browser-set header), but this app also never inspects file bytes
// server-side (uploads go straight to Storage, not through a server route — see
// createWorkspaceSignedUploadUrl), so true content-sniffing isn't performed. Requiring both to
// agree with an allowlist is the practical middle ground available without routing the whole file
// through a server function first, which would defeat the point of direct-to-storage upload.
const ALLOWED_VIDEO_TYPES: Record<string, string[]> = {
  mp4: ["video/mp4"],
  mov: ["video/quicktime"],
  webm: ["video/webm"],
  m4v: ["video/x-m4v", "video/mp4"],
};
// 2GB — matches the workspace-files bucket's file_size_limit raised in
// 202610010001_pre_publish_videos.sql. Kept as one exported constant so the client-side dropzone
// and this server-side check can never silently drift apart.
export const MAX_PRE_PUBLISH_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

// Exported so tests can exercise validation directly, same convention as
// api.ai.analyze-video.ts's inputSchema.
export const createSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(MAX_PRE_PUBLISH_VIDEO_BYTES),
  mimeType: z.string().trim().min(1).max(100),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  channelId: z.string().uuid().nullable().optional(),
});

const updateSchema = z.object({
  channelId: z.string().uuid().nullable().optional(),
  topic: z.string().trim().max(500).nullable().optional(),
  audience: z.string().trim().max(500).nullable().optional(),
  tone: z.string().trim().max(120).nullable().optional(),
  goal: z.string().trim().max(120).nullable().optional(),
  transcript: z.string().trim().max(60_000).nullable().optional(),
  // Saved edits to the AI output — the user can edit any generated field (title, description,
  // tags, chapters, CTAs) before publishing; this is how those edits persist. Left loosely typed
  // here (validated by PrePublishAnalysisResultSchema would be too strict for partial edits since
  // the client only ever sends the full current object back, never a partial) — the important
  // ownership/authorization boundary is RLS + the workspace check below, not this shape.
  analysisResult: z.record(z.string(), z.unknown()).nullable().optional(),
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

function withCookies(response: Response, setCookieHeaders: string[]) {
  return applySetCookies(response, setCookieHeaders);
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
}

const rowColumns =
  "id, workspace_id, channel_id, file_name, file_size, mime_type, duration_seconds, width, height, status, topic, audience, tone, goal, transcript, analysis_result, analysis_model, error, created_at, updated_at";

export const Route = createFileRoute("/api/pre-publish-videos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await getWorkspaceContext(request);
          const url = new URL(request.url);
          const id = url.searchParams.get("id");
          if (id) {
            const parsedId = idSchema.parse(id);
            const { data, error } = await client
              .from("pre_publish_videos")
              .select(rowColumns)
              .eq("id", parsedId)
              .eq("workspace_id", workspaceId)
              .maybeSingle();
            if (error)
              return withCookies(
                json({ error: "DATABASE_ERROR" }, { status: 500 }),
                setCookieHeaders,
              );
            if (!data)
              return withCookies(json({ error: "NOT_FOUND" }, { status: 404 }), setCookieHeaders);
            return withCookies(json({ data }), setCookieHeaders);
          }
          const { data, error } = await client
            .from("pre_publish_videos")
            .select(rowColumns)
            .eq("workspace_id", workspaceId)
            .order("created_at", { ascending: false });
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          return withCookies(json({ data }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      // Creates the row and mints a signed upload URL in one step — the browser then uploads
      // directly to Storage (see createWorkspaceSignedUploadUrl's doc comment for why), and calls
      // /api/pre-publish-videos/analyze once that upload finishes.
      POST: async ({ request }) => {
        try {
          const { client, user, workspaceId, setCookieHeaders } =
            await getWorkspaceContext(request);
          const input = createSchema.parse(await parseJson(request));

          const extension = fileExtension(input.fileName);
          const allowedMimeTypes = ALLOWED_VIDEO_TYPES[extension];
          if (!allowedMimeTypes || !allowedMimeTypes.includes(input.mimeType.toLowerCase())) {
            return withCookies(
              json({ error: "UNSUPPORTED_FILE_TYPE" }, { status: 422 }),
              setCookieHeaders,
            );
          }

          if (input.channelId) {
            const { data: channel, error: channelError } = await client
              .from("youtube_channels")
              .select("id")
              .eq("id", input.channelId)
              .eq("workspace_id", workspaceId)
              .maybeSingle();
            if (channelError)
              return withCookies(
                json({ error: "DATABASE_ERROR" }, { status: 500 }),
                setCookieHeaders,
              );
            if (!channel)
              return withCookies(
                json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 }),
                setCookieHeaders,
              );
          }

          const { data: inserted, error: insertError } = await client
            .from("pre_publish_videos")
            .insert({
              workspace_id: workspaceId,
              user_id: user.id,
              channel_id: input.channelId ?? null,
              file_path: "", // filled in immediately below, once we know the row's real id
              file_name: input.fileName,
              file_size: input.fileSize,
              mime_type: input.mimeType,
              duration_seconds: input.durationSeconds ?? null,
              width: input.width ?? null,
              height: input.height ?? null,
              status: "uploaded",
            })
            .select("id")
            .single();
          if (insertError || !inserted)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );

          const path = workspaceFilePath(
            workspaceId,
            "pre-publish",
            inserted.id,
            `original.${extension}`,
          );
          const { error: pathUpdateError } = await client
            .from("pre_publish_videos")
            .update({ file_path: path })
            .eq("id", inserted.id);
          if (pathUpdateError) {
            await client.from("pre_publish_videos").delete().eq("id", inserted.id);
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          }

          const signed = await createWorkspaceSignedUploadUrl(path);
          if (!signed) {
            await client.from("pre_publish_videos").delete().eq("id", inserted.id);
            return withCookies(
              json({ error: "UPLOAD_URL_FAILED" }, { status: 500 }),
              setCookieHeaders,
            );
          }

          return withCookies(
            json(
              {
                data: {
                  id: inserted.id,
                  path,
                  uploadUrl: signed.signedUrl,
                  uploadToken: signed.token,
                },
              },
              { status: 201 },
            ),
            setCookieHeaders,
          );
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      PATCH: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await getWorkspaceContext(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = updateSchema.parse(await parseJson(request));

          if (input.channelId) {
            const { data: channel } = await client
              .from("youtube_channels")
              .select("id")
              .eq("id", input.channelId)
              .eq("workspace_id", workspaceId)
              .maybeSingle();
            if (!channel)
              return withCookies(
                json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 }),
                setCookieHeaders,
              );
          }

          const update: Record<string, unknown> = {};
          if (input.channelId !== undefined) update.channel_id = input.channelId;
          if (input.topic !== undefined) update.topic = input.topic;
          if (input.audience !== undefined) update.audience = input.audience;
          if (input.tone !== undefined) update.tone = input.tone;
          if (input.goal !== undefined) update.goal = input.goal;
          if (input.transcript !== undefined) update.transcript = input.transcript;
          if (input.analysisResult !== undefined) update.analysis_result = input.analysisResult;
          update.updated_at = new Date().toISOString();

          const { data, error } = await client
            .from("pre_publish_videos")
            .update(update)
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .select(rowColumns)
            .maybeSingle();
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          if (!data)
            return withCookies(json({ error: "NOT_FOUND" }, { status: 404 }), setCookieHeaders);
          return withCookies(json({ data }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },

      DELETE: async ({ request }) => {
        try {
          const { client, workspaceId, setCookieHeaders } = await getWorkspaceContext(request);
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const { data: existing } = await client
            .from("pre_publish_videos")
            .select("file_path")
            .eq("id", id)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          const { error } = await client
            .from("pre_publish_videos")
            .delete()
            .eq("id", id)
            .eq("workspace_id", workspaceId);
          if (error)
            return withCookies(
              json({ error: "DATABASE_ERROR" }, { status: 500 }),
              setCookieHeaders,
            );
          if (existing?.file_path) await deleteWorkspaceFile(existing.file_path);
          return withCookies(json({ success: true }), setCookieHeaders);
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
