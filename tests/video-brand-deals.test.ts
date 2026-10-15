import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { BrandDealsContent, type BrandDealsState } from "../src/components/VideoBrandDealsView";
import {
  BRAND_DEALS_AMOUNT_LABEL,
  BRAND_DEALS_PAYMENTS_NOTE,
  BRAND_DEALS_PERIOD_NOTE,
  BRAND_DEALS_SPLIT_NOTE,
  HIDDEN_AMOUNT,
  formatDealAmount,
  linkDealRequest,
  linkableDeals,
  mapVideoBrandDeals,
  mutationErrorMessage,
  unlinkDealRequest,
  videoDealsUrl,
  type BrandDealsView,
} from "../src/lib/video-brand-deals";
import type { VideoDealView, VideoDealsResponse } from "../src/lib/server/video-deals";

// Phase 2B-2, Step 3: the Brand deals block on a video's Revenue sources. The mapping is pure and
// tested directly; the block itself is rendered to HTML for every state. The API it reads is
// tested in video-deals.test.ts.

const DEAL = {
  usd: "00000000-0000-4000-8000-0000000000a1",
  eur: "00000000-0000-4000-8000-0000000000a2",
  pipeline: "00000000-0000-4000-8000-0000000000a3",
  zero: "00000000-0000-4000-8000-0000000000a4",
};

function deal(overrides: Partial<VideoDealView> & Pick<VideoDealView, "id">): VideoDealView {
  return {
    name: "Deal",
    stage: "contracted",
    currency: "USD",
    linkedVideoCount: 1,
    linkedAt: "2026-10-01T00:00:00.000000+00:00",
    dealValue: 100,
    attribution: { status: "contracted", amount: 100 },
    ...overrides,
  };
}

/** A visible response: a pipeline deal linked first, then a 3-way USD deal, a EUR deal and a
 * contracted zero-value deal. */
function visible(): VideoDealsResponse {
  return {
    data: {
      deals: [
        deal({
          id: DEAL.pipeline,
          name: "Maybe brand",
          stage: "negotiating",
          dealValue: 999,
          attribution: { status: "not_contracted" },
        }),
        deal({
          id: DEAL.usd,
          name: "Acme sponsorship",
          linkedVideoCount: 3,
          dealValue: 100,
          attribution: { status: "contracted", amount: 33.34 },
        }),
        deal({
          id: DEAL.eur,
          name: "Euro brand",
          stage: "completed",
          currency: "EUR",
          dealValue: 250,
          attribution: { status: "contracted", amount: 250 },
        }),
        deal({
          id: DEAL.zero,
          name: "Gifted product",
          dealValue: 0,
          attribution: { status: "contracted", amount: 0 },
        }),
      ],
      contractedByCurrency: [
        { currency: "EUR", amount: 250, dealCount: 1 },
        { currency: "USD", amount: 33.34, dealCount: 2 },
      ],
      payments: { tracked: false },
      period: { filtered: false },
    },
    visibility: { revenue: "visible" },
    permissions: { canLink: true },
  };
}

/** The same deals as a member who may not see amounts receives them. */
function hidden(): VideoDealsResponse {
  const base = visible();
  return {
    data: {
      ...base.data,
      deals: base.data.deals.map((d) => ({
        ...d,
        dealValue: null,
        attribution:
          d.stage === "contracted" || d.stage === "completed"
            ? { status: "hidden" as const }
            : { status: "not_contracted" as const },
      })),
      contractedByCurrency: null,
    },
    visibility: { revenue: "hidden" },
    permissions: { canLink: false },
  };
}

function empty(canLink = true): VideoDealsResponse {
  return {
    data: {
      deals: [],
      contractedByCurrency: [],
      payments: { tracked: false },
      period: { filtered: false },
    },
    visibility: { revenue: "visible" },
    permissions: { canLink },
  };
}

const router = createRouter({
  routeTree: createRootRoute(),
  history: createMemoryHistory({ initialEntries: ["/videos/x"] }),
});
const render = (state: BrandDealsState, pendingId: string | null = null) =>
  renderToStaticMarkup(
    createElement(
      RouterContextProvider,
      { router },
      createElement(BrandDealsContent, {
        state,
        pendingId,
        onRetry: () => {},
        onUnlink: () => {},
      }),
    ),
  );
const ready = (view: BrandDealsView, refreshing = false): BrandDealsState => ({
  status: "ready",
  view,
  refreshing,
});
const count = (html: string, needle: string) => html.split(needle).length - 1;

// ============================================================
// Requests
// ============================================================

test("requests: the video's own endpoint, a strict POST body, and a DELETE by query", () => {
  assert.equal(videoDealsUrl("vidAAAAAAA1"), "/api/videos/deals?videoId=vidAAAAAAA1");
  assert.equal(videoDealsUrl("not a video"), null);
  assert.equal(videoDealsUrl(""), null);
  assert.equal(
    videoDealsUrl("demo-video-1", { demo: true }),
    "/api/videos/deals?videoId=demo-video-1",
  );
  const [postUrl, post] = linkDealRequest("vidAAAAAAA1", DEAL.usd);
  assert.equal(postUrl, "/api/videos/deals");
  assert.equal(post.method, "POST");
  assert.deepEqual(JSON.parse(String(post.body)), { videoId: "vidAAAAAAA1", dealId: DEAL.usd });
  const [deleteUrl, del] = unlinkDealRequest("vidAAAAAAA1", DEAL.usd);
  assert.equal(del.method, "DELETE");
  assert.equal(del.body, undefined);
  assert.equal(deleteUrl, `/api/videos/deals?videoId=vidAAAAAAA1&dealId=${DEAL.usd}`);
});

// ============================================================
// Mapping
// ============================================================

test("mapping: contracted deals first with their share, pipeline deals after with no amount", () => {
  const view = mapVideoBrandDeals(visible());
  assert.equal(view.state, "deals");
  assert.equal(view.hidden, false);
  assert.equal(view.canLink, true);
  assert.deepEqual(
    view.deals.map((d) => [
      d.name,
      d.stageLabel,
      d.contracted,
      d.attributed,
      d.dealValue,
      d.splitLabel,
    ]),
    [
      ["Acme sponsorship", "Contracted", true, "$33.34", "$100.00", "1 of 3 linked videos"],
      ["Euro brand", "Completed", true, "€250.00", "€250.00", "Linked to this video only"],
      ["Gifted product", "Contracted", true, "$0.00", "$0.00", "Linked to this video only"],
      [
        "Maybe brand",
        "Negotiating",
        false,
        "Not contracted",
        "$999.00",
        "Linked to this video only",
      ],
    ],
  );
  assert.deepEqual(view.linkedIds.sort(), Object.values(DEAL).sort());
});

test("mapping: totals stay per currency — never added together, never mixed with YouTube revenue", () => {
  const view = mapVideoBrandDeals(visible());
  assert.deepEqual(view.totals, [
    { currency: "EUR", amount: "€250.00", dealLabel: "from 1 contracted deal" },
    { currency: "USD", amount: "$33.34", dealLabel: "from 2 contracted deals" },
  ]);
  // No combined figure anywhere.
  assert.doesNotMatch(JSON.stringify(view), /283\.34|\$283|€283/);
  // A currency the browser cannot format is printed beside the number, not guessed.
  assert.equal(formatDealAmount(1234.5, "UNKNOWN"), "1,234.50 UNKNOWN");
  assert.equal(formatDealAmount(0.1, "USD"), "$0.10");
});

test("mapping: hidden amounts are 'Hidden' — never a zero — and pipeline deals still read 'Not contracted'", () => {
  const view = mapVideoBrandDeals(hidden());
  assert.equal(view.hidden, true);
  assert.equal(view.canLink, false);
  assert.equal(view.totals, null);
  assert.deepEqual(
    view.deals.map((d) => [d.name, d.attributed, d.dealValue]),
    [
      ["Acme sponsorship", HIDDEN_AMOUNT, HIDDEN_AMOUNT],
      ["Euro brand", HIDDEN_AMOUNT, HIDDEN_AMOUNT],
      ["Gifted product", HIDDEN_AMOUNT, HIDDEN_AMOUNT],
      ["Maybe brand", "Not contracted", HIDDEN_AMOUNT],
    ],
  );
  assert.doesNotMatch(JSON.stringify(view), /\$|€|\d\.\d\d/);
});

test("mapping: no linked deals is the empty state; a visible viewer's totals are an empty list, not zero", () => {
  const view = mapVideoBrandDeals(empty());
  assert.equal(view.state, "empty");
  assert.deepEqual(view.totals, []);
  assert.deepEqual(view.deals, []);
});

test("the link dialog lists the workspace's other deals by name, with their stage, never the linked ones", () => {
  const options = linkableDeals(
    [
      { id: "d3", name: "Zeta", stage: "prospect" },
      { id: DEAL.usd, name: "Acme sponsorship", stage: "contracted" },
      { id: "d1", name: "Beta", stage: "completed" },
      { id: "d2", name: "beta", stage: "pitched" },
    ],
    [DEAL.usd],
  );
  assert.deepEqual(
    options.map((o) => [o.name, o.stageLabel, o.contracted]),
    [
      ["beta", "Pitched", false],
      ["Beta", "Completed", true],
      ["Zeta", "Prospect", false],
    ],
  );
});

test("errors from linking or unlinking are explained, never shown as figures", () => {
  assert.match(mutationErrorMessage(403, "REVENUE_HIDDEN"), /can see deal amounts/);
  assert.match(mutationErrorMessage(403, "FEATURE_DISABLED"), /aren't available for your role/);
  assert.match(mutationErrorMessage(404, "DEAL_NOT_FOUND"), /no longer available/);
  assert.match(mutationErrorMessage(409, "LINK_REFUSED"), /changed/);
  assert.match(mutationErrorMessage(500, "DATABASE_ERROR"), /try again/);
  assert.match(mutationErrorMessage(0, null), /try again/);
});

// ============================================================
// The block, rendered
// ============================================================

test("rendered: loading, restricted and error states — no figures in any of them", () => {
  const loading = render({ status: "loading" });
  assert.match(loading, /role="status" aria-label="Loading brand deals" aria-busy="true"/);
  const restricted = render({ status: "restricted" });
  assert.match(restricted, /Brand deals aren&#x27;t available for your role\./);
  const error = render({ status: "error" });
  assert.match(error, /role="alert"/);
  assert.match(error, /We couldn&#x27;t load this video&#x27;s brand deals/);
  assert.match(error, />Try again</);
  for (const html of [loading, restricted, error]) {
    assert.doesNotMatch(html, /\$|€|Link a deal|Unlink|Attributed sponsorship value/);
    assert.match(html, /<h3[^>]*>Brand deals<\/h3>/);
  }
});

test("rendered: the empty state offers linking only to those who may, and always a way to the deals", () => {
  const canLink = render(ready(mapVideoBrandDeals(empty(true))));
  assert.match(canLink, /No brand deals are linked to this video yet\./);
  assert.match(canLink, /data-testid="deals-link-open"/);
  assert.match(canLink, /href="\/brand-deals"/);
  const cannot = render(ready(mapVideoBrandDeals(empty(false))));
  assert.doesNotMatch(cannot, /Link a deal|deals-link-open/);
  assert.match(cannot, /href="\/brand-deals"/);
});

test("rendered: linked deals with their share, per-currency totals, pipeline marked, and every caveat stated", () => {
  const html = render(ready(mapVideoBrandDeals(visible())));
  assert.equal(
    count(html, BRAND_DEALS_AMOUNT_LABEL),
    3,
    "the label, once per currency total (screen readers)",
  );
  assert.equal(count(html, 'data-testid="deals-total"'), 2);
  assert.match(html, /€250\.00/);
  assert.match(html, /\$33\.34/);
  assert.equal(count(html, 'data-testid="deals-row"'), 4);
  assert.equal(count(html, 'data-contracted="true"'), 3);
  assert.equal(count(html, 'data-contracted="false"'), 1);
  assert.match(html, /Pipeline · Negotiating/);
  assert.match(html, />Not contracted</);
  assert.match(html, /1 of 3 linked videos/);
  for (const note of [BRAND_DEALS_SPLIT_NOTE, BRAND_DEALS_PERIOD_NOTE, BRAND_DEALS_PAYMENTS_NOTE])
    assert.ok(html.includes(note.replace(/'/g, "&#x27;")), note);
  // Agreed value, not income.
  assert.doesNotMatch(html, /received revenue|revenue received|paid|earned|income/i);
  // Controls follow permissions.canLink: one Link button and one Unlink per row.
  assert.equal(count(html, 'data-testid="deals-link-open"'), 1);
  assert.equal(count(html, 'data-testid="deals-unlink"'), 4);
  assert.match(html, /aria-label="Unlink Acme sponsorship from this video"/);
});

test("rendered: a member who may not see amounts gets names and stages, 'Hidden' amounts and no controls", () => {
  const html = render(ready(mapVideoBrandDeals(hidden())));
  assert.match(html, /Deal amounts are hidden by your workspace&#x27;s settings\./);
  assert.match(html, /Acme sponsorship/);
  assert.match(html, /Pipeline · Negotiating/);
  assert.ok(count(html, HIDDEN_AMOUNT) >= 7, "total, three shares and four deal values");
  assert.doesNotMatch(html, /\$|€|0\.00|33\.34/);
  assert.doesNotMatch(html, /deals-link-open|deals-unlink/);
});

test("rendered: while a link or unlink is in flight the controls are disabled, and a refresh dims the last figures", () => {
  const view = mapVideoBrandDeals(visible());
  const pending = render(ready(view), DEAL.usd);
  assert.equal(count(pending, 'disabled=""'), 5, "Link a deal and all four Unlink buttons");
  assert.equal(count(render(ready(view)), 'disabled=""'), 0);
  assert.match(pending, /Unlinking…/);
  assert.match(render(ready(view, true)), /aria-busy="true" class="opacity-60/);
});

// ============================================================
// Wiring
// ============================================================

const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");

test("wiring: inside Revenue sources, after tracked links; the overview and YouTube revenue are untouched", () => {
  const sources = flat("src/components/VideoRevenueSources.tsx");
  const links = sources.indexOf('data-testid="sources-links"');
  const deals = sources.indexOf("<VideoBrandDeals");
  const notConnected = sources.indexOf("{SOURCES_NOT_CONNECTED_NOTE}");
  assert.ok(links > 0 && links < deals && deals < notConnected);
  assert.match(
    sources,
    /<VideoBrandDeals youtubeVideoId=\{youtubeVideoId\} refreshNonce=\{refreshNonce\} \/>/,
  );
  // The link-activity part still has no money in it (its own rule).
  assert.doesNotMatch(sources, /\$\{?\d|toFixed|reduce\(|usd|formatVideoRevenue/);
  // The Revenue overview (YouTube estimated revenue) neither reads nor adds any deal figure; it
  // still says plainly that brand deals are not included in it.
  for (const file of [
    "src/components/VideoRevenueOverview.tsx",
    "src/lib/video-revenue-overview.ts",
  ])
    assert.doesNotMatch(
      flat(file),
      /api\/videos\/deals|VideoBrandDeals|video-brand-deals|dealValue|attribution/,
    );
  assert.match(
    flat("src/lib/video-revenue-overview.ts"),
    /YouTube estimated revenue for this video\. Brand deals, affiliate commissions and tracked-link activity are not included\./,
  );
});

test("wiring: the block loads its own endpoint, treats 403 as restricted, and uses the POST/DELETE answer as is", () => {
  const container = flat("src/components/VideoBrandDeals.tsx");
  assert.match(container, /videoDealsUrl\(youtubeVideoId, \{ demo: IS_LOCAL_DEMO \}\)/);
  assert.match(
    container,
    /if \(response\.status === 403\) \{ setState\(\{ status: "restricted" \}\); return; \}/,
  );
  assert.doesNotMatch(container, /api\/revenue\/|api\/youtube\/|link-activity/);
  // The mutation: one request, and its body becomes the state — no follow-up GET or retry.
  const mutate = container.slice(
    container.indexOf("const mutate = useCallback("),
    container.indexOf("return ( <>"),
  );
  assert.equal(count(mutate, "fetch("), 1);
  assert.match(
    mutate,
    /setState\(\{ status: "ready", view: mapVideoBrandDeals\(body as VideoDealsResponse\), refreshing: false, \}\)/,
  );
  assert.doesNotMatch(mutate, /setRetryNonce|videoDealsUrl/);
  // An answer for a video the page has since left is dropped.
  assert.match(mutate, /if \(currentVideo\.current !== video\) return false;/);
  // The link dialog is rendered only when the API said the caller may link.
  assert.match(
    container,
    /state\.status === "ready" && state\.view\.canLink && \( <LinkDealDialog/,
  );
});
