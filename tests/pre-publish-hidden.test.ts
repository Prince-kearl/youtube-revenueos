import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRE_PUBLISH_ENABLED } from "../src/lib/feature-flags";

// Pre-Publish is hidden for now (src/lib/feature-flags.ts): no button, tab or upload option leads
// to it, and its pages send an old link back to Videos. Nothing is deleted — switching the flag on
// restores it.

const source = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

test("Pre-Publish is switched off", () => {
  assert.equal(PRE_PUBLISH_ENABLED, false);
});

test("every way into Pre-Publish is behind the switch", () => {
  const videos = source("src/routes/videos.tsx");
  assert.match(
    videos,
    /\{PRE_PUBLISH_ENABLED && \(\s*<button[\s\S]*?Analyze Before Publishing\s*<\/button>\s*\)\}/,
    "the Analyze Before Publishing button",
  );
  assert.match(
    videos,
    /\{PRE_PUBLISH_ENABLED && \(\s*<div[^>]*>[\s\S]*?to="\/pre-publish"[\s\S]*?Pre-Publish\s*<\/Link>\s*<\/div>\s*\)\}/,
    "the Pre-Publish tab",
  );
  assert.match(videos, /\{PRE_PUBLISH_ENABLED && \(\s*<PrePublishUploadDialog/);
  const analyze = source("src/routes/add-video.tsx");
  assert.match(
    analyze,
    /\{PRE_PUBLISH_ENABLED && \(\s*<button[\s\S]*?Upload a video \(not yet published\)[\s\S]*?<\/button>\s*\)\}/,
    "the upload option on Analyze Video",
  );
  assert.match(analyze, /\{PRE_PUBLISH_ENABLED && \(\s*<PrePublishUploadDialog/);
});

test("an old Pre-Publish link goes to Videos (the video pages are nested under it)", () => {
  const route = source("src/routes/pre-publish.tsx");
  assert.match(
    route,
    /beforeLoad: \(\) => \{\s*if \(!PRE_PUBLISH_ENABLED\) throw redirect\(\{ to: "\/videos" \}\);/,
  );
  // /pre-publish/$id is a child of /pre-publish, so the redirect above covers it.
  assert.match(
    source("src/routes/pre-publish.$id.tsx"),
    /createFileRoute\("\/pre-publish\/\$id"\)/,
  );
});
