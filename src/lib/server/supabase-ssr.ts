import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireServerEnv } from "./env";
import { parseCookies } from "./cookies";

interface SessionClient {
  client: SupabaseClient;
  setCookieHeaders: string[];
}

// Cookie-bound Supabase client — required whenever the current user must be identified from a
// plain top-level browser navigation (e.g. the Google OAuth redirect/callback), where the
// frontend cannot attach an Authorization header the way it can for a fetch() call.
export function createSessionSupabaseClient(request: Request): SessionClient {
  const setCookieHeaders: string[] = [];
  const client = createServerClient(
    requireServerEnv("SUPABASE_URL"),
    requireServerEnv("SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll: () => parseCookies(request),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            const segments = [
              `${name}=${value}`,
              `Path=${options?.path ?? "/"}`,
              `SameSite=${options?.sameSite ?? "Lax"}`,
            ];
            if (options?.maxAge !== undefined) segments.push(`Max-Age=${options.maxAge}`);
            if (options?.httpOnly !== false) segments.push("HttpOnly");
            if (options?.secure) segments.push("Secure");
            setCookieHeaders.push(segments.join("; "));
          }
        },
      },
    },
  );
  return { client, setCookieHeaders };
}

export async function requireSessionUser(
  request: Request,
): Promise<{ client: SupabaseClient; user: User; setCookieHeaders: string[] }> {
  const { client, setCookieHeaders } = createSessionSupabaseClient(request);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return { client, user: data.user, setCookieHeaders };
}

export function applySetCookies(response: Response, setCookieHeaders: string[]): Response {
  for (const cookie of setCookieHeaders) response.headers.append("Set-Cookie", cookie);
  return response;
}

// Real server-side authorization for Superadmin-only routes — the admin console itself has no
// gating (the "Preview as role" switcher in DashboardLayout is a client-side UX simulation, not
// auth), so every admin-write endpoint must check this independently rather than trust that the
// request only came from someone who could see the admin UI.
//
// 'admin' is accepted alongside 'superadmin' only as a defensive fallback for a profile row that
// somehow still carries the pre-RBAC legacy value (see 202609130002_rbac_data.sql, which promotes
// every existing 'admin' row to 'superadmin') — no code should ever newly assign 'admin' again.
// Kept as `requireAdminUser` (not renamed) since ~15 existing admin API routes already call it;
// `requireSuperadmin` is the same function under the clearer name for new code.
export async function requireAdminUser(
  request: Request,
): Promise<{ client: SupabaseClient; user: User; setCookieHeaders: string[] }> {
  const session = await requireSessionUser(request);
  const { data: profile, error } = await session.client
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error || (profile?.role !== "admin" && profile?.role !== "superadmin")) {
    throw new Response(JSON.stringify({ error: "ADMIN_REQUIRED" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

export const requireSuperadmin = requireAdminUser;
