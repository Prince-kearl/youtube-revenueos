import { createFileRoute } from "@tanstack/react-router";
import { resolveCname } from "node:dns/promises";
import { z } from "zod";
import { getWorkspaceContext, canManageWorkspaceMembers } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getServerEnv } from "@/lib/server/env";

// Custom domain for short links. Writes go through the service client (like every other
// workspace-settings write — see api.workspace.members.ts) because `workspaces` only has a
// member-read RLS policy, not a member-write one; the owner/manager check below is what actually
// gates the write. Verification is a REAL DNS lookup, not a stored "trust me" flag — see the
// POST handler.
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    "Enter a real domain, like go.yourbrand.com",
  )
  .max(255);

const patchSchema = z.object({ domain: domainSchema.nullable() });

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

// The app's own canonical host — what a creator's DNS CNAME needs to point at for their domain to
// reach this app once they've also added it in their hosting provider's dashboard (see the
// PATCH/verify handlers' doc comments for why that second step can't be automated here).
function cnameTarget(request: Request): string {
  const configured = getServerEnv("APP_URL");
  try {
    return new URL(configured ?? new URL(request.url).origin).host;
  } catch {
    return new URL(request.url).host;
  }
}

export const Route = createFileRoute("/api/workspace/domain")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await getWorkspaceContext(request);
          const { data, error } = await ctx.client
            .from("workspaces")
            .select("custom_domain, custom_domain_verified_at")
            .eq("id", ctx.workspaceId)
            .maybeSingle();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({
            data: {
              domain: data?.custom_domain ?? null,
              verifiedAt: data?.custom_domain_verified_at ?? null,
              cnameTarget: cnameTarget(request),
              canManage: canManageWorkspaceMembers(ctx.workspaceRole),
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const ctx = await getWorkspaceContext(request);
          if (!canManageWorkspaceMembers(ctx.workspaceRole))
            return json({ error: "FORBIDDEN" }, { status: 403 });
          const input = patchSchema.parse(await parseJson(request));

          const service = createServiceSupabaseClient();
          const { data, error } = await service
            .from("workspaces")
            .update({ custom_domain: input.domain, custom_domain_verified_at: null })
            .eq("id", ctx.workspaceId)
            .select("custom_domain, custom_domain_verified_at")
            .single();
          if (error) {
            const taken = error.code === "23505";
            return json(
              { error: taken ? "DOMAIN_TAKEN" : "DATABASE_ERROR" },
              { status: taken ? 409 : 500 },
            );
          }
          return json({
            data: {
              domain: data.custom_domain,
              verifiedAt: data.custom_domain_verified_at,
              cnameTarget: cnameTarget(request),
              canManage: true,
            },
          });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const ctx = await getWorkspaceContext(request);
          if (!canManageWorkspaceMembers(ctx.workspaceRole))
            return json({ error: "FORBIDDEN" }, { status: 403 });
          const action = new URL(request.url).searchParams.get("action");
          if (action !== "verify") return json({ error: "UNKNOWN_ACTION" }, { status: 400 });

          const { data: workspace, error: readError } = await ctx.client
            .from("workspaces")
            .select("custom_domain")
            .eq("id", ctx.workspaceId)
            .maybeSingle();
          if (readError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          if (!workspace?.custom_domain) return json({ error: "NO_DOMAIN" }, { status: 422 });

          const target = cnameTarget(request);
          let records: string[] = [];
          let verified = false;
          try {
            records = await resolveCname(workspace.custom_domain);
            verified = records.some(
              (record) => record.replace(/\.$/, "").toLowerCase() === target.toLowerCase(),
            );
          } catch {
            verified = false;
          }

          if (verified) {
            const service = createServiceSupabaseClient();
            const { error: writeError } = await service
              .from("workspaces")
              .update({ custom_domain_verified_at: new Date().toISOString() })
              .eq("id", ctx.workspaceId);
            if (writeError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }

          return json({ data: { verified, records, cnameTarget: target } });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
