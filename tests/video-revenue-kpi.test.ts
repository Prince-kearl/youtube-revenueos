import test from "node:test";
import assert from "node:assert/strict";
import { videoRevenueKpi, type VideoRevenueOverviewView } from "../src/lib/video-revenue-overview";

// The "Estimated revenue" KPI card on a video's page shows the Revenue overview's own figure: the
// amount, a change only when both periods are fully known, and never a zero for an amount that is
// hidden or unknown.

const base: VideoRevenueOverviewView = {
  state: "reported",
  headline: "$60.00",
  hasAmount: true,
  amountUsd: 60,
  note: "",
  periodLabel: "1 Sep 2026 – 30 Sep 2026",
  periodDays: 30,
  rpm: "$2.00",
  change: null,
  sources: [],
  sourcesNote: null,
  freshnessNote: "",
  completenessNote: null,
};

test("an amount with a comparison: the change, and a line from the previous period to this one", () => {
  const card = videoRevenueKpi({
    ...base,
    change: {
      text: "+100.0%",
      positive: true,
      comparedWith: "2 Aug – 31 Aug",
      percent: 100,
      previousUsd: 30,
    },
  });
  assert.deepEqual(card, {
    value: "$60.00",
    changePercent: 100,
    positive: true,
    deltaLabel: "+100.0%",
    deltaSuffix: "vs previous period",
    series: [30, 60],
  });
});

test("an amount without a comparison: no change badge, and a partly reported one says so", () => {
  const card = videoRevenueKpi(base);
  assert.equal(card.changePercent, null);
  assert.equal(card.deltaSuffix, "this period");
  assert.deepEqual(card.series, [60]);
  assert.equal(videoRevenueKpi({ ...base, state: "partial" }).deltaSuffix, "partly reported");
});

test("hidden or unknown revenue is never a zero", () => {
  for (const [state, headline, suffix] of [
    ["hidden", "Hidden", "hidden by revenue settings"],
    ["unavailable", "—", "not reported by YouTube"],
    ["history_pending", "—", "after the next sync"],
    ["no_data_in_period", "—", "nothing stored this period"],
  ] as const) {
    const card = videoRevenueKpi({
      ...base,
      state,
      headline,
      hasAmount: false,
      amountUsd: null,
      rpm: null,
    });
    assert.equal(card.value, headline, state);
    assert.equal(card.deltaSuffix, suffix, state);
    assert.deepEqual(card.series, [], state);
    assert.equal(card.changePercent, null, state);
  }
});
