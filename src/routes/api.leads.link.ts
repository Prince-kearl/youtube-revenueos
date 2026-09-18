import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireWorkspaceFeature } from "@/lib/server/workspace";

const linkSchema = z.object({
  leadId: z.string().uuid(),
  primaryLeadId: z.string().uuid().nullable(),
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

// Follows a chain of primary_lead_id references up to its root, so linking
// never produces anything deeper than a single parent -> children level.
async function resolveRoot(
  client: Awaited<ReturnType<typeof requireWorkspaceFeature>>["client"],
  workspaceId: string,
  startId: string,
): Promise<string> {
  let current = startId;
  for (let i = 0; i < 10; i++) {
    const { data } = await client
      .from("leads")
      .select("id, primary_lead_id")
      .eq("id", current)
      .eq("workspace_id", workspaceId)
      .single();
    if (!data || !data.primary_lead_id) return current;
    current = data.primary_lead_id as string;
  }
  return current;
}

export const Route = createFileRoute("/api/leads/link")({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        try {
          const { client, workspaceId } = await requireWorkspaceFeature(request, "leads");
          const input = linkSchema.parse(await parseJson(request));

          const { data: lead, error: leadError } = await client
            .from("leads")
            .select("id")
            .eq("id", input.leadId)
            .eq("workspace_id", workspaceId)
            .single();
          if (leadError || !lead) return json({ error: "NOT_FOUND" }, { status: 404 });

          if (input.primaryLeadId === null) {
            const { data, error } = await client
              .from("leads")
              .update({ primary_lead_id: null })
              .eq("id", input.leadId)
              .select();
            if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
            return json({ data });
          }

          if (input.primaryLeadId === input.leadId)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });

          const { data: target, error: targetError } = await client
            .from("leads")
            .select("id")
            .eq("id", input.primaryLeadId)
            .eq("workspace_id", workspaceId)
            .single();
          if (targetError || !target) return json({ error: "NOT_FOUND" }, { status: 404 });

          const root = await resolveRoot(client, workspaceId, input.primaryLeadId);
          if (root === input.leadId) return json({ error: "VALIDATION_ERROR" }, { status: 422 });

          // Flatten: anything already linked under leadId moves up to the new root too.
          const { data: reparented, error: reparentError } = await client
            .from("leads")
            .update({ primary_lead_id: root })
            .eq("primary_lead_id", input.leadId)
            .eq("workspace_id", workspaceId)
            .select();
          if (reparentError) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          const { data: updated, error: updateError } = await client
            .from("leads")
            .update({ primary_lead_id: root })
            .eq("id", input.leadId)
            .select();
          if (updateError) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          return json({ data: [...(updated ?? []), ...(reparented ?? [])] });
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
