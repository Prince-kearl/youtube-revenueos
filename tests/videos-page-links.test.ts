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

test("phones: the card's title and thumbnail open analytics, with no separate 'View analytics'", () => {
  const card = page.slice(page.indexOf("function VideoCard("), page.indexOf("function CardStat("));
  // The row (thumbnail included) is covered by the title's link, stretched with ::after over the
  // whole row; only the comment count, a separate link to Comment Automation, sits above it.
  assert.match(
    card,
    /<li className="group relative flex items-center gap-3 rounded-xl card-gradient-outline px-4 py-3">\s*<VideoThumbnail video=\{video\} \/>/,
  );
  assert.match(
    card,
    /<Link\s+to="\/videos\/\$videoId"\s+params=\{\{ videoId: video\.id \}\}\s+className="[^"]*after:absolute after:inset-0 after:content-\[''\][^"]*"\s*>\s*\{video\.title\}\s*<\/Link>/,
  );
  assert.doesNotMatch(card, /View analytics/);
  assert.equal(card.match(/to="\/videos\/\$videoId"/g)?.length, 1, "one analytics link per row");
});

test("dropdown options are readable in the dark theme", () => {
  // The dark theme tells the browser it is dark, so native lists (a <select>'s options) are
  // drawn dark too — not light text on the browser's white list.
  const styles = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");
  const dark = styles.slice(
    styles.indexOf("\n.dark {"),
    styles.indexOf("}", styles.indexOf("\n.dark {")),
  );
  assert.match(dark, /color-scheme: dark;/);
  // The sort menu sets its options' colours as well.
  assert.match(page, /\[&>option\]:bg-card \[&>option\]:text-foreground/);
});
