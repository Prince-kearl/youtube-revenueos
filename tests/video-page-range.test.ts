import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The video page's 3M / 6M / 12M toggle and Refresh button drive every section on the page, and the
// chosen period is kept in the address so a reload, a shared link or Back opens the same period.

const page = readFileSync("src/routes/videos.$videoId.tsx", "utf8").replace(/\s+/g, " ");

test("choosing a period writes it to the address, and the address opens it", () => {
  assert.match(page, /onClick=\{\(\) => chooseRange\(item\)\}/);
  assert.match(
    page,
    /void navigate\(\{ search: \(previous\) => \(\{ \.\.\.previous, range: next \}\), replace: true \}\);/,
  );
  // Read back from the address on load (and when it changes).
  assert.match(page, /useState<Range>\(searchRange \?\? "12M"\)/);
  assert.match(page, /if \(searchRange\) setRange\(searchRange\);/);
});

test("every section follows the period and the Refresh button", () => {
  // The live analytics (KPI cards, small cards, charts, traffic, demographics, retention).
  assert.match(page, /new URLSearchParams\(\{ videoId, range \}\)/);
  assert.match(page, /\}, \[range, retryNonce, videoId\]\);/);
  // The revenue cards.
  assert.match(page, /useVideoRevenue\(videoId, range, retryNonce\)/);
  // Revenue sources and "For this video".
  assert.match(
    page,
    /<VideoRevenueSources className="mt-5" youtubeVideoId=\{videoId\} range=\{range\} refreshNonce=\{retryNonce\}/,
  );
  assert.match(
    page,
    /<VideoRevenueOpportunities className="mt-5" youtubeVideoId=\{videoId\} range=\{range\} refreshNonce=\{retryNonce \+ dealsNonce\}/,
  );
});

test("the toggle is the app's glass toggle, and says which period is on", () => {
  assert.match(
    page,
    /className="glass-pill flex gap-0\.5 p-1 text-xs backdrop-blur-lg" role="group" aria-label="Period"/,
  );
  assert.match(page, /aria-pressed=\{item === range\}/);
  assert.match(page, /item === range \? "glass-segment-active"/);
});

test("demo: the sample video's period follows the requested range, like the real endpoint", () => {
  const demo = readFileSync("src/lib/demo-api.ts", "utf8").replace(/\s+/g, " ");
  assert.match(demo, /const requested = url\.searchParams\.get\("range"\);/);
  assert.match(demo, /\{ "3M": "2026-06-19", "6M": "2026-03-19", "12M": "2025-09-19" \}\[range\]/);
});
