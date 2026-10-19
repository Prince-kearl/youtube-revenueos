import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { SUPABASE, CALLER } from "./helpers/admin-users-fake-api";

// The admin console is Superadmin only — on the server, for every admin API, whatever the URL,
// method or payload. A user, editor, setter, manager or platform Owner who types /admin, or calls
// an admin API directly, is refused before anything is read or written; a signed-out caller is
// refused before anything at all. (The /admin page itself is a client shell whose only content is
// what these APIs return; its gate is /api/admin/whoami, tested here too.)

const NOT_CONSOLE = ["owner", "manager", "setter", "editor", "user"] as const;
type Handler = (ctx: { request: Request }) => Promise<Response>;
type RouteModule = { Route: unknown };

interface Seen {
  method: string;
  path: string;
}

async function call(
  route: RouteModule,
  method: string,
  path: string,
  { callerRole = "superadmin" as string | null, signedIn = true, body = undefined as unknown } = {},
) {
  const seen: Seen[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const verb = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.origin === SUPABASE && url.pathname === "/auth/v1/user")
      return signedIn
        ? json({ id: CALLER, aud: "authenticated", role: "authenticated", email: "a@test" })
        : json({ message: "invalid JWT" }, 401);
    // The caller's own role lookup is the only read a refused request may make.
    if (
      url.origin === SUPABASE &&
      url.pathname === "/rest/v1/profiles" &&
      url.searchParams.get("id") === `eq.${CALLER}` &&
      url.searchParams.get("select") === "role"
    )
      return json({ role: callerRole });
    seen.push({ method: verb, path: `${url.pathname}${url.search}` });
    // Anything a permitted request asks for gets an empty answer.
    return json([]);
  }) as typeof fetch;
  try {
    const session = {
      access_token: "t",
      refresh_token: "r",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: CALLER, aud: "authenticated", role: "authenticated", email: "a@test" },
    };
    const cookie = `sb-testref-auth-token=${encodeURIComponent(
      `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
    )}`;
    const handlers = (route.Route as { options: { server: { handlers: Record<string, Handler> } } })
      .options.server.handlers;
    const headers: Record<string, string> = signedIn ? { Cookie: cookie } : {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await handlers[method]({
      request: new Request(`https://app.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    });
    const text = await response.text();
    return { status: response.status, text, seen };
  } finally {
    globalThis.fetch = realFetch;
  }
}

// Every admin API route, and every method it serves, straight from the repository.
const ADMIN_FILES = readdirSync("src/routes").filter((f) => /^api\.admin\..+\.ts$/.test(f));
const adminRoutes = await Promise.all(
  ADMIN_FILES.map(async (file) => {
    const mod = (await import(`../src/routes/${file}`)) as RouteModule;
    const handlers = (mod.Route as { options: { server: { handlers: Record<string, Handler> } } })
      .options.server.handlers;
    const path = `/${file.replace(/\.ts$/, "").replace(/\./g, "/")}`;
    return { file, mod, path, methods: Object.keys(handlers) };
  }),
);
// Site content (Customization) is written from the console too.
const settings = (await import("../src/routes/api.settings")) as RouteModule;

test("the map covers every admin route file", () => {
  assert.ok(adminRoutes.length >= 18, `${adminRoutes.length} admin route files`);
  for (const r of adminRoutes) assert.ok(r.methods.length > 0, r.file);
});

test("/admin's gate (whoami): only a Superadmin is admitted", async () => {
  const whoami = adminRoutes.find((r) => r.file === "api.admin.whoami.ts")!;
  const allowed = await call(whoami.mod, "GET", whoami.path);
  assert.equal(allowed.status, 200);
  for (const role of NOT_CONSOLE) {
    const r = await call(whoami.mod, "GET", whoami.path, { callerRole: role });
    assert.deepEqual(
      [role, r.status, JSON.parse(r.text)],
      [role, 403, { error: "ADMIN_REQUIRED" }],
    );
  }
  const anonymous = await call(whoami.mod, "GET", whoami.path, { signedIn: false });
  assert.equal(anonymous.status, 401);
});

for (const role of NOT_CONSOLE)
  test(`${role}: every admin API method is refused (403) before anything is read or written`, async () => {
    for (const r of adminRoutes)
      for (const method of r.methods) {
        // A payload aimed at escalation: the caller's own id, a top role, a workspace id.
        const body =
          method === "GET" ? undefined : { id: CALLER, role: "superadmin", workspaceId: CALLER };
        const res = await call(r.mod, method, `${r.path}?id=${CALLER}`, { callerRole: role, body });
        const label = `${role} ${method} ${r.path}`;
        assert.equal(res.status, 403, label);
        assert.deepEqual(JSON.parse(res.text), { error: "ADMIN_REQUIRED" }, label);
        assert.deepEqual(res.seen, [], `${label}: nothing read or written`);
      }
    const put = await call(settings, "PUT", "/api/settings", {
      callerRole: role,
      body: { content: { siteName: "pwned" } },
    });
    assert.equal(put.status, 403, `${role} PUT /api/settings`);
    assert.deepEqual(put.seen, [], `${role} PUT /api/settings: nothing written`);
  });

test("signed out: every admin API method is 401 before anything is read or written", async () => {
  for (const r of adminRoutes)
    for (const method of r.methods) {
      const res = await call(r.mod, method, r.path, {
        signedIn: false,
        body: method === "GET" ? undefined : {},
      });
      assert.equal(res.status, 401, `${method} ${r.path}`);
      assert.deepEqual(res.seen, [], `${method} ${r.path}`);
    }
  const put = await call(settings, "PUT", "/api/settings", { signedIn: false, body: {} });
  assert.equal(put.status, 401);
});

test("a Superadmin passes the gate on every admin API (whatever the request then needs)", async () => {
  for (const r of adminRoutes)
    for (const method of r.methods) {
      const res = await call(r.mod, method, r.path, { body: method === "GET" ? undefined : {} });
      assert.notEqual(res.status, 401, `${method} ${r.path}`);
      assert.doesNotMatch(
        res.text,
        /ADMIN_REQUIRED|PERMISSION_REQUIRED|ROLE_REQUIRED/,
        `${method} ${r.path}`,
      );
    }
});

test("every admin route file goes through a console guard", () => {
  for (const r of adminRoutes) {
    const source = readFileSync(`src/routes/${r.file}`, "utf8");
    assert.match(
      source,
      /requireConsoleAccess\(request\)|requirePermission\(request, "\w+"\)|canAccessConsole\(/,
      r.file,
    );
    assert.doesNotMatch(source, /requireMinimumRole\(/, `${r.file}: no bare role-level gate`);
  }
  assert.match(
    readFileSync("src/routes/api.settings.ts", "utf8"),
    /requireConsoleAccess\(request\)/,
  );
});

test("the role rules: console access is Superadmin only, and checked before any permission", async () => {
  const roles = await import("../src/lib/server/roles");
  for (const role of roles.APP_ROLES)
    assert.equal(roles.canAccessConsole(role), role === "superadmin", role);
  // Impersonation needs console access first: nobody but a Superadmin may impersonate anyone.
  for (const acting of roles.APP_ROLES)
    for (const target of roles.APP_ROLES)
      assert.equal(
        roles.canImpersonate(acting, target),
        acting === "superadmin" && target !== "superadmin",
        `${acting} → ${target}`,
      );
  const source = readFileSync("src/lib/server/roles.ts", "utf8").replace(/\s+/g, " ");
  assert.match(
    source,
    /export async function requirePermission\( request: Request, permission: Permission, \): Promise<AuthedResult> \{ const result = await getAuthenticatedRole\(request\); if \(!canAccessConsole\(result\.role\)\) throw forbidden\("ADMIN_REQUIRED"\);/,
  );
});

test("the database admin-read policies are narrowed to Superadmin", () => {
  const sql = readFileSync(
    "supabase/migrations/202610190003_admin_reads_superadmin_only.sql",
    "utf8",
  )
    .replace(/\r\n/g, "\n") // a Windows checkout has CRLF line endings
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  for (const policy of [
    "admin_audit_log_admin_read on public.admin_audit_log",
    "app_releases_admin_read on public.app_releases",
    "plan_audit_log_admin_read on public.plan_audit_log",
  ])
    assert.match(
      sql,
      new RegExp(
        `create policy ${policy} for select using \\(\\s*exists \\(\\s*select 1 from public\\.profiles p\\s*where p\\.id = auth\\.uid\\(\\) and p\\.role = 'superadmin'\\s*\\)\\s*\\);`,
      ),
    );
  assert.doesNotMatch(sql, /'owner'/);
  assert.match(sql, /^begin;\nset local lock_timeout = '3s';/m);
});
