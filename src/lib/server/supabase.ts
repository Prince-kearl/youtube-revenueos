import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getServerEnv, requireServerEnv } from "./env";

export function createRequestSupabaseClient(request: Request): SupabaseClient {
  const url = requireServerEnv("SUPABASE_URL");
  const key = requireServerEnv("SUPABASE_ANON_KEY");
  const authorization = request.headers.get("Authorization");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: authorization ? { headers: { Authorization: authorization } } : undefined,
  });
}

export function createServiceSupabaseClient(): SupabaseClient {
  return createClient(
    requireServerEnv("SUPABASE_URL"),
    requireServerEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function requireUser(request: Request): Promise<{ client: SupabaseClient; user: User }> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const client = createRequestSupabaseClient(request);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: "INVALID_SESSION" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return { client, user: data.user };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(getServerEnv("SUPABASE_URL") && getServerEnv("SUPABASE_ANON_KEY"));
}
