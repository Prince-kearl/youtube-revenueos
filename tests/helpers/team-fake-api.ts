// Runs the real Team Management route handlers against an in-memory database. Every outside
// call — Supabase auth, PostgREST and the invite email endpoint — is answered here, so a test
// can state who is calling and what the world looks like, then inspect exactly what was written
// and what left the server.
//
// Import this module BEFORE the route module: it installs the environment the server code reads.

export const SUPABASE = "https://testref.supabase.co";
const ANON_KEY = "anon-key";
const SERVICE_KEY = "service-key";
(globalThis as Record<string, unknown>).__env__ = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
};

type Row = Record<string, unknown>;

export interface World {
  profiles: Row[];
  workspaces: Row[];
  workspace_members: Row[];
  subscriptions: Row[];
  features: Row[];
  role_feature_access: Row[];
  notifications: Row[];
  /** Tables whose reads fail with a database error. */
  failingReads?: string[];
  /** How the invite email endpoint answers (default 200). */
  inviteStatus?: number;
}

export interface Recorded {
  method: string;
  table: string;
  /** "service" when the request carried the service-role key, "user" for a member's session. */
  as: "service" | "user";
  body: unknown;
}

export interface CallResult {
  status: number;
  body: Record<string, unknown>;
  /** The raw response text — for asserting that a value appears nowhere in it. */
  text: string;
  /** Every database write attempted, in order. */
  writes: Recorded[];
  /** Every database read, in order. */
  reads: Recorded[];
  /** Addresses an invitation email was requested for. */
  invitesSent: string[];
}

let nextId = 1;
export function uuid(): string {
  return `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
}

const TEAM_FEATURE = "feature-team";

/** A world with the "team" feature switched on and nothing else. */
export function emptyWorld(): World {
  return {
    profiles: [],
    workspaces: [],
    workspace_members: [],
    subscriptions: [],
    features: [{ id: TEAM_FEATURE, key: "team", is_active: true }],
    role_feature_access: [],
    notifications: [],
  };
}

export function addUser(world: World, email: string, platformRole = "user"): string {
  const id = uuid();
  world.profiles.push({ id, email, role: platformRole, name: email.split("@")[0], avatar: null });
  return id;
}

export function addWorkspace(world: World, ownerId: string): string {
  const id = uuid();
  world.workspaces.push({ id, owner_id: ownerId, name: "Workspace" });
  addMember(world, id, ownerId, "owner");
  return id;
}

export function addMember(
  world: World,
  workspaceId: string,
  userId: string | null,
  role: string,
  extra: Row = {},
): string {
  const id = uuid();
  const profile = world.profiles.find((p) => p.id === userId);
  world.workspace_members.push({
    id,
    workspace_id: workspaceId,
    user_id: userId,
    invited_email: profile?.email ?? `pending-${id}@x.test`,
    role,
    status: userId ? "active" : "invited",
    lead_share: 0,
    commission: 0,
    job_title: null,
    cost_amount: 0,
    invited_by: null,
    created_at: new Date(2026, 0, nextId).toISOString(),
    ...extra,
  });
  return id;
}

export function addSubscription(
  world: World,
  userId: string,
  planId: string,
  status = "active",
  createdAt = "2026-09-01T00:00:00Z",
): void {
  world.subscriptions.push({
    id: uuid(),
    user_id: userId,
    plan_id: planId,
    status,
    created_at: createdAt,
  });
}

export const member = (world: World, id: string): Row =>
  world.workspace_members.find((m) => m.id === id)!;

// ---------- a small PostgREST ----------

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(column)) continue;
    const dot = expression.indexOf(".");
    const operator = expression.slice(0, dot);
    const operand = expression.slice(dot + 1);
    const actual = row[column] === null || row[column] === undefined ? null : String(row[column]);
    if (operator === "eq") {
      if (actual !== operand) return false;
    } else if (operator === "neq") {
      if (actual === operand) return false;
    } else if (operator === "in") {
      const options = operand
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((v) => v.replace(/^"|"$/g, ""));
      if (actual === null || !options.includes(actual)) return false;
    } else {
      throw new Error(`team-fake-api: unsupported filter ${column}=${expression}`);
    }
  }
  return true;
}

function ordered(rows: Row[], params: URLSearchParams): Row[] {
  const order = params.get("order");
  let result = [...rows];
  if (order) {
    const [column, direction] = order.split(".");
    result.sort((a, b) => String(a[column] ?? "").localeCompare(String(b[column] ?? "")));
    if (direction === "desc") result.reverse();
  }
  const limit = params.get("limit");
  if (limit) result = result.slice(0, Number(limit));
  return result;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

type Handler = (ctx: { request: Request }) => Promise<Response>;

/**
 * Calls one Team API handler as `as` (a user id, or null for a signed-out request).
 * `world` is mutated by writes, so a test can read the database afterwards.
 */
export async function callTeamApi(
  route: { Route: unknown },
  world: World,
  options: {
    as: string | null;
    method: "GET" | "POST" | "PATCH" | "DELETE";
    query?: string;
    body?: unknown;
  },
): Promise<CallResult> {
  const writes: Recorded[] = [];
  const reads: Recorded[] = [];
  const invitesSent: string[] = [];
  const actor = world.profiles.find((p) => p.id === options.as) ?? null;
  const authUser = (p: Row) => ({
    id: p.id,
    aud: "authenticated",
    role: "authenticated",
    email: p.email,
    last_sign_in_at: "2026-09-01T00:00:00Z",
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    if (url.origin !== SUPABASE) throw new Error(`unexpected request in test: ${method} ${url}`);

    if (url.pathname === "/auth/v1/user")
      return actor ? json(authUser(actor)) : json({ message: "invalid JWT" }, 401);
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      const profile = world.profiles.find((p) => p.id === url.pathname.split("/").pop());
      return profile ? json(authUser(profile)) : json({ message: "not found" }, 404);
    }
    if (url.pathname === "/auth/v1/invite") {
      const raw = init?.body ?? (request ? await request.clone().text() : "{}");
      const email = String((JSON.parse(String(raw)) as { email?: string }).email);
      if ((world.inviteStatus ?? 200) !== 200) return json({ msg: "nope" }, world.inviteStatus);
      invitesSent.push(email);
      return json({ id: uuid(), email });
    }

    if (!url.pathname.startsWith("/rest/v1/"))
      throw new Error(`unexpected request in test: ${method} ${url.pathname}`);
    const table = url.pathname.slice("/rest/v1/".length) as keyof World;
    const rows = world[table] as Row[] | undefined;
    if (!Array.isArray(rows)) throw new Error(`team-fake-api: unknown table ${String(table)}`);
    const as = headers.get("apikey") === SERVICE_KEY ? "service" : "user";
    const wantsObject = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
    const prefer = headers.get("Prefer") ?? "";
    const shape = (result: Row[], status = 200) => {
      if (!wantsObject) return json(result, status);
      if (result.length === 1) return json(result[0], status);
      return json({ code: "PGRST116", message: "not exactly one row", details: "" }, 406);
    };
    const raw =
      init?.body ??
      (request && method !== "GET" && method !== "HEAD" ? await request.clone().text() : null);
    const body = raw ? JSON.parse(String(raw)) : null;

    if (method === "GET" || method === "HEAD") {
      reads.push({ method, table, as, body: url.search });
      if (world.failingReads?.includes(table))
        return json({ code: "XX000", message: "database unavailable" }, 500);
      let found = ordered(
        rows.filter((row) => matches(row, url.searchParams)),
        url.searchParams,
      );
      if (
        table === "workspace_members" &&
        (url.searchParams.get("select") ?? "").includes("member:")
      )
        found = found.map((row) => {
          const p = world.profiles.find((profile) => profile.id === row.user_id);
          return { ...row, member: p ? { name: p.name, email: p.email, avatar: p.avatar } : null };
        });
      if (method === "HEAD")
        return new Response(null, {
          status: 200,
          headers: { "Content-Range": `*/${found.length}` },
        });
      return shape(found);
    }

    writes.push({ method, table, as, body });
    if (method === "POST") {
      const incoming = (Array.isArray(body) ? body : [body]) as Row[];
      const saved: Row[] = [];
      for (const row of incoming) {
        const existing = row.id ? rows.find((r) => r.id === row.id) : undefined;
        if (existing && prefer.includes("resolution=merge-duplicates")) {
          Object.assign(existing, row);
          saved.push(existing);
          continue;
        }
        if (
          table === "workspace_members" &&
          row.status === "invited" &&
          rows.some(
            (r) =>
              r.workspace_id === row.workspace_id &&
              r.invited_email === row.invited_email &&
              r.status === "invited",
          )
        )
          return json({ code: "23505", message: "duplicate key" }, 409);
        const created = { ...row, id: row.id ?? uuid(), created_at: new Date().toISOString() };
        rows.push(created);
        saved.push(created);
      }
      return prefer.includes("return=representation") ? shape(saved, 201) : json(null, 201);
    }
    const targets = rows.filter((row) => matches(row, url.searchParams));
    if (method === "PATCH") {
      for (const row of targets) Object.assign(row, body as Row);
      return prefer.includes("return=representation") ? shape(targets) : json(null, 204);
    }
    if (method === "DELETE") {
      for (const row of targets) rows.splice(rows.indexOf(row), 1);
      return json(null, 204);
    }
    throw new Error(`team-fake-api: unsupported method ${method}`);
  }) as typeof fetch;

  const consoles = { error: console.error, warn: console.warn };
  console.error = () => {};
  console.warn = () => {};
  try {
    const headers: Record<string, string> = {};
    if (actor) {
      const session = {
        access_token: "session-token",
        refresh_token: "session-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: authUser(actor),
      };
      headers.Cookie = `sb-testref-auth-token=${encodeURIComponent(
        `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      )}`;
    }
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const handlers = (route.Route as { options: { server: { handlers: Record<string, Handler> } } })
      .options.server.handlers;
    const response = await handlers[options.method]({
      request: new Request(`https://app.test/api/workspace/members${options.query ?? ""}`, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }
    // Let fire-and-forget work (the "teammate joined" notification) land before the test reads.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { status: response.status, body, text, writes, reads, invitesSent };
  } finally {
    globalThis.fetch = realFetch;
    console.error = consoles.error;
    console.warn = consoles.warn;
  }
}
