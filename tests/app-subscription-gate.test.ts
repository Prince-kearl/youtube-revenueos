import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasWorkspaceAppAccess, type WorkspaceAccess } from "../src/lib/plan-notice";

const now = new Date("2026-11-02T00:00:00.000Z");
const access = (overrides: Partial<WorkspaceAccess>): WorkspaceAccess => ({
  plan: null,
  status: null,
  source: "none",
  periodEnd: null,
  isOwner: true,
  ...overrides,
});

test("the app accepts only a server-confirmed subscription or configured access exception", () => {
  assert.equal(
    hasWorkspaceAppAccess(
      access({ plan: "starter", status: "active", source: "subscription" }),
      now,
    ),
    true,
  );
  assert.equal(
    hasWorkspaceAppAccess(access({ plan: "pro", status: "trialing", source: "subscription" }), now),
    true,
    "a trial is granted only when Stripe has recorded the selected plan",
  );
  assert.equal(
    hasWorkspaceAppAccess(
      access({ plan: "scale", status: "active", source: "staff_exception" }),
      now,
    ),
    true,
  );
  assert.equal(
    hasWorkspaceAppAccess(
      access({
        source: "transition",
        periodEnd: "2026-11-03T00:00:00.000Z",
      }),
      now,
    ),
    true,
  );
});

test("missing, unavailable, malformed and expired workspace access never opens the app", () => {
  assert.equal(hasWorkspaceAppAccess(null, now), false);
  assert.equal(hasWorkspaceAppAccess(undefined, now), false);
  assert.equal(hasWorkspaceAppAccess(access({ source: "none" }), now), false);
  assert.equal(hasWorkspaceAppAccess(access({ source: "unavailable" }), now), false);
  assert.equal(
    hasWorkspaceAppAccess(
      access({
        source: "subscription",
        plan: null,
        status: null,
      }),
      now,
    ),
    false,
  );
  assert.equal(
    hasWorkspaceAppAccess(
      access({
        source: "transition",
        periodEnd: "2026-11-01T23:59:59.999Z",
      }),
      now,
    ),
    false,
  );
});

test("the app shell checks access before mounting protected page content", () => {
  const source = readFileSync("src/components/DashboardLayout.tsx", "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("export function DashboardLayout(");
  const end = source.indexOf("function DashboardLayoutContent(", start);
  assert.ok(start >= 0 && end > start);
  const gate = source.slice(start, end);

  assert.match(gate, /fetch\("\/api\/billing\/subscription"/);
  assert.match(gate, /hasWorkspaceAppAccess\(body\.data\.access\)/);
  assert.match(gate, /navigate\(\{ to: "\/billing", replace: true \}\)/);
  assert.match(gate, /if \(canRenderApp\) return <DashboardLayoutContent \{\.\.\.props\} \/>/);
  assert.match(gate, /status === "error"/);
});
