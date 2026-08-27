import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireSessionUser } from "@/lib/server/supabase-ssr";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function metadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  avatar: z.string().trim().max(4_000_000).refine((value) => value.startsWith("data:image/") || URL.canParse(value), "Invalid avatar image").nullable().optional(),
  cover_url: z.string().trim().max(4_000_000).refine((value) => value.startsWith("data:image/") || URL.canParse(value), "Invalid cover image").nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  website: z.string().trim().url().max(1000).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
  banner_settings: z.object({
    showName: z.boolean(),
    showAvatar: z.boolean(),
    showSubscribers: z.boolean(),
    showRecentPosts: z.boolean(),
    showVisitButton: z.boolean(),
  }).optional(),
});

export const Route = createFileRoute("/api/profile")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const metadata = user.user_metadata ?? {};
          const name = metadataString(metadata.full_name) ?? metadataString(metadata.name) ?? user.email?.split("@")[0] ?? null;
          const avatar = metadataString(metadata.avatar_url) ?? metadataString(metadata.picture);
          const { data: existing, error: lookupError } = await client
            .from("profiles")
            .select("id, email, name, avatar, role, location, website, bio, cover_url, banner_settings, created_at, updated_at")
            .eq("id", user.id)
            .maybeSingle();
          if (lookupError) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          const { data: profile, error } = existing
            ? await client.from("profiles").update({ email: user.email ?? null, ...(existing.name ? {} : { name }), ...(existing.avatar ? {} : { avatar }) }).eq("id", user.id).select("id, email, name, avatar, role, location, website, bio, cover_url, banner_settings, created_at, updated_at").single()
            : await client.from("profiles").insert({ id: user.id, email: user.email ?? null, name, avatar }).select("id, email, name, avatar, role, location, website, bio, cover_url, banner_settings, created_at, updated_at").single();
          if (error || !profile) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data: profile });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      PATCH: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          const input = profileSchema.parse(await request.json());
          const { data: profile, error } = await client
            .from("profiles")
            .upsert({ id: user.id, email: user.email ?? null, ...input }, { onConflict: "id" })
            .eq("id", user.id)
            .select("id, email, name, avatar, role, location, website, bio, cover_url, banner_settings, created_at, updated_at")
            .single();
          if (error || !profile) {
            console.error("Profile update failed", error?.code ?? "NO_PROFILE", error?.message ?? "");
            return json({ error: error?.code === "42703" ? "PROFILE_MIGRATION_REQUIRED" : "DATABASE_ERROR" }, { status: 500 });
          }
          if (input.name !== undefined || input.avatar !== undefined) {
            await client.auth.updateUser({
              data: {
                ...(input.name !== undefined ? { name: input.name, full_name: input.name } : {}),
                ...(input.avatar !== undefined ? { avatar_url: input.avatar } : {}),
              },
            });
          }
          return json({ data: profile });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError) return json({ error: "VALIDATION_ERROR", fields: error.flatten().fieldErrors }, { status: 422 });
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
    },
  },
});