import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const card = readFileSync("src/components/DashboardKpiCard.tsx", "utf8");
const dashboard = readFileSync("src/routes/dashboard.tsx", "utf8");
const root = readFileSync("src/routes/__root.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");

test("six cards from one list, in order, with the loop clone repeating the first", () => {
  const titles = [...dashboard.matchAll(/^ {6}title: "([^"]+)",$/gm)].map((m) => m[1]);
  assert.deepEqual(titles, [
    "Estimated Revenue",
    "Latest Revenue",
    "Total Views",
    "Videos",
    "Subscribers",
    "Watch Time",
  ]);
  assert.match(dashboard, /kpiCards\.map\(\(card, i\) => \(/);
  assert.match(dashboard, /<DashboardKpiCard index=\{0\} \{\.\.\.kpiCards\[0\]\} \/>/);
  assert.doesNotMatch(dashboard, /KpiTrendCard/, "the dashboard no longer uses the admin card");
});

test("the design: dark panel, numbered dot-matrix label, dot-matrix value, three-figure strip", () => {
  assert.match(card, /bg-\[#121212\] text-white/);
  assert.match(card, /String\(index \+ 1\)\.padStart\(2, "0"\)/);
  assert.match(card, /font-dot truncate text-\[15px\] font-bold uppercase/);
  assert.match(card, /font-dot truncate text-\[2\.25rem\] font-extrabold[^"]*sm:text-\[2\.75rem\]/);
  assert.match(card, /grid grid-cols-3 divide-x/);
  assert.match(root, /family=Doto:wght@400\.\.900/);
  assert.match(styles, /\.font-dot \{\n {2}font-family: "Doto"/);
});

test("dot-matrix charts per card: revenue bars green, the rest red", () => {
  for (const kind of ["DotBars", "DotLine", "DotGrid"])
    assert.match(card, new RegExp(`function ${kind}\\(`));
  assert.match(
    card,
    /const ACCENT: Record<KpiAccent, string> = \{ green: "#22c55e", red: "#ef4444" \};/,
  );
  assert.match(dashboard, /title: "Estimated Revenue",\n {6}accent: "green" as const,/);
  assert.equal(dashboard.match(/accent: "red" as const,/g)?.length, 5);
});

test("the strip is honest: real month figures, '—' for a month with no data, real all-time totals", () => {
  assert.match(dashboard, /return row \? fmt\(pick\(row\)\) : "—";/);
  assert.match(
    dashboard,
    /return usd === null \|\| usd === undefined \? "—" : formatUsdCompact\(usd\);/,
  );
  // revenue: withheld when the viewer may not see revenue; its long-run figure is the period total
  assert.match(dashboard, /if \(revenue\.hidden\) return "—";/);
  assert.match(
    dashboard,
    /\{ label: revenue\.periodLabel \|\| "Period", value: revenueValue\(revenue\.total\.text\) \}/,
  );
  // views / videos / subscribers: the channel's all-time totals
  assert.match(
    dashboard,
    /label: "All time",\n {10}value: dashboardData \? formatCount\(dashboardData\.channel\.viewCount\)/,
  );
  assert.match(
    dashboard,
    /label: "All time",\n {10}value: dashboardData \? formatCount\(dashboardData\.channel\.subscriberCount\)/,
  );
});

test("the ... button goes to the metric's page, and every number is in the text", () => {
  assert.match(card, /<Link\s+to=\{href\}\s+aria-label=\{`Open \$\{title\} details`\}/);
  for (const piece of ["{value}", "{delta.emphasis}", "{delta.text}", "{s.value}", "{s.label}"])
    assert.ok(card.includes(piece), piece);
  assert.match(card, /aria-hidden="true"/, "charts are decorative");
});

test("phones: every card is the same fixed height", () => {
  assert.match(
    card,
    /dashboard-kpi-card relative flex h-\[232px\] flex-col[^"]*sm:h-auto sm:min-h-\[232px\]/,
  );
});
