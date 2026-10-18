import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Phones: the app must sit idle when nobody touches it. The banner's rotating glow ring used to
// write a CSS variable on :root every animation frame, which made the browser re-check every
// element's styles and repaint the frosted-glass layers ~60 times a second; iOS Safari ended up
// killing and reloading the page ("A problem repeatedly occurred"). And the dashboard's KPI dots
// kept their state in Dashboard, so each automatic carousel step re-rendered the whole page.

const driver = readFileSync("src/components/NavGlowDriver.tsx", "utf8");
const dashboard = readFileSync("src/routes/dashboard.tsx", "utf8");

test("the glow ring never writes on :root, and does not animate on touch devices", () => {
  assert.doesNotMatch(driver, /document\.documentElement\.style/);
  assert.match(driver, /if \(window\.matchMedia\("\(pointer: coarse\)"\)\.matches\) return;/);
  assert.match(
    driver,
    /if \(window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches\) return;/,
  );
  // Desktop still rotates it, on the ring elements only.
  assert.match(
    driver,
    /document\.querySelectorAll<HTMLElement>\("\.nav-glow-motion"\)\)\s+element\.style\.setProperty\("--nav-glow-angle", angle\)/,
  );
  assert.match(driver, /return \(\) => cancelAnimationFrame\(frame\);/);
});

test("the KPI carousel's current card lives in its dots, not in Dashboard", () => {
  assert.doesNotMatch(dashboard, /activeKpiIndex|setActiveKpiIndex/);
  assert.match(
    dashboard,
    /<KpiCardDots scrollRef=\{kpiScrollRef\} resetKey=\{youtubeStatus\} count=\{6\} \/>/,
  );
  assert.match(dashboard, /function KpiCardDots\(/);
  assert.match(dashboard, /const \[activeIndex, setActiveIndex\] = useState\(0\);/);
  assert.match(dashboard, /return \(\) => el\.removeEventListener\("scroll", updateActiveIndex\);/);
});
