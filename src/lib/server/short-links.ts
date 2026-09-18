import type { SupabaseClient } from "@supabase/supabase-js";

// Every /r/$slug redirect is host-agnostic (it matches on slug alone — see r.$slug.ts), so once a
// workspace's custom domain is verified we can safely hand out https://<domain>/r/<slug> instead
// of the app's own origin, and it works the moment the creator finishes pointing DNS/hosting at us.
export async function resolveLinkOrigin(
  client: SupabaseClient,
  workspaceId: string,
  requestOrigin: string,
): Promise<string> {
  const { data } = await client
    .from("workspaces")
    .select("custom_domain, custom_domain_verified_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (data?.custom_domain && data.custom_domain_verified_at) {
    return `https://${data.custom_domain}`;
  }
  return requestOrigin;
}

export function buildShortUrl(origin: string, slug: string): string {
  return `${origin}/r/${slug}`;
}
