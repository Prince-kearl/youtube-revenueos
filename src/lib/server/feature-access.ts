import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSessionUser } from "./supabase-ssr";
import { toAppRole, type AppRole } from "./roles";

export type { AppRole };

export interface FeatureRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  navigation_label: string | null;
  route: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  is_system_feature: boolean;
}

// Fail-open by design: a feature with no role_feature_access row for a given role (e.g. one
// added after a role existed, or before this migration seeded overrides) defaults to enabled
// rather than silently disappearing — matches "do not accidentally hide every feature" from the
// spec this was built against. Superadmins can then explicitly turn it off if they want to.
export async function getFeatureAccessForRole(
  client: SupabaseClient,
  role: AppRole,
): Promise<Record<string, boolean>> {
  const { data: features } = await client
    .from("features")
    .select("id, key, is_active")
    .eq("is_active", true);
  if (!features?.length) return {};

  const { data: overrides } = await client
    .from("role_feature_access")
    .select("feature_id, enabled")
    .eq("role", role)
    .in(
      "feature_id",
      features.map((f) => f.id),
    );
  const overrideByFeature = new Map((overrides ?? []).map((o) => [o.feature_id, o.enabled]));

  const map: Record<string, boolean> = {};
  for (const feature of features) {
    map[feature.key] = overrideByFeature.get(feature.id) ?? true;
  }
  return map;
}

// Real server-side enforcement for feature-gated routes/APIs — the client-side nav hiding in
// DashboardLayout is UX only. Throws a 403 Response (matching requireAdminUser's pattern) rather
// than returning a boolean, so every caller fails closed by default unless it explicitly handles
// the feature being enabled.
export async function requireFeatureEnabled(
  request: Request,
  featureKey: string,
): Promise<{
  client: SupabaseClient;
  user: Awaited<ReturnType<typeof requireSessionUser>>["user"];
  role: AppRole;
  setCookieHeaders: string[];
}> {
  const { client, user, setCookieHeaders } = await requireSessionUser(request);
  const { data: profile } = await client
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role: AppRole = toAppRole(profile?.role as string | undefined);

  const { data: feature } = await client
    .from("features")
    .select("id, is_active")
    .eq("key", featureKey)
    .maybeSingle();
  // A feature key with no registry row, or marked inactive platform-wide, is unknown/unavailable
  // to everyone regardless of role.
  if (!feature || !feature.is_active) {
    throw new Response(JSON.stringify({ error: "FEATURE_UNAVAILABLE" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: override } = await client
    .from("role_feature_access")
    .select("enabled")
    .eq("role", role)
    .eq("feature_id", feature.id)
    .maybeSingle();
  const enabled = override?.enabled ?? true;
  if (!enabled) {
    throw new Response(JSON.stringify({ error: "FEATURE_DISABLED" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { client, user, role, setCookieHeaders };
}
