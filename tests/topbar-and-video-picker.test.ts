import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const flat = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");
const layout = flat("src/components/DashboardLayout.tsx");
const aiLab = flat("src/routes/ai-lab.tsx");
const leads = flat("src/routes/leads.tsx");

test("the top bar shows no page title, on phones or wider screens", () => {
  assert.doesNotMatch(layout, /\{title\}/);
  assert.doesNotMatch(layout, /export function DashboardLayout\(\{ title,/);
});

test("AI Description Lab: on touch screens the video list opens below without popping up the keyboard", () => {
  assert.match(
    aiLab,
    /onOpenAutoFocus=\{\(event\) => \{ if \(!window\.matchMedia\("\(pointer: fine\)"\)\.matches\) event\.preventDefault\(\); \}\}/,
  );
  assert.match(aiLab, /avoidCollisions=\{window\.matchMedia\("\(pointer: fine\)"\)\.matches\}/);
  assert.match(aiLab, /max-h-\[var\(--radix-popover-content-available-height\)\]/);
  assert.doesNotMatch(aiLab, /autoFocus value=\{videoSearch\}/);
});

test("Lead Inbox: YouTube leads can be replied to on YouTube, and their replies are received", () => {
  assert.match(leads, /fetch\(`\/api\/leads\/youtube\?leadId=\$\{id\}\$\{channelQuery\}`/);
  assert.match(leads, /void \(replyingOnYoutube \? replyOnYoutube\(\) : addNote\(\)\);/);
  assert.match(leads, /\["youtube", "Reply on YouTube"\], \["note", "Private note"\],/);
  assert.match(leads, /setInterval\(\(\) => setSyncTick\(\(n\) => n \+ 1\), YOUTUBE_SYNC_MS\)/);
});
