import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Fragment, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { KpiCarousel } from "../src/components/KpiCarousel";

// The KPI row on every page other than the Dashboard: one card in view on a phone, sliding by
// itself; the page's ordinary grid from `sm` up. These render the component to markup and read
// the pages' source; the motion itself is checked in a browser.

const card = (name: string) => createElement("article", { key: name, "data-card": name }, name);
const render = (children: ReactNode, props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(KpiCarousel, { gridClassName: "gap-3 sm:grid-cols-2", ...props }, children),
  );
const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;
const SLIDE = /<div class="w-full shrink-0 snap-start sm:contents">/g;
const CLONE = /<div aria-hidden="true" inert="" class="w-full shrink-0 snap-start sm:hidden">/g;
const DOT = /<button type="button" role="tab"/g;

test("each card is one slide on a phone and a plain grid item from sm up", () => {
  const html = render([card("a"), card("b"), card("c")], { className: "mt-6" });
  assert.match(html, /^<div class="mt-6"><div class="flex snap-x snap-mandatory overflow-x-auto /);
  // The row is a horizontal scroller on a phone and the page's own grid above it.
  assert.match(html, /sm:grid sm:snap-none sm:overflow-visible[^"]* gap-3 sm:grid-cols-2"/);
  assert.equal(count(html, SLIDE), 3);
  // `sm:contents` removes the slide wrapper from layout, so the card itself is the grid item.
  for (const name of ["a", "b", "c"])
    assert.match(html, new RegExp(`sm:contents"><article data-card="${name}">`));
});

test("the loop clone repeats the first card, hidden from sm up and from assistive technology", () => {
  const html = render([card("a"), card("b"), card("c")]);
  assert.equal(count(html, CLONE), 1);
  assert.match(html, /sm:hidden"><article data-card="a">a<\/article><\/div><\/div>/);
  // The first card therefore appears twice, every other card once.
  assert.equal(count(html, /data-card="a"/g), 2);
  assert.equal(count(html, /data-card="b"/g), 1);
});

test("one dot per real card, shown on phones only, with the first selected", () => {
  const html = render([card("a"), card("b"), card("c"), card("d")]);
  assert.equal(count(html, DOT), 4);
  assert.match(
    html,
    /<div class="mt-3 flex items-center justify-center gap-1\.5 sm:hidden" role="tablist"/,
  );
  assert.equal(count(html, /aria-selected="true"/g), 1);
  assert.match(html, /aria-selected="true" aria-label="Go to KPI card 1"/);
});

test("fragments and conditionals are flattened: the cards inside them are the slides", () => {
  const html = render(
    createElement(
      Fragment,
      null,
      card("a"),
      false,
      null,
      createElement(Fragment, null, card("b"), card("c")),
    ),
  );
  assert.equal(count(html, SLIDE), 3);
  assert.equal(count(html, DOT), 3);
});

test("while loading: the placeholders are slides, with no clone, no dots and aria-busy", () => {
  const html = render([card("s1"), card("s2"), card("s3")], {
    loading: true,
    "aria-label": "Loading key metrics",
  });
  assert.equal(count(html, SLIDE), 3);
  assert.equal(count(html, CLONE), 0);
  assert.equal(count(html, DOT), 0);
  assert.match(html, /aria-busy="true" aria-label="Loading key metrics"/);
  assert.match(render([card("a"), card("b")]), /aria-busy="false"/);
});

test("a single card is not a carousel", () => {
  const html = render([card("only")]);
  assert.equal(count(html, SLIDE), 1);
  assert.equal(count(html, CLONE), 0);
  assert.equal(count(html, DOT), 0);
});

test("autoplay: every three seconds, phones only, stopped by touch and by reduced motion", () => {
  const source = readFileSync("src/components/KpiCarousel.tsx", "utf8").replace(/\s+/g, " ");
  assert.match(source, /const AUTOPLAY_MS = 3000;/);
  assert.match(source, /el\.addEventListener\("pointerdown", pause\);/);
  assert.match(source, /el\.addEventListener\("touchstart", pause, \{ passive: true \}\);/);
  assert.match(source, /if \(window\.matchMedia\(REDUCED_MOTION_QUERY\)\.matches\) return;/);
  assert.match(source, /if \(paused \|\| desktop\.matches \|\| document\.hidden\) return;/);
  // The jump back from the clone to the first card is not animated.
  assert.match(source, /el\.scrollTo\(\{ left: items\[0\]\.offsetLeft, behavior: "auto" \}\)/);
  // Everything it starts, it stops.
  assert.match(source, /window\.clearInterval\(interval\); window\.clearTimeout\(reset\);/);
});

test("every page's KPI cards sit inside the carousel, with the grid it had before", () => {
  const pages: Record<string, string[]> = {
    "src/routes/affiliate.tsx": ["gap-3 sm:grid-cols-2 lg:grid-cols-4"],
    "src/routes/analytics.tsx": ["gap-3 sm:grid-cols-2 lg:grid-cols-4"],
    "src/routes/audience.tsx": [
      "gap-3 sm:grid-cols-2 lg:grid-cols-4",
      "gap-3 sm:grid-cols-2 lg:grid-cols-4",
    ],
    "src/routes/brand-deals.tsx": ["gap-4 sm:grid-cols-2 lg:grid-cols-4"],
    "src/routes/comments.tsx": ["gap-3 sm:grid-cols-3"],
    "src/routes/email.tsx": ["gap-4 sm:grid-cols-3"],
    "src/routes/freebie.tsx": ["gap-4 sm:grid-cols-3"],
    // Six cards (revenue, revenue per 1,000 views and the four activity cards): three per row.
    "src/routes/videos.$videoId.tsx": [
      "gap-3 sm:grid-cols-2 xl:grid-cols-3",
      "gap-3 sm:grid-cols-2 xl:grid-cols-3",
    ],
  };
  for (const [file, grids] of Object.entries(pages)) {
    const source = readFileSync(file, "utf8");
    assert.deepEqual(
      [...source.matchAll(/gridClassName="([^"]+)"/g)].map((match) => match[1]),
      grids,
      file,
    );
    // Every KPI card (and placeholder) is between a carousel's opening and closing tag.
    const ranges = [...source.matchAll(/<KpiCarousel[\s\S]*?<\/KpiCarousel>/g)].map((match) => [
      match.index,
      match.index + match[0].length,
    ]);
    const cards = [...source.matchAll(/<KpiTrendCard(Skeleton)?\b/g)].map((match) => match.index);
    assert.ok(cards.length > 0, file);
    for (const at of cards)
      assert.ok(
        ranges.some(([from, to]) => at > from && at < to),
        `${file}: a KPI card at ${at} is outside the carousel`,
      );
  }
  // The Dashboard keeps its own, original implementation.
  assert.doesNotMatch(readFileSync("src/routes/dashboard.tsx", "utf8"), /KpiCarousel/);
});
