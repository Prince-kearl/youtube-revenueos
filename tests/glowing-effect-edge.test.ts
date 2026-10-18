import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The hover glow traces the card's own edge. Inside a card that spaces its children (space-y-*,
// which in Tailwind v4 gives every child but the last a bottom margin) the glow's layers picked up
// that margin, so the glow's bottom edge sat inside the card, above its real border. Both layers
// are pinned with !m-0.

test("both glow layers ignore spacing margins and sit exactly on the card's edge", () => {
  const source = readFileSync("src/components/ui/glowing-effect.tsx", "utf8");
  assert.match(source, /"pointer-events-none absolute -inset-px !m-0 hidden rounded-\[inherit\]/);
  assert.match(source, /"pointer-events-none absolute inset-0 !m-0 rounded-\[inherit\]/);
});
