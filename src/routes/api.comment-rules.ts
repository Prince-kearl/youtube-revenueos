import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";

const idSchema = z.string().uuid();

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  triggerType: z.enum(["keyword", "handle", "question"]),
  keywords: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  replyTemplate: z.string().trim().min(1).max(500),
  videoId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
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

type SupabaseClientLike = Awaited<ReturnType<typeof requireWorkspaceFeature>>["client"];

async function findOwnedChannel(client: SupabaseClientLike, requestedId: string | null) {
  let query = client
    .from("youtube_channels")
    .select("id")
    .order("connected_at", { ascending: false });
  if (requestedId) query = query.eq("id", requestedId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw json({ error: "DATABASE_ERROR" }, { status: 500 });
  if (!data) throw json({ error: "CHANNEL_NOT_FOUND" }, { status: 404 });
  return data.id as string;
}

const ruleColumns =
  "id, name, trigger_type, keywords, reply_template, active, created_at, updated_at, video:videos(id,title)";

async function withFiredCounts(
  client: SupabaseClientLike,
  channelId: string,
  rules: Record<string, unknown>[],
) {
  if (rules.length === 0) return rules;
  const { data } = await client
    .from("comment_automation_replies")
    .select("rule_id")
    .eq("channel_id", channelId)
    .eq("status", "sent");
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const ruleId = row.rule_id as string | null;
    if (ruleId) counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1);
  }
  return rules.map((rule) => ({ ...rule, firedCount: counts.get(rule.id as string) ?? 0 }));
}

// Best-effort: the rule create/update itself already succeeded by the time this runs, so a
// logging failure here is swallowed rather than surfacing as a request failure.
async function logRuleEvent(
  client: SupabaseClientLike,
  ruleId: string,
  channelId: string,
  active: boolean,
) {
  try {
    await client.from("comment_automation_rule_events").insert({
      rule_id: ruleId,
      channel_id: channelId,
      active,
    });
  } catch {
    // logging only — never block the actual rule mutation over it.
  }
}

// Reconstructs "how many rules were active as of `cutoffIso`" from the event log: for each rule,
// the latest event at-or-before the cutoff determines whether it was active then. A rule with no
// event before the cutoff didn't exist yet and isn't counted. Deleted rules drop out naturally
// (their events cascade-delete with them), so this slightly undercounts rules that existed and
// were later deleted rather than fabricating a number for a rule that's gone — an honest
// approximation, not a precise historical ledger.
function countActiveAt(
  events: Array<{ rule_id: string; active: boolean; created_at: string }>,
  cutoffIso: string,
): number {
  const latestByRule = new Map<string, { active: boolean; created_at: string }>();
  for (const event of events) {
    if (event.created_at > cutoffIso) continue;
    const existing = latestByRule.get(event.rule_id);
    if (!existing || event.created_at > existing.created_at) {
      latestByRule.set(event.rule_id, event);
    }
  }
  return [...latestByRule.values()].filter((entry) => entry.active).length;
}

export const Route = createFileRoute("/api/comment-rules")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireWorkspaceFeature(request, "comment_automation");
          const channelId = await findOwnedChannel(
            client,
            new URL(request.url).searchParams.get("channelId"),
          );
          const { data, error } = await client
            .from("comment_automation_rules")
            .select(ruleColumns)
            .eq("channel_id", channelId)
            .order("created_at", { ascending: false });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const { data: events } = await client
            .from("comment_automation_rule_events")
            .select("rule_id, active, created_at")
            .eq("channel_id", channelId);
          // Rules created before this event log existed have no rows here at all — without a
          // fallback they'd be silently excluded from any past cutoff, making the "30 days ago"
          // count look artificially low (and the trend look artificially inflated) rather than
          // reflecting that the rule was, in fact, already sitting at whatever state it's in now.
          // Synthesizing one event from the rule's own created_at/active closes that gap.
          const ruleIdsWithEvents = new Set((events ?? []).map((event) => event.rule_id as string));
          const backfilledEvents = (data ?? [])
            .filter((rule) => !ruleIdsWithEvents.has(rule.id as string))
            .map((rule) => ({
              rule_id: rule.id as string,
              active: rule.active as boolean,
              created_at: rule.created_at as string,
            }));
          const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const activeRulesThirtyDaysAgo = countActiveAt(
            [...(events ?? []), ...backfilledEvents],
            thirtyDaysAgoIso,
          );

          return json({
            data: await withFiredCounts(client, channelId, data ?? []),
            activeRulesThirtyDaysAgo,
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { client } = await requireWorkspaceFeature(request, "comment_automation");
          const url = new URL(request.url);
          const channelId = await findOwnedChannel(client, url.searchParams.get("channelId"));
          const input = ruleSchema.parse(await parseJson(request));
          const { data, error } = await client
            .from("comment_automation_rules")
            .insert({
              channel_id: channelId,
              name: input.name,
              trigger_type: input.triggerType,
              keywords: input.keywords,
              reply_template: input.replyTemplate,
              video_id: input.videoId ?? null,
              active: input.active ?? true,
            })
            .select(ruleColumns)
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          await logRuleEvent(client, data.id, channelId, data.active);
          return json({ data: { ...data, firedCount: 0 } }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client } = await requireWorkspaceFeature(request, "comment_automation");
          const url = new URL(request.url);
          const id = idSchema.parse(url.searchParams.get("id"));
          const channelId = await findOwnedChannel(client, url.searchParams.get("channelId"));
          const input = ruleSchema.partial().parse(await parseJson(request));
          const update: Record<string, unknown> = {};
          if (input.name !== undefined) update.name = input.name;
          if (input.triggerType !== undefined) update.trigger_type = input.triggerType;
          if (input.keywords !== undefined) update.keywords = input.keywords;
          if (input.replyTemplate !== undefined) update.reply_template = input.replyTemplate;
          if (input.videoId !== undefined) update.video_id = input.videoId;
          if (input.active !== undefined) update.active = input.active;
          const { data, error } = await client
            .from("comment_automation_rules")
            .update(update)
            .eq("id", id)
            .select(ruleColumns)
            .single();
          if (error) {
            const notFound = error.code === "PGRST116";
            return json(
              { error: notFound ? "NOT_FOUND" : "DATABASE_ERROR" },
              { status: notFound ? 404 : 500 },
            );
          }
          if (input.active !== undefined) await logRuleEvent(client, id, channelId, input.active);
          const [withCount] = await withFiredCounts(client, channelId, [data]);
          return json({ data: withCount });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      DELETE: async ({ request }) => {
        try {
          const { client } = await requireWorkspaceFeature(request, "comment_automation");
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const { error } = await client.from("comment_automation_rules").delete().eq("id", id);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ success: true });
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
