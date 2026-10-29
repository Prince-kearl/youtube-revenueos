import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const card = readFileSync("src/components/DashboardKpiCard.tsx", "utf8");
const dashboard = readFileSync("src/routes/dashboard.tsx", "utf8");

const MASCOTS = [
  "kpi-revenue.webp",
  "kpi-latest-revenue.webp",
  "kpi-views.webp",
  "kpi-videos.webp",
  "kpi-subscribers.webp",
  "kpi-watch-time.webp",
];

test("each dashboard card has its theme (and so its mascot)", () => {
  const themes = [...dashboard.matchAll(/title="([^"]+)"\s+theme="(\w+)"/g)].map(
    (m) => `${m[1]}:${m[2]}`,
  );
  assert.deepEqual(themes, [
    "Estimated Revenue:green",
    "Latest Revenue:blue",
    "Total Views:purple",
    "Videos:pink",
    "Subscribers:yellow",
    "Watch Time:red",
    "Estimated Revenue:green", // the phone carousel's loop clone
  ]);
  assert.doesNotMatch(dashboard, /KpiTrendCard/, "the dashboard no longer uses the admin card");
  assert.match(dashboard, /<DashboardKpiCardSkeleton key=\{i\} className=\{kpiCardClassName\} \/>/);
});

test("the mascot images ship in public/kpi, small, and are decorative", () => {
  for (const name of MASCOTS) {
    const file = `public/kpi/${name}`;
    assert.ok(existsSync(file), file);
    assert.ok(statSync(file).size < 60_000, `${file} under 60 KB`);
    assert.equal(readFileSync(file).subarray(8, 12).toString("latin1"), "WEBP", `${file} is WebP`);
    assert.ok(card.includes(`/kpi/${name}`), `${name} is used by a theme`);
  }
  assert.match(card, /alt=""\s+aria-hidden="true"/);
});

test("phones: every card is the same fixed height; from sm up at least the design's 168px", () => {
  assert.match(
    card,
    /dashboard-kpi-card relative isolate flex h-\[168px\][^"]*sm:h-auto sm:min-h-\[168px\]/,
  );
  // the change badge moves onto the title row on phones, so no card grows taller there
  assert.match(card, /<span className="sm:hidden">\s+<ChangePill/);
  assert.match(card, /mt-1\.5 hidden items-center gap-2 text-sm sm:flex/);
  assert.match(card, /line-clamp-2/);
});

test("the numbers are all in the text: value, change, latest month", () => {
  for (const piece of [
    "{title}",
    "{value}",
    "{deltaLabel} {deltaSuffix}",
    "{markerTitle}",
    "{markerSubtitle}",
  ])
    assert.ok(card.includes(piece), piece);
  assert.match(card, /Math\.abs\(changePercent\)\.toFixed\(1\)/);
});
