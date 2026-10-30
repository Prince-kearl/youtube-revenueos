import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const card = readFileSync("src/components/DashboardKpiCard.tsx", "utf8");
const dashboard = readFileSync("src/routes/dashboard.tsx", "utf8");

test("each dashboard card has its colour theme", () => {
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
});

test("no mascots: no images on the cards, and the mascot files are gone", () => {
  assert.doesNotMatch(card, /<img|mascot/i);
  assert.ok(!existsSync("public/kpi"), "public/kpi removed");
});

test("the content uses the full width, keeping clear of the callout in the top-right corner", () => {
  assert.match(card, /relative z-0 flex min-w-0 flex-1 flex-col/);
  assert.doesNotMatch(card, /max-w-\[55%\]|max-w-\[60%\]/);
  assert.equal(card.match(/pr-\[92px\]/g)?.length, 3, "title row, change row and value");
  assert.match(card, /absolute right-3 top-3 z-10 min-w-\[80px\] rounded-\[8px\] bg-white/);
  assert.match(card, /"mt-1 line-clamp-1 text-sm leading-5"/);
});

test("the trend is a bar chart across the whole bottom of the card", () => {
  assert.match(card, /className="flex h-7 w-full items-end gap-1\.5"/);
  // capped, so a short history (one or two months) does not stretch across the card
  assert.match(card, /"kpi-bar min-w-0 max-w-\[28px\] flex-1 rounded-\[3px\]"/);
  assert.match(card, /series\.slice\(-18\)/);
});

test("the white rays come from the top-right corner, behind the callout", () => {
  assert.match(card, /maskImage:\s+"radial-gradient\(circle at 88% 22%/);
  assert.match(
    card,
    /className="kpi-rays absolute left-\[88%\] top-\[22%\] aspect-square w-\[300%\]"/,
  );
  assert.match(
    card,
    /repeating-conic-gradient\(from 0deg at 50% 50%, rgba\(255, 255, 255, 0\.22\)/,
  );
});

test("phones: every card is the same fixed height (160px); from sm up at least 152px", () => {
  assert.match(
    card,
    /dashboard-kpi-card relative isolate flex h-\[160px\] overflow-hidden px-4 py-3\.5[^"]*sm:h-auto sm:min-h-\[152px\]/,
  );
  assert.match(card, /<span className="sm:hidden">\s+<ChangePill/);
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
