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
  // Tables the revenue-visibility tests add. Created empty on first use.
  deals?: Row[];
  leads?: Row[];
  videos?: Row[];
  youtube_channels?: Row[];
  youtube_sync_state?: Row[];
  channel_daily_stats?: Row[];
  video_daily_stats?: Row[];
  // Tables the click-attribution tests add.
  destinations?: Row[];
  tracking_links?: Row[];
  link_click_events?: Row[];
  tracking_link_stats?: Row[];
  // Tables the admin and lead opt-in tests add.
  admin_audit_log?: Row[];
  lead_magnets?: Row[];
  lead_messages?: Row[];
  lead_magnet_optins?: Row[];
  // Tables the public-endpoint rate-limit tests add.
  support_tickets?: Row[];
  referral_clicks?: Row[];
  workspace_branding?: Row[];
  // The brand-deal attribution tests add.
  deal_videos?: Row[];
  // The video-detail channel tests add.
  youtube_connections?: Row[];
  /** Answers a request to anything other than Supabase (the YouTube APIs…). Return undefined to
   * fail the test with "unexpected request". */
  external?: (url: URL, init: { method: string; headers: Headers }) => Response | undefined;
  /** Per table: inserts into it are refused by the database with this SQLSTATE (a trigger's
   * 23514, a foreign key's 23503…), as PostgREST reports it. */
  refuseWrites?: Record<string, string>;
  /** The rate-limit counters, as public.consume_rate_limit keeps them. */
  rate_limit_buckets?: Row[];
  /** The database clock for the rate-limit functions (ms); defaults to the real one. */
  nowMs?: number;
  /** The rate-limit functions fail with a database error. */
  failRateLimit?: boolean;
  /** Tables whose reads fail with a database error. */
  failingReads?: string[];
  /**
   * Behave like the database AFTER the column-privacy migrations: a request made with a member's
   * session that names a money column (in its select, a filter or an order — or selects
   * everything), or that writes to a table members may no longer write, is refused with a
   * permission error, exactly as Postgres does. The service role is unaffected. Lets a test
   * prove the application never reads money, or writes deals, on a member's session.
   */
  protectMoney?: boolean;
  /** The API's own cap on rows per response (Supabase's "max rows"). A read that asks for more
   * gets this many and no indication that more exist. */
  maxRows?: number;
  /** Apply `maxRows` only to requests made with the service role. */
  maxRowsServiceOnly?: boolean;
  /** Treat ILIKE escapes as if they were not there, so `\_` matches any character again. Only
   * for proving that code does not depend on escaping alone. */
  looseIlike?: boolean;
  /** Per table: reads of it fail with a database error once this many have succeeded. */
  failReadsAfter?: Record<string, number>;
  /** How the invite email endpoint answers (default 200). */
  inviteStatus?: number;
  /**
   * The Auth (sign-in) email per user id, when it differs from the profile's — a profile email
   * its owner rewrote, or a stale one. null: the profile has no Auth account at all. Accounts not
   * listed sign in with their profile email.
   */
  authEmails?: Record<string, string | null>;
  /** Force the user id a generated sign-in link is issued for (to simulate a mismatch). */
  generateLinkUserId?: string;
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
  /** Member-session requests the database refused for naming a money column (protectMoney). */
  refusedMoneyReads: string[];
  /** Account-level actions requested of the auth service: sign-in links, password resets and
   * user updates (bans), as "<METHOD> <path>". */
  authActions: string[];
  /** The address each sign-in link or password-reset email was requested for, in order. */
  authRecipients: string[];
  /** Database functions called, in order, as "<name>" (rate-limit counters, click counters). */
  rpcCalls: string[];
  /** The response's own headers (Location, Set-Cookie, Retry-After…). */
  headers: Headers;
  /** What the route logged with console.warn / console.error, one entry per call. */
  logs: unknown[][];
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

const OPTIONAL_TABLES = [
  "deals",
  "leads",
  "videos",
  "youtube_channels",
  "youtube_sync_state",
  "channel_daily_stats",
  "video_daily_stats",
  "destinations",
  "tracking_links",
  "link_click_events",
  "tracking_link_stats",
  "admin_audit_log",
  "lead_magnets",
  "lead_messages",
  "lead_magnet_optins",
  "support_tickets",
  "referral_clicks",
  "workspace_branding",
  "deal_videos",
  "youtube_connections",
];

/** The columns the migrations withhold from the member-facing database role. */
export const MONEY_COLUMNS: Record<string, string[]> = {
  channel_daily_stats: ["estimated_revenue_usd", "ad_revenue_usd", "premium_revenue_usd"],
  video_daily_stats: ["estimated_revenue_usd", "ad_revenue_usd", "premium_revenue_usd"],
  deals: ["value"],
  workspace_members: ["lead_share", "commission", "cost_amount"],
};

const RESERVED_PARAMS = ["select", "order", "limit", "offset", "on_conflict", "columns"];

/** Tables the migrations leave no member-facing write privilege on. */
export const MEMBER_READ_ONLY_TABLES = [
  "deals",
  "channel_daily_stats",
  "video_daily_stats",
  "workspaces",
  "workspace_members",
  "deal_videos",
];

/** Whether a request names a withheld column of `table` anywhere Postgres would check it. */
function touchesMoney(table: string, params: URLSearchParams, returnsRows: boolean): boolean {
  const money = MONEY_COLUMNS[table];
  if (!money) return false;
  const select = params.get("select");
  // No column list (or *) on a request that returns rows means every column.
  if (returnsRows && (!select || select.split(",").some((c) => c.trim() === "*"))) return true;
  const named = [
    ...(select ?? "").split(/[,()]/).map((c) => c.trim().split(":").pop() ?? ""),
    ...(params.get("order") ?? "").split(",").map((c) => c.split(".")[0]),
    ...[...params.keys()].filter((key) => !RESERVED_PARAMS.includes(key)),
  ];
  return named.some((column) => money.includes(column));
}

/** Only the requested columns, as PostgREST returns them. A select with an embed is left whole. */
function project(rows: Row[], params: URLSearchParams): Row[] {
  const select = params.get("select");
  if (!select || /[*(]/.test(select)) return rows;
  const columns = select.split(",").map((c) => c.trim());
  return rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? null])));
}

let looseIlikeEscapes = false;

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, expression] of params) {
    if (RESERVED_PARAMS.includes(column)) continue;
    if (expression === "not.is.null") {
      if (row[column] === null || row[column] === undefined) return false;
      continue;
    }
    if (expression === "is.null") {
      if (row[column] !== null && row[column] !== undefined) return false;
      continue;
    }
    const dot = expression.indexOf(".");
    const operator = expression.slice(0, dot);
    const operand = expression.slice(dot + 1);
    const actual = row[column] === null || row[column] === undefined ? null : String(row[column]);
    if (operator === "eq") {
      if (actual !== operand) return false;
    } else if (operator === "neq") {
      if (actual === operand) return false;
    } else if (operator === "gte") {
      if (actual === null || actual < operand) return false;
    } else if (operator === "lte") {
      if (actual === null || actual > operand) return false;
    } else if (operator === "ilike") {
      const pattern = looseIlikeEscapes ? operand.replace(/\\/g, "") : operand;
      if (actual === null || !ilike(actual, pattern)) return false;
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

/** ILIKE as the real API evaluates it: `%` (or `*`) is any run of characters, `_` any single
 * character, a backslash makes the next character literal, and letter case is ignored. */
function ilike(value: string, pattern: string): boolean {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "\\" && index + 1 < pattern.length) {
      source += pattern[++index].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (character === "%" || character === "*") source += ".*";
    else if (character === "_") source += ".";
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "is").test(value);
}

function ordered(rows: Row[], params: URLSearchParams): Row[] {
  const order = params.get("order");
  let result = [...rows];
  if (order) {
    const keys = order.split(",").map((part) => part.split("."));
    result.sort((a, b) => {
      for (const [column, direction] of keys) {
        const diff = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
        if (diff !== 0) return direction === "desc" ? -diff : diff;
      }
      return 0;
    });
  }
  const offset = params.get("offset");
  if (offset) result = result.slice(Number(offset));
  const limit = params.get("limit");
  if (limit) result = result.slice(0, Number(limit));
  return result;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>;

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
    /** The API path the route is mounted at (default: the Team members API). */
    path?: string;
    body?: unknown;
    /** Extra request headers (client address headers, cookies…). */
    headers?: Record<string, string>;
    /** Route params, for routes like /r/$slug. */
    params?: Record<string, string>;
  },
): Promise<CallResult> {
  const writes: Recorded[] = [];
  const reads: Recorded[] = [];
  const invitesSent: string[] = [];
  const refusedMoneyReads: string[] = [];
  looseIlikeEscapes = world.looseIlike === true;
  const authActions: string[] = [];
  const authRecipients: string[] = [];
  const rpcCalls: string[] = [];
  const logs: unknown[][] = [];
  const actor = world.profiles.find((p) => p.id === options.as) ?? null;
  const authEmailOf = (p: Row) =>
    world.authEmails && String(p.id) in world.authEmails
      ? world.authEmails[String(p.id)]
      : (p.email as string);
  const authUser = (p: Row) => ({
    id: p.id,
    aud: "authenticated",
    role: "authenticated",
    email: authEmailOf(p),
    last_sign_in_at: "2026-09-01T00:00:00Z",
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    if (url.origin !== SUPABASE) {
      const answer = world.external?.(url, { method, headers });
      if (answer) return answer;
      throw new Error(`unexpected request in test: ${method} ${url}`);
    }

    if (url.pathname === "/auth/v1/user")
      return actor ? json(authUser(actor)) : json({ message: "invalid JWT" }, 401);
    if (url.pathname === "/auth/v1/admin/generate_link" || url.pathname === "/auth/v1/recover") {
      authActions.push(`${method} ${url.pathname}`);
      const rawAuth = init?.body ?? (request ? await request.clone().text() : "{}");
      const recipient = String((JSON.parse(String(rawAuth || "{}")) as { email?: string }).email);
      authRecipients.push(recipient);
      // Auth issues a link for the account that signs in with that address.
      const owner = world.profiles.find(
        (p) =>
          authEmailOf(p) !== null &&
          String(authEmailOf(p)).toLowerCase() === recipient.toLowerCase(),
      );
      return url.pathname === "/auth/v1/recover"
        ? json({})
        : json({
            id: world.generateLinkUserId ?? owner?.id ?? uuid(),
            email: recipient,
            action_link: "https://supabase.test/auth/v1/verify?token=test-token",
            email_otp: "000000",
            hashed_token: "hashed",
            redirect_to: "",
            verification_type: "magiclink",
          });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      if (method !== "GET") authActions.push(`${method} ${url.pathname}`);
      const profile = world.profiles.find((p) => p.id === url.pathname.split("/").pop());
      return profile && authEmailOf(profile) !== null
        ? json(authUser(profile))
        : json({ message: "not found" }, 404);
    }
    if (url.pathname === "/auth/v1/invite") {
      const raw = init?.body ?? (request ? await request.clone().text() : "{}");
      const email = String((JSON.parse(String(raw)) as { email?: string }).email);
      if ((world.inviteStatus ?? 200) !== 200) return json({ msg: "nope" }, world.inviteStatus);
      invitesSent.push(email);
      return json({ id: uuid(), email });
    }

    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      const rawArgs = init?.body ?? (request ? await request.clone().text() : "{}");
      const args = JSON.parse(String(rawArgs || "{}")) as Record<string, unknown>;
      rpcCalls.push(name);
      // Every function here is executable by the service role only, as the migrations leave it.
      if (headers.get("apikey") !== SERVICE_KEY)
        return json({ code: "42501", message: `permission denied for function ${name}` }, 403);
      const now = world.nowMs ?? Date.now();
      if (name === "consume_rate_limit") {
        if (world.failRateLimit) return json({ code: "XX000", message: "unavailable" }, 500);
        const windowSeconds = Number(args.p_window_seconds);
        const limit = Number(args.p_limit);
        const key = args.p_key;
        if (
          typeof key !== "string" ||
          key.length < 1 ||
          key.length > 200 ||
          !(windowSeconds >= 1 && windowSeconds <= 86400) ||
          !(limit >= 1 && limit <= 1_000_000)
        )
          return json({ code: "22023", message: "invalid rate limit parameter" }, 400);
        const buckets = (world.rate_limit_buckets ??= []);
        const windowStart = Math.floor(now / 1000 / windowSeconds) * windowSeconds;
        let bucket = buckets.find((b) => b.bucket_key === key && b.window_start === windowStart);
        if (!bucket) {
          bucket = {
            bucket_key: key,
            window_start: windowStart,
            hits: 0,
            expires_at: (windowStart + windowSeconds * 2) * 1000,
          };
          buckets.push(bucket);
        }
        bucket.hits = (bucket.hits as number) + 1;
        return json((bucket.hits as number) <= limit);
      }
      if (name === "purge_rate_limit_buckets") {
        if (world.failRateLimit) return json({ code: "XX000", message: "unavailable" }, 500);
        const buckets = (world.rate_limit_buckets ??= []);
        const expired = buckets
          .filter((b) => (b.expires_at as number) < now)
          .slice(0, Number(args.p_max_rows ?? 5000));
        for (const b of expired) buckets.splice(buckets.indexOf(b), 1);
        return json(expired.length);
      }
      if (name === "increment_link_clicks") {
        const link = (world.tracking_links ?? []).find((l) => l.id === args.p_link_id);
        if (link) link.clicks = Number(link.clicks ?? 0) + 1;
        return json(null, 204);
      }
      if (name === "increment_lead_magnet_views") {
        const magnet = (world.lead_magnets ?? []).find((m) => m.id === args.p_lead_magnet_id);
        if (magnet) magnet.views = Number(magnet.views ?? 0) + 1;
        return json(null, 204);
      }
      throw new Error(`team-fake-api: unknown function ${name}`);
    }

    if (!url.pathname.startsWith("/rest/v1/"))
      throw new Error(`unexpected request in test: ${method} ${url.pathname}`);
    const table = url.pathname.slice("/rest/v1/".length) as keyof World;
    if (OPTIONAL_TABLES.includes(table)) (world as unknown as Record<string, Row[]>)[table] ??= [];
    const rows = world[table] as Row[] | undefined;
    if (!Array.isArray(rows)) throw new Error(`team-fake-api: unknown table ${String(table)}`);
    const as = headers.get("apikey") === SERVICE_KEY ? "service" : "user";
    const wantsObject = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");
    const prefer = headers.get("Prefer") ?? "";
    const returnsRows =
      method === "GET" || method === "HEAD" || prefer.includes("return=representation");
    const memberWrite =
      method !== "GET" && method !== "HEAD" && MEMBER_READ_ONLY_TABLES.includes(String(table));
    if (
      world.protectMoney &&
      as === "user" &&
      (memberWrite || touchesMoney(String(table), url.searchParams, returnsRows))
    ) {
      refusedMoneyReads.push(`${method} ${String(table)}${url.search}`);
      return json({ code: "42501", message: `permission denied for table ${String(table)}` }, 403);
    }
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
      const allowed = world.failReadsAfter?.[table];
      if (allowed !== undefined && reads.filter((read) => read.table === table).length > allowed)
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
      // alias:table(columns), or alias:table!foreign_key(columns).
      const embeds = [
        ...(url.searchParams.get("select") ?? "").matchAll(/(\w+):(\w+)(?:!(\w+))?\(([^)]*)\)/g),
      ].filter(([, alias]) => alias !== "member");
      if (embeds.length > 0)
        found = found.map((row) => {
          const withEmbeds = { ...row };
          for (const [, alias, embedded, foreignKeyColumn] of embeds) {
            const foreignKey = row[foreignKeyColumn ?? `${alias}_id`];
            const target = (world as unknown as Record<string, Row[] | undefined>)[embedded];
            withEmbeds[alias] =
              foreignKey === null || foreignKey === undefined
                ? null
                : (target?.find((candidate) => candidate.id === foreignKey) ?? null);
          }
          return withEmbeds;
        });
      if (world.maxRows && (!world.maxRowsServiceOnly || as === "service"))
        found = found.slice(0, world.maxRows);
      return shape(project(found, url.searchParams));
    }

    writes.push({ method, table, as, body });
    if (method === "POST" && world.refuseWrites?.[table])
      return json({ code: world.refuseWrites[table], message: "refused by the database" }, 400);
    if (method === "POST") {
      const incoming = (Array.isArray(body) ? body : [body]) as Row[];
      const saved: Row[] = [];
      // ?on_conflict=<columns>: an upsert matched on those columns (a unique constraint), as
      // PostgREST does — merged, ignored, or a unique violation without a resolution.
      const conflict = url.searchParams.get("on_conflict")?.split(",").filter(Boolean) ?? [];
      for (const row of incoming) {
        if (conflict.length > 0) {
          const match = rows.find((r) => conflict.every((column) => r[column] === row[column]));
          if (match) {
            if (prefer.includes("resolution=merge-duplicates")) {
              Object.assign(match, row);
              saved.push(match);
              continue;
            }
            if (prefer.includes("resolution=ignore-duplicates")) continue;
            return json({ code: "23505", message: "duplicate key" }, 409);
          }
        }
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
        if (
          table === "referral_clicks" &&
          prefer.includes("resolution=ignore-duplicates") &&
          rows.some((r) => r.referrer_id === row.referrer_id && r.privacy_id === row.privacy_id)
        )
          continue;
        // deal_videos: primary key (deal_id, video_id); a repeat is skipped when the request
        // asks to ignore duplicates, and is a unique violation otherwise.
        if (
          table === "deal_videos" &&
          rows.some((r) => r.deal_id === row.deal_id && r.video_id === row.video_id)
        ) {
          if (prefer.includes("resolution=ignore-duplicates")) continue;
          return json({ code: "23505", message: "duplicate key" }, 409);
        }
        if (table === "deal_videos") {
          // No id column; created_at as the database default would set it, with microseconds.
          const now = new Date().toISOString().replace("Z", "000+00:00");
          const created = { ...row, created_at: now };
          rows.push(created);
          saved.push(created);
          continue;
        }
        const created = { ...row, id: row.id ?? uuid(), created_at: new Date().toISOString() };
        rows.push(created);
        saved.push(created);
      }
      return prefer.includes("return=representation")
        ? shape(project(saved, url.searchParams), 201)
        : json(null, 201);
    }
    const targets = rows.filter((row) => matches(row, url.searchParams));
    if (method === "PATCH") {
      for (const row of targets) Object.assign(row, body as Row);
      return prefer.includes("return=representation")
        ? shape(project(targets, url.searchParams))
        : json(null, 204);
    }
    if (method === "DELETE") {
      for (const row of targets) rows.splice(rows.indexOf(row), 1);
      // Like PostgREST: the deleted rows come back only when they were asked for.
      return prefer.includes("return=representation")
        ? shape(project(targets, url.searchParams))
        : json(null, 204);
    }
    throw new Error(`team-fake-api: unsupported method ${method}`);
  }) as typeof fetch;

  const consoles = { error: console.error, warn: console.warn };
  console.error = (...entry: unknown[]) => void logs.push(entry);
  console.warn = (...entry: unknown[]) => void logs.push(entry);
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
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      // A test cookie is added to the session cookie, not put in its place.
      if (name.toLowerCase() === "cookie" && headers.Cookie) headers.Cookie += `; ${value}`;
      else headers[name.toLowerCase() === "cookie" ? "Cookie" : name] = value;
    }
    const handlers = (route.Route as { options: { server: { handlers: Record<string, Handler> } } })
      .options.server.handlers;
    const response = await handlers[options.method]({
      request: new Request(
        `https://app.test${options.path ?? "/api/workspace/members"}${options.query ?? ""}`,
        {
          method: options.method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        },
      ),
      params: options.params ?? {},
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
    return {
      status: response.status,
      body,
      text,
      writes,
      reads,
      invitesSent,
      refusedMoneyReads,
      authActions,
      authRecipients,
      rpcCalls,
      headers: response.headers,
      logs,
    };
  } finally {
    globalThis.fetch = realFetch;
    console.error = consoles.error;
    console.warn = consoles.warn;
  }
}
