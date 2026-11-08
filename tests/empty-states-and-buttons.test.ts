import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState, ErrorState } from "../src/components/ui-bits";
import { buttonPrimary, buttonSecondary } from "../src/lib/button-styles";

// Empty, no-results and error states share one look (a soft illustration, a title, one muted
// line, then a pill button), and in-app buttons use the two shared pill styles.

test("an empty state shows its illustration, title, description and actions", () => {
  const html = renderToStaticMarkup(
    createElement(
      EmptyState,
      { illustration: "search", title: "No matching links", description: "Try another word." },
      createElement("button", { className: buttonSecondary }, "Clear search"),
    ),
  );
  assert.match(html, /data-illustration="search"/);
  assert.match(html, /<svg[^>]*aria-hidden="true"/, "the illustration is decorative");
  assert.match(html, /<h2[^>]*>No matching links<\/h2>/);
  assert.match(html, /Try another word\./);
  assert.match(html, /Clear search/);
  assert.doesNotMatch(html, /border-dashed/, "no dashed box around it any more");
});

test("the default illustration is the open box, and sm fits inside a card", () => {
  const html = renderToStaticMarkup(createElement(EmptyState, { title: "x", size: "sm" }));
  assert.match(html, /data-illustration="box"/);
  assert.match(html, /class="[^"]*h-20/);
});

test("an error state is announced, shows the error illustration and a pill retry button", () => {
  const html = renderToStaticMarkup(
    createElement(ErrorState, { title: "We couldn't load", onRetry: () => {} }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /data-illustration="error"/);
  assert.match(html, /rounded-full bg-primary/);
  assert.match(html, />Try again<\/button>/);
  // without a retry handler there is no button
  const noRetry = renderToStaticMarkup(createElement(ErrorState, { title: "x" }));
  assert.doesNotMatch(noRetry, /<button/);
});

test("two illustrations on one page get their own gradient ids", () => {
  const html = renderToStaticMarkup(
    createElement("div", null, [
      createElement(EmptyState, { key: 1, title: "a" }),
      createElement(EmptyState, { key: 2, title: "b" }),
    ]),
  );
  const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("illustration colours follow light and dark mode", () => {
  const css = readFileSync("src/styles.css", "utf8");
  for (const token of ["--illus-hi", "--illus-lo", "--illus-line", "--illus-ground"]) {
    assert.match(css, new RegExp(`:root \\{[^}]*${token}:`), token);
    assert.match(css, new RegExp(`\\.dark \\{[^}]*${token}:`), token);
  }
});

test("the shared buttons are pills of one size", () => {
  for (const style of [buttonPrimary, buttonSecondary]) {
    assert.match(style, /\bh-9\b/);
    assert.match(style, /\brounded-full\b/);
    assert.match(style, /\bpx-3\.5\b/);
    assert.match(style, /\btext-sm font-medium\b/);
  }
  assert.match(
    buttonPrimary,
    /bg-primary text-primary-foreground|bg-primary px-3\.5 text-sm font-medium text-primary-foreground/,
  );
  assert.match(buttonSecondary, /border border-border/);
});

test("Destinations: the add buttons are the app's primary button, not dashed tiles", () => {
  const page = readFileSync("src/routes/destinations.tsx", "utf8");
  assert.doesNotMatch(page, /border-dashed/);
  for (const label of ["Add new destination", "Add social destination"]) {
    const at = page.indexOf(label);
    assert.ok(at > 0, label);
    assert.match(page.slice(at - 200, at), /className=\{buttonPrimary\}/, label);
  }
});

test("app pages no longer hand-roll primary buttons", () => {
  const pages = [
    "brand-deals",
    "comments",
    "destinations",
    "link-tracking",
    "pre-publish",
    "settings",
    "videos",
    "freebie",
    "leads",
  ];
  for (const name of pages) {
    const source = readFileSync(`src/routes/${name}.tsx`, "utf8");
    // a text button styled by hand: brand fill, brand text and its own padding (icon-only
    // buttons and avatars have no horizontal padding and keep their own shape)
    const handRolled = [...source.matchAll(/<([A-Za-z]+)[^<]*?className="([^"]*)"/g)]
      .filter((m) => ["button", "Link", "a"].includes(m[1]))
      .map((m) => m[2])
      .filter(
        (c) =>
          /(^| )bg-primary( |$)/.test(c) &&
          /(^| )text-primary-foreground( |$)/.test(c) &&
          /(^| )px-/.test(c),
      )
      .filter((c) => !/(^| )sr-only( |$)/.test(c));
    assert.deepEqual(handRolled, [], name);
  }
});
