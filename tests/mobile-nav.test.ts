import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The phone navigation (MobileDock), used by the workspace app and the admin console: an icon
// pill for the primary destinations, and a round button ("+", turning into "×") that opens every
// destination as a panel of tiles in the pill's place.

const read = (file: string) => readFileSync(file, "utf8").replace(/\s+/g, " ");
const dock = read("src/components/MobileDock.tsx");
const layout = read("src/components/DashboardLayout.tsx");
const admin = read("src/components/admin/AdminNav.tsx");

test("both the workspace app and the admin console use the same dock", () => {
  assert.match(
    layout,
    /<MobileDock label="Primary" panelLabel="All pages" moreLabel="More pages" hideAt="md"/,
  );
  assert.match(
    admin,
    /<MobileDock label="Admin" panelLabel="Admin sections" moreLabel="More admin sections" hideAt="lg"/,
  );
  // Neither keeps its old bottom sheet for "more".
  assert.doesNotMatch(layout, /<Sheet open=\{moreOpen\}/);
  assert.doesNotMatch(admin, /<Sheet|setMoreOpen/);
  // The admin panel lists every section, in the rail's order.
  assert.match(admin, /items: ALL_ITEMS\.map\(\(item\) => dockItem\(item, active, onSelect\)\)/);
  // Long section names get a short tile label; the full name stays the accessible name.
  assert.match(admin, /features: "Features",/);
  assert.match(dock, /\{item\.shortLabel \?\? item\.label\}/);
  assert.match(dock, /"aria-label": inPanel && !item\.shortLabel \? undefined : item\.label,/);
});

test("pill icons sit in fixed slots (no spreading), and every one has a name", () => {
  assert.match(
    dock,
    /"group flex h-full w-14 min-w-0 shrink items-center justify-center rounded-full outline-none"/,
  );
  assert.doesNotMatch(dock, /flex-1 items-center justify-center rounded-full/);
  assert.match(
    dock,
    /"aria-label": inPanel && !item\.shortLabel \? undefined : item\.label, title: inPanel \? undefined : item\.label,/,
  );
});

test("the current page is highlighted like the desktop rail: a red, outlined, perfect circle", () => {
  // The same class the desktop rail uses, on a square (so truly circular) inside the slot.
  assert.match(dock, /item\.active \? "glass-active-nav"/);
  assert.match(
    dock,
    /"flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-primary min-\[360px\]:h-10 min-\[360px\]:w-10"/,
  );
  const layout = readFileSync("src/components/DashboardLayout.tsx", "utf8");
  assert.match(layout, /\$\{active \? "glass-active-nav" :/);
});

test("the pill and the round button have the same height at every width", () => {
  assert.match(
    dock,
    /"glass-pill flex h-12 min-w-0 items-center gap-1 p-1 backdrop-blur-2xl min-\[360px\]:h-14 min-\[360px\]:p-1\.5"/,
  );
  assert.match(
    dock,
    /"glass-pill flex h-12 w-12 shrink-0 items-center justify-center backdrop-blur-2xl transition-colors min-\[360px\]:h-14 min-\[360px\]:w-14"/,
  );
});

test("the panel's tiles fit any width: adaptive columns, scaling squares, wrapping labels", () => {
  assert.match(dock, /grid-cols-\[repeat\(auto-fill,minmax\(3\.5rem,1fr\)\)\]/);
  assert.match(dock, /"flex aspect-square w-full max-w-14 items-center justify-center/);
  assert.match(
    dock,
    /"line-clamp-2 w-full text-\[11px\] leading-tight \[overflow-wrap:anywhere\]"/,
  );
  assert.doesNotMatch(dock, /\btruncate\b/);
  assert.match(dock, /style=\{\{ borderRadius: 28, maxHeight: "calc\(100dvh - 7rem\)" \}\}/);
  assert.match(dock, /style=\{\{ borderRadius: 18 \}\}/);
});

test("the round button opens and closes the panel and says which it will do", () => {
  assert.match(dock, /onClick=\{\(\) => setOpen\(\(value\) => !value\)\}/);
  assert.match(dock, /aria-label=\{open \? "Close menu" : moreLabel\}/);
  assert.match(dock, /aria-expanded=\{open\}/);
  assert.match(dock, /aria-controls=\{open \? panelId : undefined\}/);
  assert.match(dock, /open && "rotate-45"/);
  assert.match(dock, /role="dialog" aria-label=\{panelLabel\}/);
});

test("closing never needs the button: backdrop, Escape, a choice, or a page/section change", () => {
  assert.match(dock, /aria-hidden onClick=\{\(\) => setOpen\(false\)\}/);
  assert.match(dock, /if \(event\.key === "Escape"\) setOpen\(false\);/);
  assert.match(dock, /useEffect\(\(\) => setOpen\(false\), \[resetKey\]\);/);
  assert.match(layout, /resetKey=\{pathname\}/);
  assert.match(admin, /resetKey=\{active\}/);
  // Focus moves into the panel, and back to its button when it closes.
  assert.match(
    dock,
    /panelRef\.current\?\.querySelector<HTMLElement>\("a, button"\)\?\.focus\(\);/,
  );
  assert.match(dock, /buttonRef\.current\?\.focus\(\);/);
});
