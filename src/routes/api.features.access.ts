import { createFileRoute } from "@tanstack/react-router";
import { applySetCookies, requireSessionUser } from "@/lib/server/supabase-ssr";
import { getFeatureAccessForRole } from "@/lib/server/feature-access";
import { canManageWorkspaceMembers, type WorkspaceRole } from "@/lib/server/workspace";

const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["owner", "manager", "setter", "editor"];

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

// Every signed-in user calls this to learn their OWN real feature access — never anyone else's,
// UNLESS they pass ?previewRole=, which is only honored for callers whose real WORKSPACE role can
// manage team composition (owner/manager — the same bar as inviting/editing teammates). That's
// the "Preview as role" simulation: it asks the server what a different role in THIS workspace
// would see, using the same real role_feature_access data, but never changes what the caller is
// actually authorized to do — every protected API still resolves the CALLER's real workspace role
// independently via requireWorkspaceFeature, completely ignoring this preview parameter. This
// endpoint is UX only either way.
//
// Note: the role returned here is the caller's WORKSPACE role (owner/manager/setter/editor,
// per-workspace), not profiles.role (the separate platform-staff role gating the Superadmin
// console) — see src/lib/server/workspace.ts for why these must never be conflated.
export const Route = createFileRoute("/api/features/access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user, setCookieHeaders } = await requireSessionUser(request);
          const { data: membership } = await client
            .from("workspace_members")
            .select("role")
            .eq("user_id", user.id)
            .eq("status", "active")
            .limit(1)
            .maybeSingle();
          const role = (membership?.role as WorkspaceRole | undefined) ?? "editor";

          const requestedPreview = new URL(request.url).searchParams.get("previewRole");
          let effectiveRole: WorkspaceRole = role;
          let previewing = false;
          if (requestedPreview) {
            if (!canManageWorkspaceMembers(role)) {
              return applySetCookies(
                json({ error: "PREVIEW_NOT_ALLOWED" }, { status: 403 }),
                setCookieHeaders,
              );
            }
            if (!WORKSPACE_ROLES.includes(requestedPreview as WorkspaceRole)) {
              return applySetCookies(
                json({ error: "INVALID_PREVIEW_ROLE" }, { status: 422 }),
                setCookieHeaders,
              );
            }
            effectiveRole = requestedPreview as WorkspaceRole;
            previewing = true;
          }

          const features = await getFeatureAccessForRole(client, effectiveRole);
          return applySetCookies(
            json({ data: { role, previewing, effectiveRole, features } }),
            setCookieHeaders,
          );
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
