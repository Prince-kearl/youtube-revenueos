import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessFreshness,
  calculateRpm,
  channelTotals,
  compareTotals,
  compareValues,
  periodLengthDays,
  previousPeriod,
  reconcilePeriod,
  revenueTrend,
  sumRevenue,
  summarizeRevenue,
  totalsFor,
  videoPerformance,
  type ChannelRevenueDay,
  type VideoRevenueDay,
} from "../src/lib/server/revenue-metrics";
import {
  nullableNumber,
  toChannelRevenueDay,
  toVideoRevenueDay,
} from "../src/lib/server/revenue-store";

const CHANNEL = "channel-a";
const OTHER_CHANNEL = "channel-b";
const SEPTEMBER = { startDate: "2026-09-01", endDate: "2026-09-30" };
const WEEK = { startDate: "2026-09-08", endDate: "2026-09-14" };

function channelDay(day: string, values: Partial<ChannelRevenueDay> = {}): ChannelRevenueDay {
  return {
    channelId: CHANNEL,
    day,
    views: 1000,
    watchMinutes: 3000,
    estimatedRevenueUsd: 5,
    adRevenueUsd: 4,
    premiumRevenueUsd: 0.5,
    ...values,
  };
}

function videoDay(
  videoId: string,
  day: string,
  values: Partial<VideoRevenueDay> = {},
): VideoRevenueDay {
  return {
    channelId: CHANNEL,
    videoId,
    day,
    views: 400,
    watchMinutes: 1200,
    estimatedRevenueUsd: 2,
    adRevenueUsd: 1.6,
    premiumRevenueUsd: 0.2,
    ...values,
  };
}

// ---------- 1. total earned revenue ----------

test("earned revenue is the sum of the channel rows in the period", () => {
  const rows = [
    channelDay("2026-08-31", { estimatedRevenueUsd: 99 }), // before the period
    channelDay("2026-09-01", { estimatedRevenueUsd: 5 }),
    channelDay("2026-09-02", { estimatedRevenueUsd: 7.25 }),
    channelDay("2026-10-01", { estimatedRevenueUsd: 99 }), // after the period
  ];
  const totals = channelTotals(rows, SEPTEMBER);
  assert.equal(totals.earned.usd, 12.25);
  assert.equal(totals.earned.availability, "available");
  assert.equal(totals.views, 2000);
  assert.equal(totals.watchMinutes, 6000);
});

test("sums do not pick up floating-point noise", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    channelDay(`2026-09-${String(i + 1).padStart(2, "0")}`, { estimatedRevenueUsd: 0.1 }),
  );
  assert.equal(channelTotals(rows, SEPTEMBER).earned.usd, 1);
});

// ---------- 2. zero revenue ----------

test("zero revenue is a known value: available, and exactly 0", () => {
  const rows = [
    channelDay("2026-09-01", { estimatedRevenueUsd: 0, adRevenueUsd: 0, premiumRevenueUsd: 0 }),
    channelDay("2026-09-02", { estimatedRevenueUsd: 0, adRevenueUsd: 0, premiumRevenueUsd: 0 }),
  ];
  const totals = channelTotals(rows, SEPTEMBER);
  assert.equal(totals.earned.usd, 0);
  assert.equal(totals.earned.availability, "available");
  assert.equal(totals.rpm, 0, "an unmonetised channel with views has an RPM of 0, not unknown");
});

// ---------- 3. NULL / unavailable revenue ----------

test("revenue that was never reported stays unavailable and is never 0", () => {
  const rows = [
    channelDay("2026-09-01", {
      estimatedRevenueUsd: null,
      adRevenueUsd: null,
      premiumRevenueUsd: null,
    }),
    channelDay("2026-09-02", {
      estimatedRevenueUsd: null,
      adRevenueUsd: null,
      premiumRevenueUsd: null,
    }),
  ];
  const totals = channelTotals(rows, SEPTEMBER);
  assert.equal(totals.earned.usd, null);
  assert.notEqual(totals.earned.usd, 0);
  assert.equal(totals.earned.availability, "unavailable");
  assert.deepEqual([totals.earned.knownRows, totals.earned.unknownRows], [0, 2]);
  assert.equal(totals.rpm, null, "no RPM without revenue");
  assert.equal(totals.split.ad.usd, null);
  assert.equal(totals.split.premium.usd, null);
  assert.equal(totals.split.other.usd, null);
  assert.equal(totals.views, 2000, "activity is still reported");
});

// ---------- 4. mixed NULL and numeric revenue ----------

test("a mix of known and unknown days is partial and sums only what is known", () => {
  const rows = [
    channelDay("2026-09-01", { estimatedRevenueUsd: 6, views: 1000 }),
    channelDay("2026-09-02", { estimatedRevenueUsd: null, views: 9000 }),
    channelDay("2026-09-03", { estimatedRevenueUsd: 0, views: 1000 }),
  ];
  const totals = channelTotals(rows, SEPTEMBER);
  assert.equal(totals.earned.usd, 6, "the unknown day adds nothing — it is not counted as 0");
  assert.equal(totals.earned.availability, "partial");
  assert.deepEqual([totals.earned.knownRows, totals.earned.unknownRows], [2, 1]);
  assert.equal(totals.views, 11000);
  assert.equal(totals.viewsWithRevenue, 2000);
  assert.equal(
    totals.rpm,
    3,
    "RPM divides known revenue by the views of the same days, not by views whose revenue is unknown",
  );
});

test("sumRevenue distinguishes nothing-known from known-zero", () => {
  assert.deepEqual(sumRevenue([]), {
    usd: null,
    availability: "unavailable",
    knownRows: 0,
    unknownRows: 0,
  });
  assert.equal(sumRevenue([null, undefined]).usd, null);
  assert.equal(sumRevenue([0]).usd, 0);
  assert.equal(sumRevenue([0, null]).usd, 0);
  assert.equal(sumRevenue([0, null]).availability, "partial");
});

// ---------- 5. ad / Premium / other split ----------

test("revenue splits into ads, Premium and the remainder YouTube does not itemise", () => {
  const rows = [
    channelDay("2026-09-01", { estimatedRevenueUsd: 10, adRevenueUsd: 7, premiumRevenueUsd: 1 }),
    channelDay("2026-09-02", { estimatedRevenueUsd: 5, adRevenueUsd: 4, premiumRevenueUsd: 1 }),
  ];
  const { split, earned } = channelTotals(rows, SEPTEMBER);
  assert.equal(split.ad.usd, 11);
  assert.equal(split.premium.usd, 2);
  assert.equal(split.other.usd, 2);
  assert.equal(split.ad.usd! + split.premium.usd! + split.other.usd!, earned.usd);
});

test("the remainder is only computed from days where all three figures are known", () => {
  const rows = [
    channelDay("2026-09-01", { estimatedRevenueUsd: 10, adRevenueUsd: 7, premiumRevenueUsd: 1 }),
    channelDay("2026-09-02", { estimatedRevenueUsd: 5, adRevenueUsd: null, premiumRevenueUsd: 1 }),
  ];
  const { split } = channelTotals(rows, SEPTEMBER);
  assert.equal(split.ad.usd, 7);
  assert.equal(split.ad.availability, "partial");
  assert.equal(split.premium.usd, 2);
  assert.equal(split.other.usd, 2, "the day with unknown ad revenue contributes no remainder");
  assert.equal(split.other.availability, "partial");
});

test("rounding that pushes the remainder slightly negative is shown as 0", () => {
  const rows = [
    channelDay("2026-09-01", {
      estimatedRevenueUsd: 1,
      adRevenueUsd: 0.6,
      premiumRevenueUsd: 0.400001,
    }),
  ];
  assert.equal(channelTotals(rows, SEPTEMBER).split.other.usd, 0);
});

// ---------- 6 & 7. RPM ----------

test("RPM is earned revenue per thousand views", () => {
  assert.equal(calculateRpm(12.5, 5000), 2.5);
  const rows = [
    channelDay("2026-09-01", { estimatedRevenueUsd: 12.5, views: 5000 }),
    channelDay("2026-09-02", { estimatedRevenueUsd: 7.5, views: 5000 }),
  ];
  assert.equal(channelTotals(rows, SEPTEMBER).rpm, 2);
});

test("RPM is not calculated without views or without revenue", () => {
  assert.equal(calculateRpm(10, 0), null);
  assert.equal(calculateRpm(null, 1000), null);
  assert.equal(calculateRpm(10, -5), null);
  assert.equal(calculateRpm(Number.NaN, 1000), null);
  const rows = [channelDay("2026-09-01", { estimatedRevenueUsd: 3, views: 0 })];
  const totals = channelTotals(rows, SEPTEMBER);
  assert.equal(totals.rpm, null, "revenue with zero views has no RPM (not Infinity, not 0)");
  assert.equal(totals.earned.usd, 3);
});

// ---------- 8, 9 & 10. per-video revenue, RPM, contribution ----------

test("per-video revenue, views and RPM are totalled per video and ranked by revenue", () => {
  const channel = channelTotals(
    [
      channelDay("2026-09-01", { estimatedRevenueUsd: 10, views: 2000 }),
      channelDay("2026-09-02", { estimatedRevenueUsd: 10, views: 2000 }),
    ],
    SEPTEMBER,
  );
  const videos = videoPerformance(
    [
      videoDay("small", "2026-09-01", { estimatedRevenueUsd: 1, views: 1000, watchMinutes: 10 }),
      videoDay("big", "2026-09-01", { estimatedRevenueUsd: 6, views: 500, watchMinutes: 20 }),
      videoDay("big", "2026-09-02", { estimatedRevenueUsd: 9, views: 1000, watchMinutes: 30 }),
      videoDay("big", "2026-08-01", { estimatedRevenueUsd: 500 }), // outside the period
    ],
    SEPTEMBER,
    channel,
  );
  assert.deepEqual(
    videos.map((v) => v.videoId),
    ["big", "small"],
  );
  const [big, small] = videos;
  assert.equal(big.earned.usd, 15);
  assert.equal(big.views, 1500);
  assert.equal(big.watchMinutes, 50);
  assert.equal(big.rpm, 10);
  assert.equal(small.rpm, 1);
  assert.equal(big.revenueShare, 0.75, "share of the CHANNEL total (20), not of the video sum");
  assert.equal(small.revenueShare, 0.05);
  assert.equal(big.viewShare, 0.375);
});

test("video shares add up to less than 1 when some revenue belongs to no listed video", () => {
  const channel = channelTotals([channelDay("2026-09-01", { estimatedRevenueUsd: 10 })], SEPTEMBER);
  const videos = videoPerformance(
    [
      videoDay("a", "2026-09-01", { estimatedRevenueUsd: 4 }),
      videoDay("b", "2026-09-01", { estimatedRevenueUsd: 2 }),
    ],
    SEPTEMBER,
    channel,
  );
  const total = videos.reduce((sum, v) => sum + (v.revenueShare ?? 0), 0);
  assert.equal(Math.round(total * 100) / 100, 0.6, "the missing 40% is not spread over a and b");
});

test("a video with unknown revenue has no RPM and no share, and is ranked last", () => {
  const channel = channelTotals([channelDay("2026-09-01", { estimatedRevenueUsd: 10 })], SEPTEMBER);
  const videos = videoPerformance(
    [
      videoDay("unknown", "2026-09-01", { estimatedRevenueUsd: null, views: 99999 }),
      videoDay("zero", "2026-09-01", { estimatedRevenueUsd: 0, views: 10 }),
    ],
    SEPTEMBER,
    channel,
  );
  assert.deepEqual(
    videos.map((v) => v.videoId),
    ["zero", "unknown"],
  );
  const [zero, unknown] = videos;
  assert.equal(zero.earned.usd, 0);
  assert.equal(zero.revenueShare, 0);
  assert.equal(unknown.earned.usd, null);
  assert.equal(unknown.earned.availability, "unavailable");
  assert.equal(unknown.rpm, null);
  assert.equal(unknown.revenueShare, null);
});

test("no revenue share is given against a channel total that is zero, partial or unknown", () => {
  const video = [videoDay("a", "2026-09-01", { estimatedRevenueUsd: 0 })];
  const zeroChannel = channelTotals(
    [channelDay("2026-09-01", { estimatedRevenueUsd: 0 })],
    SEPTEMBER,
  );
  assert.equal(videoPerformance(video, SEPTEMBER, zeroChannel)[0].revenueShare, null);
  const partialChannel = channelTotals(
    [
      channelDay("2026-09-01", { estimatedRevenueUsd: 10 }),
      channelDay("2026-09-02", { estimatedRevenueUsd: null }),
    ],
    SEPTEMBER,
  );
  assert.equal(videoPerformance(video, SEPTEMBER, partialChannel)[0].revenueShare, null);
});

// ---------- 11 & 12. period-over-period ----------

test("the previous period is the same length and ends the day before", () => {
  assert.equal(periodLengthDays(SEPTEMBER), 30);
  assert.deepEqual(previousPeriod(SEPTEMBER), { startDate: "2026-08-02", endDate: "2026-08-31" });
  assert.deepEqual(previousPeriod(WEEK), { startDate: "2026-09-01", endDate: "2026-09-07" });
  const oneDay = { startDate: "2026-03-01", endDate: "2026-03-01" };
  assert.deepEqual(previousPeriod(oneDay), { startDate: "2026-02-28", endDate: "2026-02-28" });
});

test("period-over-period change in revenue, views and RPM", () => {
  const rows = [
    channelDay("2026-09-03", { estimatedRevenueUsd: 100, views: 10000, watchMinutes: 100 }),
    channelDay("2026-09-10", { estimatedRevenueUsd: 150, views: 12000, watchMinutes: 50 }),
  ];
  const change = compareTotals(
    channelTotals(rows, WEEK),
    channelTotals(rows, previousPeriod(WEEK)),
  );
  assert.deepEqual(change.earned, { current: 150, previous: 100, absolute: 50, percent: 50 });
  assert.equal(change.views.percent, 20);
  assert.equal(change.watchMinutes.percent, -50);
  assert.equal(change.rpm.current, 12.5);
  assert.equal(change.rpm.previous, 10);
  assert.equal(change.rpm.percent, 25);
  assert.equal(change.revenueComparable, true);
});

test("growth from a previous period of zero has an amount but no percentage", () => {
  assert.deepEqual(compareValues(40, 0), {
    current: 40,
    previous: 0,
    absolute: 40,
    percent: null,
  });
  assert.deepEqual(compareValues(0, 0), { current: 0, previous: 0, absolute: 0, percent: null });
});

test("a change against unknown revenue is unknown, never measured against 0", () => {
  assert.deepEqual(compareValues(40, null), {
    current: 40,
    previous: null,
    absolute: null,
    percent: null,
  });
  assert.equal(compareValues(null, 40).percent, null);
  const rows = [
    channelDay("2026-09-03", { estimatedRevenueUsd: null }),
    channelDay("2026-09-10", { estimatedRevenueUsd: 150 }),
  ];
  const change = compareTotals(
    channelTotals(rows, WEEK),
    channelTotals(rows, previousPeriod(WEEK)),
  );
  assert.equal(change.earned.absolute, null);
  assert.equal(change.earned.percent, null);
  assert.equal(change.revenueComparable, false);
  assert.equal(change.views.percent, 0, "views are still comparable");
});

test("a decline is a negative percentage", () => {
  assert.equal(compareValues(75, 100).percent, -25);
  assert.equal(compareValues(0, 100).percent, -100);
});

// ---------- 13. daily / monthly aggregation ----------

test("daily trend has one point per day in order, and a day with no row is unavailable", () => {
  const rows = [
    channelDay("2026-09-08", { estimatedRevenueUsd: 1 }),
    channelDay("2026-09-10", { estimatedRevenueUsd: 0 }),
  ];
  const trend = revenueTrend(rows, WEEK, "day");
  assert.equal(trend.length, 7);
  assert.deepEqual(
    trend.map((p) => p.bucket),
    [
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
    ],
  );
  assert.equal(trend[0].earned.usd, 1);
  assert.equal(trend[1].hasData, false);
  assert.equal(trend[1].earned.usd, null, "a missing day is not drawn as $0");
  assert.equal(trend[2].hasData, true);
  assert.equal(trend[2].earned.usd, 0, "a reported zero is drawn as $0");
});

test("monthly trend buckets by calendar month and clips to the period", () => {
  const period = { startDate: "2026-07-15", endDate: "2026-09-10" };
  const rows = [
    channelDay("2026-07-01", { estimatedRevenueUsd: 1000 }), // before the period
    channelDay("2026-07-20", { estimatedRevenueUsd: 2, views: 100 }),
    channelDay("2026-07-31", { estimatedRevenueUsd: 3, views: 100 }),
    channelDay("2026-09-01", { estimatedRevenueUsd: 4, views: 400 }),
    channelDay("2026-09-01", { channelId: OTHER_CHANNEL, estimatedRevenueUsd: 6, views: 600 }),
  ];
  const trend = revenueTrend(rows, period, "month");
  assert.deepEqual(
    trend.map((p) => [p.bucket, p.startDate, p.endDate]),
    [
      ["2026-07", "2026-07-15", "2026-07-31"],
      ["2026-08", "2026-08-01", "2026-08-31"],
      ["2026-09", "2026-09-01", "2026-09-10"],
    ],
  );
  assert.equal(trend[0].earned.usd, 5);
  assert.equal(trend[0].rpm, 25);
  assert.equal(trend[1].hasData, false);
  assert.equal(trend[1].earned.usd, null);
  assert.equal(trend[2].earned.usd, 10, "channels are added together");
  assert.equal(trend[2].views, 1000);
  const total = trend.reduce((sum, p) => sum + (p.earned.usd ?? 0), 0);
  assert.equal(total, channelTotals(rows, period).earned.usd, "the trend adds up to the total");
});

// ---------- 14 & 15. reconciliation ----------

test("reconciliation: video rows that explain the channel exactly are fully attributed", () => {
  const result = reconcilePeriod(
    [channelDay("2026-09-01", { estimatedRevenueUsd: 5, views: 1000 })],
    [
      videoDay("a", "2026-09-01", { estimatedRevenueUsd: 3, views: 600 }),
      videoDay("b", "2026-09-01", { estimatedRevenueUsd: 2, views: 400 }),
    ],
    SEPTEMBER,
  );
  assert.equal(result.fullyAttributed, true);
  assert.equal(result.unattributedViews, 0);
  assert.equal(result.unattributedRevenue.usd, 0);
  assert.equal(result.channelRevenue.usd, 5);
  assert.equal(result.attributedRevenue.usd, 5);
  assert.equal(result.daysCompared, 1);
});

test("reconciliation: revenue and views from deleted videos are exposed as a gap", () => {
  const channelRows = [
    channelDay("2026-09-01", { estimatedRevenueUsd: 10, views: 1000 }),
    channelDay("2026-09-02", { estimatedRevenueUsd: 8, views: 800 }),
    channelDay("2026-09-03", { estimatedRevenueUsd: 4, views: 300 }), // no video rows at all
  ];
  const videoRows = [
    videoDay("a", "2026-09-01", { estimatedRevenueUsd: 6, views: 700 }),
    videoDay("a", "2026-09-02", { estimatedRevenueUsd: 8, views: 800 }),
  ];
  const result = reconcilePeriod(channelRows, videoRows, SEPTEMBER);
  assert.equal(result.channelRevenue.usd, 22, "the channel total is untouched");
  assert.equal(result.attributedRevenue.usd, 14);
  assert.equal(result.unattributedRevenue.usd, 8, "4 on the 1st + 4 on the 3rd");
  assert.equal(result.channelViews, 2100);
  assert.equal(result.attributedViews, 1500);
  assert.equal(result.unattributedViews, 600);
  assert.equal(result.fullyAttributed, false);
  // The gap is reported, not redistributed: video a still has exactly its own revenue.
  const videos = videoPerformance(videoRows, SEPTEMBER, channelTotals(channelRows, SEPTEMBER));
  assert.equal(videos[0].earned.usd, 14);
  assert.equal(channelTotals(channelRows, SEPTEMBER).earned.usd, 22);
});

test("reconciliation: video rows exceeding the channel are flagged and neither side adjusted", () => {
  const result = reconcilePeriod(
    [channelDay("2026-09-01", { estimatedRevenueUsd: 5, views: 100 })],
    [videoDay("a", "2026-09-01", { estimatedRevenueUsd: 9, views: 150 })],
    SEPTEMBER,
  );
  assert.equal(result.daysVideosExceedChannel, 1);
  assert.equal(result.channelRevenue.usd, 5);
  assert.equal(result.attributedRevenue.usd, 9);
  assert.equal(result.unattributedRevenue.usd, 0, "a gap is never negative");
  assert.equal(result.unattributedViews, 0);
});

test("reconciliation: unknown revenue on either side leaves the revenue gap unknown", () => {
  const unknownVideo = reconcilePeriod(
    [channelDay("2026-09-01", { estimatedRevenueUsd: 5, views: 100 })],
    [videoDay("a", "2026-09-01", { estimatedRevenueUsd: null, views: 60 })],
    SEPTEMBER,
  );
  assert.equal(unknownVideo.attributedRevenue.usd, null);
  assert.equal(unknownVideo.unattributedRevenue.usd, null, "not 5, and not 0");
  assert.equal(unknownVideo.unattributedViews, 40, "views are still reconciled");

  const unknownChannel = reconcilePeriod(
    [channelDay("2026-09-01", { estimatedRevenueUsd: null, views: 100 })],
    [videoDay("a", "2026-09-01", { estimatedRevenueUsd: 2, views: 100 })],
    SEPTEMBER,
  );
  assert.equal(unknownChannel.channelRevenue.usd, null);
  assert.equal(unknownChannel.unattributedRevenue.usd, null);
});

test("reconciliation: channels are reconciled separately and video rows without a channel day are set aside", () => {
  const result = reconcilePeriod(
    [
      channelDay("2026-09-01", { estimatedRevenueUsd: 5, views: 100 }),
      channelDay("2026-09-01", { channelId: OTHER_CHANNEL, estimatedRevenueUsd: 3, views: 50 }),
    ],
    [
      videoDay("a", "2026-09-01", { estimatedRevenueUsd: 5, views: 100 }),
      // Belongs to the other channel: must not be used to explain channel-a's total.
      videoDay("b", "2026-09-01", { channelId: OTHER_CHANNEL, estimatedRevenueUsd: 1, views: 20 }),
      videoDay("a", "2026-09-05", { estimatedRevenueUsd: 7, views: 70 }), // no channel row that day
    ],
    SEPTEMBER,
  );
  assert.equal(result.daysCompared, 2);
  assert.equal(result.unattributedRevenue.usd, 2);
  assert.equal(result.unattributedViews, 30);
  assert.equal(result.videoRowsWithoutChannelDay, 1);
  assert.equal(result.attributedRevenue.usd, 6, "the orphan row is not counted");
});

// ---------- 16. incomplete recent days ----------

test("recent days are reported as provisional or pending, and nothing is dropped", () => {
  const period = { startDate: "2026-09-25", endDate: "2026-10-06" };
  const rows = Array.from({ length: 9 }, (_, i) =>
    channelDay(i < 6 ? `2026-09-${25 + i}` : `2026-10-0${i - 5}`, { estimatedRevenueUsd: 1 }),
  ); // 25 Sep … 3 Oct
  const freshness = assessFreshness(rows, period, "2026-10-06");
  assert.equal(freshness.expectedThrough, "2026-10-03");
  assert.equal(freshness.latestStoredDay, "2026-10-03");
  assert.deepEqual(freshness.provisionalDays, ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(freshness.pendingDays, ["2026-10-04", "2026-10-05", "2026-10-06"]);
  assert.deepEqual(freshness.missingDays, []);
  assert.equal(freshness.complete, false);
  assert.equal(channelTotals(rows, period).earned.usd, 9, "provisional days still count");

  const trend = revenueTrend(rows, period, "day", freshness);
  assert.equal(trend.find((p) => p.bucket === "2026-09-30")!.incomplete, false);
  assert.equal(trend.find((p) => p.bucket === "2026-10-02")!.incomplete, true);
  assert.equal(trend.find((p) => p.bucket === "2026-10-05")!.incomplete, true);
  assert.equal(trend.find((p) => p.bucket === "2026-10-05")!.earned.usd, null);
});

test("a settled period with every day stored is complete", () => {
  const rows = daysOf(WEEK).map((day) => channelDay(day));
  const freshness = assessFreshness(rows, WEEK, "2026-10-06");
  assert.equal(freshness.complete, true);
  assert.deepEqual(
    [freshness.provisionalDays, freshness.pendingDays, freshness.missingDays],
    [[], [], []],
  );
});

test("days that should exist but were never stored are reported as missing", () => {
  const rows = [channelDay("2026-09-08"), channelDay("2026-09-10")];
  const freshness = assessFreshness(rows, WEEK, "2026-10-06");
  assert.deepEqual(freshness.missingDays, [
    "2026-09-09",
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
    "2026-09-14",
  ]);
  assert.equal(freshness.complete, false);
});

test("a channel in scope with no rows at all makes its days missing", () => {
  const rows = daysOf(WEEK).map((day) => channelDay(day));
  assert.equal(assessFreshness(rows, WEEK, "2026-10-06").complete, true);
  const withSilentChannel = assessFreshness(rows, WEEK, "2026-10-06", undefined, [
    CHANNEL,
    OTHER_CHANNEL,
  ]);
  assert.equal(withSilentChannel.missingDays.length, 7);
  assert.equal(withSilentChannel.complete, false);
});

test("the lag and provisional windows are configuration", () => {
  const period = { startDate: "2026-10-01", endDate: "2026-10-06" };
  const freshness = assessFreshness([], period, "2026-10-06", {
    dataLagDays: 1,
    provisionalDays: 2,
  });
  assert.equal(freshness.expectedThrough, "2026-10-05");
  assert.deepEqual(freshness.provisionalDays, ["2026-10-04", "2026-10-05"]);
  assert.deepEqual(freshness.pendingDays, ["2026-10-06"]);
});

// ---------- 17. negative / invalid values ----------

test("impossible values are ignored and counted, never absorbed into a total", () => {
  const rows = [
    channelDay("2026-09-01", { estimatedRevenueUsd: 4, views: 1000, watchMinutes: 100 }),
    channelDay("2026-09-02", { views: -50, watchMinutes: Number.NaN, estimatedRevenueUsd: 2 }),
    channelDay("2026-09-03", { estimatedRevenueUsd: Number.NaN, views: 500 }),
    channelDay("2026-09-04", { estimatedRevenueUsd: Number.POSITIVE_INFINITY, views: 500 }),
    channelDay("2026-09-05", {
      estimatedRevenueUsd: "7" as unknown as number,
      views: "12" as unknown as number,
    }),
  ];
  const totals = channelTotals(rows, SEPTEMBER);
  assert.equal(totals.views, 2000, "negative and non-numeric views count as no views");
  assert.equal(totals.watchMinutes, 100 + 0 + 3000 * 3, "non-numeric watch time counts as none");
  assert.equal(totals.earned.usd, 6, "NaN, Infinity and strings are unknown, not 0 and not 7");
  assert.equal(totals.earned.unknownRows, 3);
  assert.equal(totals.earned.availability, "partial");
  assert.equal(totals.invalidRows, 4);
  assert.ok(Number.isFinite(totals.rpm));
});

test("negative revenue is summed as stored and counted, not hidden or clamped", () => {
  const rows = [
    channelDay("2026-09-01", { estimatedRevenueUsd: 10, views: 1000 }),
    channelDay("2026-09-02", { estimatedRevenueUsd: -2, views: 1000 }),
  ];
  const totals = channelTotals(rows, SEPTEMBER);
  assert.equal(totals.earned.usd, 8);
  assert.equal(totals.negativeRevenueRows, 1);
  assert.equal(totals.invalidRows, 0);
  assert.equal(totals.rpm, 4);
});

// ---------- 18. empty datasets ----------

test("an empty dataset produces an explicit 'nothing known', not zeros", () => {
  const summary = summarizeRevenue({
    channelRows: [],
    videoRows: [],
    period: WEEK,
    asOf: "2026-10-06",
  });
  assert.equal(summary.currency, "USD");
  assert.equal(summary.current.earned.usd, null);
  assert.equal(summary.current.earned.availability, "unavailable");
  assert.equal(summary.current.views, 0);
  assert.equal(summary.current.rpm, null);
  assert.equal(summary.previous.earned.usd, null);
  assert.equal(summary.change.earned.percent, null);
  assert.equal(summary.change.earned.absolute, null);
  assert.equal(summary.change.revenueComparable, false);
  assert.deepEqual(summary.videos, []);
  assert.equal(summary.trend.length, 7);
  assert.ok(summary.trend.every((p) => !p.hasData && p.earned.usd === null));
  assert.equal(summary.reconciliation.daysCompared, 0);
  assert.equal(summary.reconciliation.channelRevenue.usd, null);
  assert.equal(summary.reconciliation.fullyAttributed, true);
  assert.equal(summary.freshness.latestStoredDay, null);
  assert.equal(summary.freshness.missingDays.length, 7);
  assert.equal(summary.freshness.complete, false);
  assert.deepEqual(totalsFor([]).split.other, sumRevenue([]));
});

// ---------- the whole summary ----------

test("summary: channel total is authoritative even when video rows add up to something else", () => {
  const channelRows = [
    ...daysOf(previousPeriod(WEEK)).map((day) =>
      channelDay(day, { estimatedRevenueUsd: 10, views: 1000 }),
    ),
    ...daysOf(WEEK).map((day) => channelDay(day, { estimatedRevenueUsd: 20, views: 1000 })),
  ];
  const videoRows = daysOf(WEEK).map((day) =>
    videoDay("only-survivor", day, { estimatedRevenueUsd: 5, views: 250 }),
  );
  const summary = summarizeRevenue({ channelRows, videoRows, period: WEEK, asOf: "2026-10-06" });

  assert.deepEqual(summary.previousPeriod, { startDate: "2026-09-01", endDate: "2026-09-07" });
  assert.equal(summary.current.earned.usd, 140, "from channel rows — not the 35 the videos sum to");
  assert.equal(summary.previous.earned.usd, 70);
  assert.equal(summary.change.earned.percent, 100);
  assert.equal(summary.current.rpm, 20);
  assert.equal(summary.videos.length, 1);
  assert.equal(summary.videos[0].earned.usd, 35);
  assert.equal(summary.videos[0].revenueShare, 0.25);
  assert.equal(summary.reconciliation.unattributedRevenue.usd, 105);
  assert.equal(summary.reconciliation.unattributedViews, 5250);
  assert.equal(summary.reconciliation.fullyAttributed, false);
  assert.equal(summary.trend.length, 7);
  assert.equal(summary.freshness.complete, true);
});

test("summary: no null is ever turned into a zero anywhere in the result", () => {
  const blank = { estimatedRevenueUsd: null, adRevenueUsd: null, premiumRevenueUsd: null };
  const channelRows = [
    ...daysOf(previousPeriod(WEEK)).map((day) => channelDay(day, blank)),
    ...daysOf(WEEK).map((day) => channelDay(day, blank)),
  ];
  const videoRows = daysOf(WEEK).map((day) => videoDay("v", day, blank));
  const summary = summarizeRevenue({ channelRows, videoRows, period: WEEK, asOf: "2026-10-06" });

  // Every money field in the result, wherever it sits, must be null — a single 0 would be a
  // fabricated "YouTube reported zero".
  const moneyFields: Array<[string, unknown]> = [];
  const walk = (value: unknown, path: string) => {
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const at = `${path}.${key}`;
      const isMoneyChange = /.change.(earned|rpm)$/.test(path);
      if (child !== null && typeof child === "object") walk(child, at);
      else if (isMoneyChange || key === "usd" || key === "rpm" || key === "revenueShare")
        moneyFields.push([at, child]);
    }
  };
  walk(summary, "summary");
  assert.ok(moneyFields.length > 30, "the walk found the money fields");
  for (const [path, value] of moneyFields) assert.equal(value, null, `${path} should be null`);
  assert.equal(summary.current.views, 7000, "while activity is still reported in full");
});

// ---------- store row mapping (pure) ----------

test("store mapping keeps a database NULL as null and a 0 as 0", () => {
  assert.equal(nullableNumber(null), null);
  assert.equal(nullableNumber(undefined), null);
  assert.equal(nullableNumber(""), null);
  assert.equal(nullableNumber("not a number"), null);
  assert.equal(nullableNumber(0), 0);
  assert.equal(nullableNumber("0.000000"), 0);
  assert.equal(nullableNumber("12.345678"), 12.345678);

  const row = toChannelRevenueDay({
    channel_id: CHANNEL,
    day: "2026-09-01",
    views: "31",
    watch_minutes: 12,
    estimated_revenue_usd: null,
    ad_revenue_usd: "0.000000",
    premium_revenue_usd: 0,
  });
  assert.deepEqual(row, {
    channelId: CHANNEL,
    day: "2026-09-01",
    views: 31,
    watchMinutes: 12,
    estimatedRevenueUsd: null,
    adRevenueUsd: 0,
    premiumRevenueUsd: 0,
  });
  const videoRow = toVideoRevenueDay({
    video_id: "video-1",
    channel_id: CHANNEL,
    day: "2026-09-01",
    views: 5,
    watch_minutes: 2,
    estimated_revenue_usd: null,
    ad_revenue_usd: null,
    premium_revenue_usd: null,
  });
  assert.equal(videoRow.videoId, "video-1");
  assert.equal(videoRow.estimatedRevenueUsd, null);
});

function daysOf(period: { startDate: string; endDate: string }): string[] {
  const days: string[] = [];
  const cursor = new Date(`${period.startDate}T00:00:00Z`);
  const end = new Date(`${period.endDate}T00:00:00Z`);
  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1))
    days.push(cursor.toISOString().slice(0, 10));
  return days;
}
