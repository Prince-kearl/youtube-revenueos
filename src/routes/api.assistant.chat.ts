import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getWorkspaceContext } from "@/lib/server/workspace";
import { generateAssistantReply } from "@/lib/server/ai-generation";

// Real backing for Tubi, the in-app assistant (see HelpSheet in DashboardLayout.tsx) — replaces
// the old MockLlmService keyword-matched canned copy. Available to any signed-in workspace member
// regardless of role/feature access (it's a help widget, not a monetizable feature), so this uses
// getWorkspaceContext rather than requireWorkspaceFeature.
const chatSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().trim().max(2000),
      }),
    )
    .max(20)
    .optional(),
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

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

// Cheap, real counts about this workspace — never fabricated, just handed to the model as ground
// truth so it can answer "how many leads do I have" honestly instead of guessing or refusing.
async function buildAccountContext(
  client: Awaited<ReturnType<typeof getWorkspaceContext>>["client"],
  workspaceId: string,
  workspaceName: string,
): Promise<string> {
  const [channels, deals, leads, unreadLeads, links, destinations, freebies] = await Promise.all([
    client.from("youtube_channels").select("channel_name").eq("workspace_id", workspaceId),
    client.from("deals").select("stage").eq("workspace_id", workspaceId),
    client
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    client
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("unread", true),
    client.from("tracking_links").select("clicks").eq("workspace_id", workspaceId),
    client
      .from("destinations")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "active"),
    client
      .from("lead_magnets")
      .select("views")
      .eq("workspace_id", workspaceId)
      .eq("status", "published"),
  ]);

  const dealsByStage = new Map<string, number>();
  for (const d of deals.data ?? []) {
    dealsByStage.set(d.stage as string, (dealsByStage.get(d.stage as string) ?? 0) + 1);
  }
  const dealStageLine = ["prospect", "pitched", "negotiating", "contracted", "completed"]
    .map((stage) => `${stage}: ${dealsByStage.get(stage) ?? 0}`)
    .join(", ");
  const totalClicks = (links.data ?? []).reduce((sum, l) => sum + ((l.clicks as number) ?? 0), 0);
  const totalFreebieViews = (freebies.data ?? []).reduce(
    (sum, f) => sum + ((f.views as number) ?? 0),
    0,
  );
  const channelNames = (channels.data ?? []).map((c) => c.channel_name).filter(Boolean);

  return [
    `ACCOUNT SNAPSHOT for workspace "${workspaceName}" (real, current numbers — never invent different ones):`,
    `- Connected YouTube channel(s): ${channelNames.length > 0 ? channelNames.join(", ") : "none connected"}`,
    `- Deals by stage: ${dealStageLine} (total ${deals.data?.length ?? 0})`,
    `- Leads: ${leads.count ?? 0} total, ${unreadLeads.count ?? 0} unread`,
    `- Tracking links: ${links.data?.length ?? 0} links, ${totalClicks} total clicks`,
    `- Active destinations: ${destinations.count ?? 0}`,
    `- Published freebies: ${freebies.data?.length ?? 0}, ${totalFreebieViews} total page views`,
    `Exact revenue figures aren't in this snapshot — for those, point the creator to the Dashboard page's Revenue Trends chart rather than guessing a number.`,
  ].join("\n");
}

export const Route = createFileRoute("/api/assistant/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const ctx = await getWorkspaceContext(request);
          const input = chatSchema.parse(await parseJson(request));

          const { data: workspace } = await ctx.client
            .from("workspaces")
            .select("name")
            .eq("id", ctx.workspaceId)
            .maybeSingle();

          const accountContext = await buildAccountContext(
            ctx.client,
            ctx.workspaceId,
            workspace?.name ?? "this workspace",
          );

          let reply: string;
          try {
            reply = await generateAssistantReply({
              message: input.message,
              history: input.history ?? [],
              accountContext,
            });
          } catch (error) {
            if (error instanceof Error && error.message === "AI_PROVIDER_NOT_CONFIGURED") {
              return json({ error: "AI_PROVIDER_NOT_CONFIGURED" }, { status: 503 });
            }
            return json({ error: "GENERATION_FAILED" }, { status: 502 });
          }
          return json({ data: { reply } });
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
