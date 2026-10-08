// Runs real route handlers with every outside call answered by a programmable stub: Supabase
// auth and PostgREST, Google's token endpoint, the YouTube Data API and YouTube Analytics. Tests
// decide how Google answers and then inspect exactly what was requested and what was written.
//
// Import this module BEFORE any route module: it installs the test environment the server code
// reads at import/call time.

export const SUPABASE = "https://testref.supabase.co";
(globalThis as Record<string, unknown>).__env__ = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  // 32 zero bytes, base64 — a throwaway key for tests only.
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
};

const { encryptSecretToBytea } = await import("../../src/lib/server/crypto");
const { resetYoutubeTokenRegistry } = await import("../../src/lib/server/youtube-token-registry");

export const CHANNEL_ROW = "aaaaaaaa-0000-4000-8000-000000000001";
export const CONNECTION_ROW = "cccccccc-0000-4000-8000-000000000003";
export const USER = "bbbbbbbb-0000-4000-8000-000000000002";
export const STORED_ACCESS_TOKEN = "stored-access-token-SECRET";
export const STORED_REFRESH_TOKEN = "stored-refresh-token-SECRET";

export interface GoogleCall {
  /** "channels", "playlistItems", "videos", "reports" (Analytics) or "token". */
  resource: string;
  /** The bearer token the request carried ("" for the token endpoint). */
  bearer: string;
  metrics: string | null;
  status: number;
}

export interface DbWrite {
  method: string;
  table: string;
  body: Record<string, unknown> | Array<Record<string, unknown>> | null;
}

export interface Scenario {
  /** Whether the stored access token is still valid (true) or already expired (false). */
  tokenValid?: boolean;
  /** How Google's token endpoint answers each refresh, in order; the last entry repeats.
   * A number is an error status with `invalid_grant`; "ok" issues `refreshed-<n>`. */
  refresh?: Array<"ok" | number>;
  /** Status for a YouTube API request; return undefined for the normal 200 answer. `attempt`
   * counts requests to that same resource, starting at 1. */
  api?: (call: {
    resource: string;
    attempt: number;
    bearer: string;
    metrics: string | null;
  }) => number | undefined;
  /** Videos the uploads playlist lists (default: none). */
  videoIds?: string[];
}

export interface RunResult {
  status: number;
  body: Record<string, unknown>;
  google: GoogleCall[];
  writes: DbWrite[];
  /** Everything written to console.error / console.warn / console.log during the run. */
  logs: string;
  /** Every last_sync_status value written to youtube_channels, in order. */
  syncStatuses: string[];
  /** Every status value written to youtube_connections, in order. */
  connectionStatuses: string[];
  tokenRefreshes: number;
}

type Handler = (ctx: { request: Request }) => Promise<Response>;

export async function runRoute(
  route: { Route: unknown },
  method: "GET" | "POST",
  path: string,
  scenario: Scenario = {},
): Promise<RunResult> {
  resetYoutubeTokenRegistry();
  const google: GoogleCall[] = [];
  const writes: DbWrite[] = [];
  const attempts = new Map<string, number>();
  let refreshes = 0;
  const videoIds = scenario.videoIds ?? [];
  const channelRow = {
    id: CHANNEL_ROW,
    user_id: USER,
    workspace_id: "ws-1",
    youtube_channel_id: "UCtestchannel0000000000000",
    uploads_playlist_id: "UUtestchannel0000000000000",
    channel_name: "Test",
    channel_handle: "@test",
    thumbnail: null,
    subscriber_count: 10,
    view_count: 500,
    video_count: videoIds.length,
    last_sync_status: "success",
    connection: {
      id: CONNECTION_ROW,
      access_token_ciphertext: await encryptSecretToBytea(STORED_ACCESS_TOKEN),
      refresh_token_ciphertext: await encryptSecretToBytea(STORED_REFRESH_TOKEN),
      token_expiry: new Date(
        Date.now() + (scenario.tokenValid === false ? -3_600_000 : 3_600_000),
      ).toISOString(),
    },
  };
  const tables: Record<string, unknown> = {
    youtube_channels: channelRow,
    workspace_members: { workspace_id: "ws-1", role: "owner" },
    features: { id: "feature-1", is_active: true },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const httpMethod = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    const wantsObject = (headers.get("Accept") ?? "").includes("vnd.pgrst.object");

    if (url.origin === SUPABASE && url.pathname === "/auth/v1/user")
      return json({ id: USER, aud: "authenticated", role: "authenticated", email: "t@test" });
    if (url.origin === SUPABASE && url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      if (httpMethod !== "GET") {
        const raw = init?.body ?? (request ? await request.clone().text() : null);
        let body: DbWrite["body"] = null;
        try {
          body = raw ? JSON.parse(String(raw)) : null;
        } catch {
          body = null;
        }
        writes.push({ method: httpMethod, table, body });
        // Like the real database, a refreshed access token that was persisted is what the next
        // read of the connection returns.
        if (table === "youtube_connections" && body && !Array.isArray(body)) {
          if (typeof body.access_token_ciphertext === "string")
            channelRow.connection.access_token_ciphertext = body.access_token_ciphertext;
          if (typeof body.token_expiry === "string")
            channelRow.connection.token_expiry = body.token_expiry;
        }
        // The sync "claims" a channel with an update that must return the claimed row.
        const returning = (headers.get("Prefer") ?? "").includes("return=representation");
        if (returning && table === "youtube_channels")
          return json(wantsObject ? { id: CHANNEL_ROW } : [{ id: CHANNEL_ROW }]);
        return json(wantsObject ? null : [], returning ? 200 : 201);
      }
      const row = tables[table];
      if (row) return json(wantsObject ? row : [row]);
      return json(wantsObject ? null : []);
    }
    if (url.hostname === "oauth2.googleapis.com") {
      const plan = scenario.refresh ?? ["ok"];
      const outcome = plan[Math.min(refreshes, plan.length - 1)];
      refreshes += 1;
      const status = outcome === "ok" ? 200 : outcome;
      google.push({ resource: "token", bearer: "", metrics: null, status });
      return outcome === "ok"
        ? json({
            access_token: `refreshed-${refreshes}`,
            expires_in: 3600,
            scope: "x",
            token_type: "Bearer",
          })
        : json({ error: "invalid_grant" }, status);
    }
    if (
      url.hostname === "www.googleapis.com" ||
      url.hostname === "youtubeanalytics.googleapis.com"
    ) {
      const resource =
        url.hostname === "youtubeanalytics.googleapis.com"
          ? "reports"
          : url.pathname.split("/").pop()!;
      const attempt = (attempts.get(resource) ?? 0) + 1;
      attempts.set(resource, attempt);
      const bearer = (headers.get("Authorization") ?? "").replace(/^Bearer /, "");
      const metrics = url.searchParams.get("metrics");
      const status = scenario.api?.({ resource, attempt, bearer, metrics }) ?? 200;
      google.push({ resource, bearer, metrics, status });
      if (status !== 200) return json({ error: { code: status } }, status);
      if (resource === "channels")
        return json({
          items: [
            {
              id: channelRow.youtube_channel_id,
              snippet: { title: "Test", customUrl: "@test", thumbnails: {} },
              statistics: { subscriberCount: "10", viewCount: "500", videoCount: "0" },
              contentDetails: { relatedPlaylists: { uploads: channelRow.uploads_playlist_id } },
            },
          ],
        });
      if (resource === "playlistItems")
        return json({ items: videoIds.map((videoId) => ({ contentDetails: { videoId } })) });
      if (resource === "videos")
        return json({
          items: videoIds.map((id, index) => ({
            id,
            snippet: {
              title: `Video ${index + 1}`,
              publishedAt: "2026-09-01T00:00:00Z",
              channelId: channelRow.youtube_channel_id,
              thumbnails: {},
            },
            contentDetails: { duration: "PT4M5S" },
            statistics: { viewCount: "100", likeCount: "7", commentCount: "2" },
            status: { privacyStatus: "public" },
          })),
        });
      const names = [
        ...(url.searchParams.get("dimensions")?.split(",") ?? []),
        ...(metrics?.split(",") ?? []),
      ];
      return json({ columnHeaders: names.map((name) => ({ name })), rows: [] });
    }
    throw new Error(`unexpected request in test: ${httpMethod} ${url.origin}${url.pathname}`);
  }) as typeof fetch;

  const logged: string[] = [];
  const consoles = { error: console.error, warn: console.warn, log: console.log };
  const capture = (...parts: unknown[]) =>
    void logged.push(
      parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "),
    );
  console.error = capture;
  console.warn = capture;
  console.log = capture;

  try {
    const session = {
      access_token: "session-token",
      refresh_token: "session-refresh",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: USER, aud: "authenticated", role: "authenticated", email: "t@test" },
    };
    const cookie = `sb-testref-auth-token=${encodeURIComponent(
      `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    )}`;
    const handlers = (route.Route as { options: { server: { handlers: Record<string, Handler> } } })
      .options.server.handlers;
    const response = await handlers[method]({
      request: new Request(`https://app.test${path}`, { method, headers: { Cookie: cookie } }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const fieldWrites = (table: string, field: string) =>
      writes
        .filter((write) => write.table === table && write.body && !Array.isArray(write.body))
        .map((write) => (write.body as Record<string, unknown>)[field])
        .filter((value): value is string => typeof value === "string");
    return {
      status: response.status,
      body,
      google,
      writes,
      logs: logged.join("\n"),
      syncStatuses: fieldWrites("youtube_channels", "last_sync_status"),
      connectionStatuses: fieldWrites("youtube_connections", "status"),
      tokenRefreshes: refreshes,
    };
  } finally {
    globalThis.fetch = realFetch;
    console.error = consoles.error;
    console.warn = consoles.warn;
    console.log = consoles.log;
  }
}
