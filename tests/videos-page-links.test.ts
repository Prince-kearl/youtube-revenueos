import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// On the Videos page a video's title (and thumbnail) opens its analytics page in Tubify — on
// desktop as on phones. YouTube is reached from that page ("Open on YouTube" in its header).

const page = readFileSync("src/routes/videos.tsx", "utf8").replace(/\r\n/g, "\n");
const row = page.slice(page.indexOf("function VideoRow("));

test("desktop: the video's title and thumbnail open its analytics page", () => {
  assert.match(
    row,
    /<Link\s+to="\/videos\/\$videoId"\s+params=\{\{ videoId: video\.id \}\}\s+className="group flex[^"]*"\s*>\s*<VideoThumbnail video=\{video\} \/>[\s\S]*?\{video\.title\}[\s\S]*?<\/Link>/,
  );
  // The title is never wrapped in the YouTube link any more.
  assert.doesNotMatch(
    row.slice(0, row.indexOf("</td>")),
    /href=\{video\.url\}[^]*?\{video\.title\}/,
  );
});

test("the list has no YouTube links: the video's analytics page has 'Open on YouTube'", () => {
  // (A real link, not the words in a code comment.)
  assert.doesNotMatch(page, /href=\{video\.url\}|>\s*Open on YouTube\s*</);
  const videoPage = readFileSync("src/routes/videos.$videoId.tsx", "utf8").replace(/\r\n/g, "\n");
  assert.match(videoPage, /href=\{data\.video\.url\}[\s\S]*?Open on YouTube/);
});

test("phones: the card's title already opens analytics", () => {
  const card = page.slice(0, page.indexOf("function VideoRow("));
  assert.match(
    card,
    /<Link\s+to="\/videos\/\$videoId"\s+params=\{\{ videoId: video\.id \}\}\s+className="line-clamp-2[^"]*"\s*>\s*\{video\.title\}/,
  );
});
