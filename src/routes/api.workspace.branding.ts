import { createFileRoute } from "@tanstack/react-router";
import { getWorkspaceContext, canManageWorkspaceMembers } from "@/lib/server/workspace";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import {
  uploadWorkspaceFile,
  deleteWorkspaceFile,
  workspaceFilePath,
  signedWorkspaceFileUrl,
} from "@/lib/server/storage";

// Per-workspace brand kit (logo/colors/font) applied to a freebie's public page — see f.$slug.tsx.
// Writes go through the service client (workspace_branding has no member-write RLS policy, same
// reasoning as workspaces.custom_domain) gated by the owner/manager check below. `fontFamily` is
// validated against a fixed allowlist because it's interpolated directly into CSS on a public page.
export const ALLOWED_FONTS: Record<string, string> = {
  sans: 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  rounded: '"Century Gothic", "Avenir Next", ui-rounded, system-ui, sans-serif',
};

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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

async function present(
  row: {
    logo_path: string | null;
    primary_color: string | null;
    accent_color: string | null;
    font_family: string | null;
  } | null,
) {
  return {
    logoUrl: row?.logo_path ? await signedWorkspaceFileUrl(row.logo_path, 3600) : null,
    primaryColor: row?.primary_color ?? null,
    accentColor: row?.accent_color ?? null,
    fontFamily: row?.font_family && ALLOWED_FONTS[row.font_family] ? row.font_family : "sans",
  };
}

export const Route = createFileRoute("/api/workspace/branding")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const ctx = await getWorkspaceContext(request);
          const { data, error } = await ctx.client
            .from("workspace_branding")
            .select("logo_path, primary_color, accent_color, font_family")
            .eq("workspace_id", ctx.workspaceId)
            .maybeSingle();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({
            data: {
              ...(await present(data)),
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

          const form = await request.formData();
          const primaryColorRaw = form.get("primaryColor");
          const accentColorRaw = form.get("accentColor");
          const fontFamilyRaw = form.get("fontFamily");
          const removeLogo = form.get("removeLogo") === "true";
          const file = form.get("logo");

          const primaryColor = primaryColorRaw ? String(primaryColorRaw) : null;
          const accentColor = accentColorRaw ? String(accentColorRaw) : null;
          const fontFamily = fontFamilyRaw ? String(fontFamilyRaw) : null;
          if (primaryColor && !HEX_COLOR.test(primaryColor))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (accentColor && !HEX_COLOR.test(accentColor))
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });
          if (fontFamily && !ALLOWED_FONTS[fontFamily])
            return json({ error: "VALIDATION_ERROR" }, { status: 422 });

          const { data: existing } = await ctx.client
            .from("workspace_branding")
            .select("logo_path")
            .eq("workspace_id", ctx.workspaceId)
            .maybeSingle();

          let logoPath = existing?.logo_path ?? null;
          if (removeLogo && logoPath) {
            await deleteWorkspaceFile(logoPath);
            logoPath = null;
          } else if (file instanceof File && file.size > 0) {
            if (file.size > MAX_LOGO_BYTES)
              return json({ error: "FILE_TOO_LARGE" }, { status: 413 });
            if (!file.type.startsWith("image/"))
              return json({ error: "VALIDATION_ERROR" }, { status: 422 });
            const path = workspaceFilePath(ctx.workspaceId, "branding", `logo-${Date.now()}`);
            const { error: uploadError } = await uploadWorkspaceFile(path, file);
            if (uploadError) return json({ error: "UPLOAD_FAILED" }, { status: 500 });
            if (logoPath) await deleteWorkspaceFile(logoPath);
            logoPath = path;
          }

          const service = createServiceSupabaseClient();
          const { data, error } = await service
            .from("workspace_branding")
            .upsert(
              {
                workspace_id: ctx.workspaceId,
                logo_path: logoPath,
                primary_color: primaryColor,
                accent_color: accentColor,
                font_family: fontFamily,
              },
              { onConflict: "workspace_id" },
            )
            .select("logo_path, primary_color, accent_color, font_family")
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data: { ...(await present(data)), canManage: true } });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
