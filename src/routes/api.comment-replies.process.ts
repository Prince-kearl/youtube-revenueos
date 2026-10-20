import { createFileRoute } from "@tanstack/react-router";
import { requireWorkspaceFeature } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  BATCH_SIZE,
  processWorkspaceQueue,
  ReplyQueueError,
} from "@/lib/server/comment-reply-queue";

// Sends the next small batch of the CALLER'S workspace's queued Comment Automation replies (see
// lib/server/comment-reply-queue.ts) — called by the Comment Automation page while it is open.
// Comment Automation must be enabled for the caller's role; only their workspace's jobs are
// touched, and never beyond the workspace's daily cap or the app-wide quota reserve — calling it
// more often sends nothing extra. With no page open, the existing daily sync job
// (api.youtube.sync.ts) continues every workspace's queue within the same limits.

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

export const Route = createFileRoute("/api/comment-replies/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { workspaceId } = await requireWorkspaceFeature(request, "comment_automation");
          const result = await processWorkspaceQueue(
            createServiceSupabaseClient(),
            workspaceId,
            BATCH_SIZE,
          );
          return json({ data: result });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof ReplyQueueError)
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          console.error("Processing comment replies failed");
          return json({ error: "YOUTUBE_DATA_UNAVAILABLE" }, { status: 502 });
        }
      },
    },
  },
});
