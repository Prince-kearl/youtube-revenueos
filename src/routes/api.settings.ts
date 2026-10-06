import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { requireMinimumRole } from "@/lib/server/roles";

// Backs global Customization/Design Studio settings (src/lib/stores.ts useSiteContent) via a
// real Supabase table, so a Superadmin's changes apply for every browser/device/user instead of
// just the one that made them. Single row (id fixed to 'default') — there is exactly one
// site-wide configuration, not a table of many.
const SETTINGS_ROW_ID = "default";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      // No auth required — every visitor, including a signed-out one on the public landing
      // page, needs to read branding/theme settings to render consistently. Not sensitive data;
      // matches the table's public-read RLS policy.
      GET: async () => {
        try {
          const service = createServiceSupabaseClient();
          const { data, error } = await service
            .from("site_settings")
            .select("content")
            .eq("id", SETTINGS_ROW_ID)
            .maybeSingle();
          if (error) return json({ success: false, error: "DATABASE_ERROR" });
          // Identical for every visitor and requested on every page load, and large when logos
          // are stored inline (data URLs) — let the CDN answer it instead of running a function
          // and a database query each time. Browsers still revalidate (no max-age), so an admin's
          // change shows up within s-maxage seconds everywhere.
          return json(
            { success: true, content: data?.content ?? null },
            {
              headers: {
                "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=300",
              },
            },
          );
        } catch {
          return json({ success: false, error: "SERVER_MISCONFIGURED" });
        }
      },
      // Real server-side authorization — Customization is a Superadmin console feature. The
      // admin UI's own client-side gate (AdminConsole) is not itself a security boundary; this
      // route previously had no server-side check at all.
      PUT: async ({ request }) => {
        try {
          await requireMinimumRole(request, "owner");
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return json({ success: false, error: "INVALID_JSON" }, { status: 400 });
          }
          const service = createServiceSupabaseClient();
          const { error } = await service
            .from("site_settings")
            .upsert({ id: SETTINGS_ROW_ID, content: body });
          if (error) return json({ success: false, error: "DATABASE_ERROR" });
          return json({ success: true });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ success: false, error: "SERVER_MISCONFIGURED" });
        }
      },
    },
  },
});
