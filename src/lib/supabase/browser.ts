import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;

// Cookie-backed (not localStorage) so server routes — e.g. the YouTube OAuth callback — can read
// the same session via the Cookie header without the frontend needing to forward tokens itself.
export function getSupabaseBrowserClient() {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
    }
    // PKCE (not the implicit/hash flow) so the auth code survives the redirect through Google/
    // email links and can be exchanged explicitly in /auth/callback — required for cookie storage.
    client = createBrowserClient(url, key, { auth: { flowType: "pkce" } });
  }
  return client;
}
