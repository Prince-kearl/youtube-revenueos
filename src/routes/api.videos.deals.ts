import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { applySetCookies } from "@/lib/server/supabase-ssr";
import { requireWorkspaceFeature, type WorkspaceContext } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  resolveRevenueAccess,
  revenueHiddenResponse,
  type RevenueAccess,
} from "@/lib/server/revenue-visibility";
import {
  LinkRefusedError,
  VideoDealsReadError,
  VideoDealsValidationError,
  VideoDealsWriteError,
  deleteDealVideoLink,
  insertDealVideoLink,
  isWorkspaceDeal,
  linkBodySchema,
  loadVideoDeals,
  parseLinkQuery,
  parseVideoQuery,
  resolveWorkspaceVideoIds,
  videoDealsResponse,
} from "@/lib/server/video-deals";

// /api/videos/deals — brand deals linked to one of the caller's videos (see
// lib/server/video-deals.ts for how a deal's value is attributed).
//
//   GET    ?videoId=<YouTube id>             the linked deals and this video's attributed share
//   POST   { videoId, dealId }               link a deal to the video
//   DELETE ?videoId=<YouTube id>&dealId=<id> unlink it
//
// POST and DELETE answer with the refreshed GET payload.
//
// Who:
//   * every method: an active workspace member whose role has the brand_deals feature, exactly
//     as the deals API requires — anyone else is refused before anything is read;
//   * amounts: only a caller who may see revenue (lib/server/revenue-visibility.ts). Everyone
//     else gets the same deals with every amount null and `visibility.revenue: "hidden"`;
//   * linking and unlinking: only a caller who may WRITE revenue. A link changes how a deal's
//     value is spread across videos, so a caller who cannot see that value cannot change it —
//     refused before the request body is even read.
//
// Isolation: the workspace always comes from the caller's membership. The deal and the video are
// both looked up inside that workspace first (an unknown id and another workspace's id get the
// same 404), and the link is written with the service role only after that, with the
// membership's workspace — the database then checks the same thing again (deal_videos triggers).

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

type Respond = (body: unknown, init?: ResponseInit) => Response;

async function parseJson(request: Request, respond: Respond) {
  try {
    return await request.json();
  } catch {
    throw respond({ error: "INVALID_JSON" }, { status: 400 });
  }
}

/** The single video row a write applies to, in the caller's workspace. */
async function writableVideo(ctx: WorkspaceContext, youtubeVideoId: string, respond: Respond) {
  const ids = await resolveWorkspaceVideoIds(ctx.client, ctx.workspaceId, youtubeVideoId);
  if (ids.length === 0) throw respond({ error: "VIDEO_NOT_FOUND" }, { status: 404 });
  // One YouTube video is one row per workspace (channels are unique per workspace, videos per
  // channel); if that ever failed to hold, refuse rather than guess which row was meant.
  if (ids.length > 1) throw respond({ error: "VIDEO_AMBIGUOUS" }, { status: 409 });
  return ids[0];
}

async function refreshed(
  ctx: WorkspaceContext,
  youtubeVideoId: string,
  access: RevenueAccess,
  respond: Respond,
  init?: ResponseInit,
  extra: Record<string, unknown> = {},
) {
  const payload = await loadVideoDeals(ctx.client, ctx.workspaceId, youtubeVideoId, access);
  return respond({ ...videoDealsResponse(payload, access), ...extra }, init);
}

/** Errors every handler maps the same way. */
function failure(error: unknown, respond: Respond): Response {
  if (error instanceof Response) return error;
  if (error instanceof VideoDealsValidationError || error instanceof z.ZodError)
    return respond({ error: "VALIDATION_ERROR" }, { status: 422 });
  if (error instanceof LinkRefusedError) return respond({ error: "LINK_REFUSED" }, { status: 409 });
  // A failed read or write is a failure: never an empty or partial answer.
  if (error instanceof VideoDealsReadError || error instanceof VideoDealsWriteError)
    return respond({ error: "DATABASE_ERROR" }, { status: 500 });
  return respond({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
}

export const Route = createFileRoute("/api/videos/deals")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let respond: Respond = json;
        try {
          const ctx = await requireWorkspaceFeature(request, "brand_deals");
          respond = (body, init) => applySetCookies(json(body, init), ctx.setCookieHeaders);
          const youtubeVideoId = parseVideoQuery(new URL(request.url));
          const access = await resolveRevenueAccess(ctx);
          return await refreshed(ctx, youtubeVideoId, access, respond);
        } catch (error) {
          return failure(error, respond);
        }
      },
      POST: async ({ request }) => {
        let respond: Respond = json;
        try {
          const ctx = await requireWorkspaceFeature(request, "brand_deals");
          respond = (body, init) => applySetCookies(json(body, init), ctx.setCookieHeaders);
          const service = createServiceSupabaseClient();
          const access = await resolveRevenueAccess(ctx, service);
          // Refused before the body is read, and before anything is looked up or written.
          if (!access.canWrite)
            return applySetCookies(revenueHiddenResponse(), ctx.setCookieHeaders);
          const input = linkBodySchema.parse(await parseJson(request, respond));
          if (!(await isWorkspaceDeal(ctx.client, ctx.workspaceId, input.dealId)))
            return respond({ error: "DEAL_NOT_FOUND" }, { status: 404 });
          const videoId = await writableVideo(ctx, input.videoId, respond);
          const { created } = await insertDealVideoLink(service, {
            dealId: input.dealId,
            videoId,
            // Always the caller's own workspace and identity — never from the request.
            workspaceId: ctx.workspaceId,
            userId: ctx.user.id,
          });
          return await refreshed(ctx, input.videoId, access, respond, {
            status: created ? 201 : 200,
          });
        } catch (error) {
          return failure(error, respond);
        }
      },
      DELETE: async ({ request }) => {
        let respond: Respond = json;
        try {
          const ctx = await requireWorkspaceFeature(request, "brand_deals");
          respond = (body, init) => applySetCookies(json(body, init), ctx.setCookieHeaders);
          const service = createServiceSupabaseClient();
          const access = await resolveRevenueAccess(ctx, service);
          if (!access.canWrite)
            return applySetCookies(revenueHiddenResponse(), ctx.setCookieHeaders);
          const input = parseLinkQuery(new URL(request.url));
          if (!(await isWorkspaceDeal(ctx.client, ctx.workspaceId, input.dealId)))
            return respond({ error: "DEAL_NOT_FOUND" }, { status: 404 });
          const videoId = await writableVideo(ctx, input.videoId, respond);
          const { removed } = await deleteDealVideoLink(service, {
            dealId: input.dealId,
            videoId,
            workspaceId: ctx.workspaceId,
          });
          return await refreshed(ctx, input.videoId, access, respond, undefined, { removed });
        } catch (error) {
          return failure(error, respond);
        }
      },
    },
  },
});
