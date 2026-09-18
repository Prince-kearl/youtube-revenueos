import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { signedWorkspaceFileUrl } from "@/lib/server/storage";
import { ALLOWED_FONTS } from "@/routes/api.workspace.branding";

// The public /f/$slug landing page's data source — unauthenticated by design, same as r.$slug.ts,
// so it runs on the service client. Deliberately never returns `content` or a download URL here:
// those only unlock after a real opt-in (see api.freebies.optin.ts) — that gate is the entire
// point of a lead magnet.
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

export const Route = createFileRoute("/api/freebies/public")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const slug = new URL(request.url).searchParams.get("slug")?.trim().toLowerCase();
        if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
          return json({ error: "NOT_FOUND" }, { status: 404 });
        }
        const service = createServiceSupabaseClient();
        const { data: magnet, error } = await service
          .from("lead_magnets")
          .select("id, workspace_id, title, teaser, format, source, status")
          .eq("slug", slug)
          .eq("status", "published")
          .maybeSingle();
        if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
        if (!magnet) return json({ error: "NOT_FOUND" }, { status: 404 });

        const [{ data: workspace }, { data: branding }] = await Promise.all([
          service.from("workspaces").select("name").eq("id", magnet.workspace_id).maybeSingle(),
          service
            .from("workspace_branding")
            .select("logo_path, primary_color, accent_color, font_family")
            .eq("workspace_id", magnet.workspace_id)
            .maybeSingle(),
        ]);

        await service.rpc("increment_lead_magnet_views", { p_lead_magnet_id: magnet.id });

        return json({
          data: {
            title: magnet.title,
            teaser: magnet.teaser,
            format: magnet.format,
            workspaceName: workspace?.name ?? null,
            branding: {
              logoUrl: branding?.logo_path
                ? await signedWorkspaceFileUrl(branding.logo_path, 3600)
                : null,
              primaryColor: branding?.primary_color ?? null,
              accentColor: branding?.accent_color ?? null,
              fontFamily:
                (branding?.font_family && ALLOWED_FONTS[branding.font_family]) ||
                ALLOWED_FONTS.sans,
            },
          },
        });
      },
    },
  },
});
