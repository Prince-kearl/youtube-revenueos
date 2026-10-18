// A fake Supabase for the admin Users route tests: Supabase Auth (session, admin API, password
// recovery), PostgREST tables and RPC functions. Records exactly what each handler asked for —
// which functions, which tables with which filters, what was sent to Auth and what was audited.

export const SUPABASE = "https://testref.supabase.co";
(globalThis as Record<string, unknown>).__env__ = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  APP_URL: "https://app.test",
};

export const CALLER = "bbbbbbbb-0000-4000-8000-000000000002";
export const TARGET = "cccccccc-0000-4000-8000-000000000003";

export type Row = Record<string, unknown>;
export interface Recorded {
  rpc: { name: string; args: Record<string, unknown> }[];
  rest: URL[];
  authAdmin: string[];
  generateLink: Record<string, unknown>[];
  recover: Record<string, unknown>[];
  audit: Record<string, unknown>[];
}

export function directoryRow(n: number, overrides: Row = {}): Row {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id,
    name: `User ${n}`,
    email: `user${n}@example.com`,
    avatar: null,
    role: "user",
    created_at: `2026-10-${String(10 + (n % 9)).padStart(2, "0")}T08:00:00.123456+00:00`,
    email_lower: `user${n}@example.com`,
    email_confirmed_at: "2026-10-01T00:00:00+00:00",
    banned_until: null,
    last_sign_in_at: null,
    creator_verified: false,
    ...overrides,
  };
}

export const rows = (n: number, start = 1) =>
  Array.from({ length: n }, (_, i) => directoryRow(start + i));

export interface Scenario {
  method?: "GET" | "POST";
  body?: unknown;
  callerRole?: string | null;
  signedIn?: boolean;
  listRows?: Row[];
  count?: number;
  missingFunctions?: boolean;
  /** The database refuses to read the directory (initial backfill not complete). */
  directoryIncomplete?: boolean;
  /** The target's profiles row (null: no such account). Its email is user-editable. */
  targetProfile?: Row | null;
  /** The target's Auth account (null: none). Its email is authoritative. */
  authUser?: Row | null;
  /** admin_audit_log rows returned for the detail view. */
  auditRows?: Row[];
  /** Answers for the maintenance functions. */
  rpcRows?: Record<string, Row>;
}

const DEFAULT_PROFILE: Row = {
  id: TARGET,
  name: "Target",
  email: "target@example.com",
  avatar: null,
  role: "user",
  created_at: "2026-09-01T00:00:00+00:00",
};
const DEFAULT_AUTH: Row = {
  id: TARGET,
  email: "target@example.com",
  email_confirmed_at: "2026-09-02T00:00:00Z",
  banned_until: null,
  last_sign_in_at: "2026-10-17T00:00:00Z",
  user_metadata: { creator_verified: true, secret_note: "never returned" },
  app_metadata: { provider: "google" },
};
const DEFAULT_STATUS: Row = {
  status: "backfilling",
  processed: 4000,
  inserted: 3990,
  started_at: "2026-10-18T05:00:00Z",
  completed_at: null,
  last_error_code: null,
  last_error_at: null,
  sync_failures_24h: 0,
};

export async function call(
  route: { Route: unknown },
  path: string,
  scenario: Scenario = {},
): Promise<{ status: number; body: Record<string, unknown>; recorded: Recorded }> {
  const {
    method = "GET",
    body,
    callerRole = "superadmin",
    signedIn = true,
    listRows = [],
    count = 0,
    missingFunctions = false,
    directoryIncomplete = false,
    targetProfile = DEFAULT_PROFILE,
    authUser = DEFAULT_AUTH,
    auditRows = [{ action: "user_email_verified", created_at: "2026-10-16T00:00:00Z" }],
    rpcRows = {},
  } = scenario;
  const recorded: Recorded = {
    rpc: [],
    rest: [],
    authAdmin: [],
    generateLink: [],
    recover: [],
    audit: [],
  };
  const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...extra },
    });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const verb = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    const wantsObject = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
    const bodyText =
      typeof init?.body === "string" ? init.body : request ? await request.clone().text() : "";
    const sent = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};

    if (url.origin === SUPABASE && url.pathname === "/auth/v1/user")
      return signedIn
        ? json({ id: CALLER, aud: "authenticated", role: "authenticated", email: "a@test" })
        : json({ message: "invalid JWT" }, 401);
    if (url.origin === SUPABASE && url.pathname === "/auth/v1/admin/generate_link") {
      recorded.generateLink.push(sent);
      // Shaped like Supabase Auth's answer: the user's own fields at the top level, beside the
      // link fields (supabase-js builds data.user from the rest and data.properties from these).
      return json({
        ...(authUser ?? {}),
        action_link: `https://auth.test/verify?for=${encodeURIComponent(String(sent.email))}`,
        email_otp: "000000",
        hashed_token: "hashed",
        redirect_to: "",
        verification_type: "magiclink",
      });
    }
    if (url.origin === SUPABASE && url.pathname === "/auth/v1/recover") {
      recorded.recover.push(sent);
      return json({});
    }
    if (url.origin === SUPABASE && url.pathname.startsWith("/auth/v1/admin/users/")) {
      recorded.authAdmin.push(url.pathname);
      if (!authUser) return json({ message: "User not found" }, 404);
      return json(authUser);
    }
    if (url.origin === SUPABASE && url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      recorded.rpc.push({ name, args: sent });
      if (missingFunctions)
        return json(
          { code: "PGRST202", message: `Could not find the function public.${name}` },
          404,
        );
      if (name === "admin_user_directory_status") {
        const row = rpcRows[name] ?? DEFAULT_STATUS;
        return json(wantsObject ? row : [row]);
      }
      if (
        directoryIncomplete &&
        ["admin_list_users", "admin_count_users", "admin_user_stats"].includes(name)
      )
        return json({ code: "55000", message: "admin_user_directory_incomplete" }, 500);
      if (name === "admin_list_users") return json(listRows);
      if (name === "admin_count_users") return json(count);
      if (name === "admin_user_stats") {
        const row = { total: 10, active: 7, pending: 2, banned: 1 };
        return json(wantsObject ? row : [row]);
      }
      if (rpcRows[name]) return json(wantsObject ? rpcRows[name] : [rpcRows[name]]);
      return json(wantsObject ? null : []);
    }
    if (url.origin === SUPABASE && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      if (verb === "POST" && table === "admin_audit_log") {
        recorded.audit.push(sent);
        return json([], 201);
      }
      recorded.rest.push(url);
      if (table === "profiles") {
        // The caller's own role lookup, or the target.
        if (url.searchParams.get("id") === `eq.${CALLER}`)
          return json(wantsObject ? { role: callerRole } : [{ role: callerRole }]);
        return json(wantsObject ? targetProfile : targetProfile ? [targetProfile] : []);
      }
      if (table === "workspace_members")
        return json(
          [
            {
              role: "owner",
              status: "active",
              joined_at: "2026-09-01T00:00:00Z",
              workspace_id: "ws-1",
              workspaces: { name: "Target's workspace", owner_id: TARGET },
            },
          ],
          200,
          { "Content-Range": "0-0/1" },
        );
      if (table === "subscriptions") {
        const subscription = {
          plan_id: "pro",
          status: "active",
          billing_interval: "month",
          current_period_end: "2026-11-01T00:00:00Z",
          cancel_at_period_end: false,
        };
        return json(wantsObject ? subscription : [subscription]);
      }
      if (table === "plans") return json(wantsObject ? { name: "Pro" } : [{ name: "Pro" }]);
      if (table === "youtube_channels")
        return json(
          [
            {
              id: "ch-1",
              channel_name: "Target TV",
              channel_handle: "@target",
              youtube_channel_id: "UC123",
              subscriber_count: 1200,
              connection_id: "conn-1",
              connected_at: "2026-09-03T00:00:00Z",
              last_synced_at: "2026-10-17T00:00:00Z",
              last_sync_status: "success",
            },
          ],
          200,
          { "Content-Range": "0-0/1" },
        );
      if (table === "admin_audit_log") return json(auditRows);
      return json(wantsObject ? null : []);
    }
    throw new Error(`unexpected request in test: ${verb} ${url.origin}${url.pathname}`);
  }) as typeof fetch;

  try {
    const session = {
      access_token: "session-token",
      refresh_token: "session-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: CALLER, aud: "authenticated", role: "authenticated", email: "a@test" },
    };
    const cookie = `sb-testref-auth-token=${encodeURIComponent(
      `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    )}`;
    const handlers = (
      route.Route as {
        options: {
          server: {
            handlers: Record<string, (ctx: { request: Request }) => Promise<Response>>;
          };
        };
      }
    ).options.server.handlers;
    const requestHeaders: Record<string, string> = signedIn ? { Cookie: cookie } : {};
    if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
    const response = await handlers[method]({
      request: new Request(`https://app.test${path}`, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
      recorded,
    };
  } finally {
    globalThis.fetch = realFetch;
  }
}
