import test from "node:test";
import assert from "node:assert/strict";
import {
  checklistComplete,
  checklistForPrompt,
  CHECKLIST_WRITING_RULES,
  topicWords,
  videoChecklist,
} from "../src/lib/video-checklist";

// The optimization checklist is computed by code, not the AI, so a fixed item stays fixed: the
// same video always gets the same answer. These are its rules.

const good = {
  title: "What a DNA Barcode Can and Cannot Tell Us",
  description:
    "DNA barcoding identifies species from a short stretch of genetic code. In this video we look at what a barcode can reveal about species, genetic diversity and conservation, and where the method falls short.\n\nSubscribe for more science explained simply.\n\n#science #dna",
  tags: ["dna barcoding", "species identification", "genetics", "biology", "conservation"],
  durationSeconds: 80,
};
const status = (input: typeof good, id: string) =>
  videoChecklist(input).find((item) => item.id === id)!.status;

test("a well-prepared short video passes every check, and the answer never changes", () => {
  const items = videoChecklist(good);
  assert.deepEqual(
    items.filter((item) => item.status === "fail").map((item) => item.id),
    [],
  );
  assert.equal(checklistComplete(items), true);
  assert.equal(status(good, "chapters"), "na", "an 80-second video needs no chapters");
  assert.deepEqual(videoChecklist(good), items, "deterministic");
});

test("title length: 20 to 70 characters", () => {
  assert.equal(status({ ...good, title: "DNA" }, "title_length"), "fail");
  assert.equal(status({ ...good, title: "x".repeat(71) }, "title_length"), "fail");
  assert.equal(status({ ...good, title: "x".repeat(70) }, "title_length"), "pass");
});

test("description: long enough, opens with what the video is about, mentions the topic", () => {
  assert.equal(status({ ...good, description: "" }, "description_length"), "fail");
  assert.equal(status({ ...good, description: "" }, "description_opening"), "fail");
  const linkFirst = { ...good, description: `https://example.com\n${good.description}` };
  assert.equal(status(linkFirst, "description_opening"), "fail");
  const hashtagFirst = { ...good, description: `#dna #science\n${good.description}` };
  assert.equal(status(hashtagFirst, "description_opening"), "fail");
  const offTopic = {
    ...good,
    description:
      "Welcome back to the channel, friends! Today is a fun one and I think you will enjoy it a lot. " +
      "x".repeat(200),
  };
  assert.equal(status(offTopic, "description_topic"), "fail");
  assert.equal(status({ ...good, title: "the and for" }, "description_topic"), "na");
});

test("call to action, hashtags and tags", () => {
  assert.equal(
    status(
      { ...good, description: good.description.replace("Subscribe", "Thanks") },
      "call_to_action",
    ),
    "fail",
  );
  const tooMany = `${good.description} ${Array.from({ length: 16 }, (_, i) => `#t${i}`).join(" ")}`;
  assert.equal(status({ ...good, description: tooMany }, "hashtags"), "fail");
  assert.equal(status({ ...good, tags: ["a", "b"] }, "tags"), "fail");
  assert.equal(
    status({ ...good, tags: Array.from({ length: 16 }, (_, i) => `t${i}`) }, "tags"),
    "fail",
  );
});

test("chapters are required from 3 minutes, and must be a list YouTube accepts", () => {
  const long = { ...good, durationSeconds: 600 };
  assert.equal(status(long, "chapters"), "fail");
  const withChapters = {
    ...long,
    description: `${good.description}\n\n0:00 Intro\n1:30 How it works\n5:00 Limits`,
  };
  assert.equal(status(withChapters, "chapters"), "pass");
  const tooFew = { ...long, description: `${good.description}\n\n0:00 Intro\n1:30 Rest` };
  assert.equal(status(tooFew, "chapters"), "fail");
  assert.equal(status({ ...good, durationSeconds: null }, "chapters"), "na");
});

test("each failing check points at the tab that fixes it", () => {
  const fixes = Object.fromEntries(
    videoChecklist({ title: "x", description: "", tags: [], durationSeconds: 600 }).map((item) => [
      item.id,
      item.fix,
    ]),
  );
  assert.deepEqual(fixes, {
    title_length: "titles",
    description_length: "description",
    description_opening: "description",
    description_topic: "description",
    call_to_action: "cta",
    hashtags: "description",
    tags: "tags",
    chapters: "chapters",
  });
});

test("the checklist reaches the AI as settled facts, and the writer is told the same rules", () => {
  const lines = checklistForPrompt(videoChecklist({ ...good, tags: [] }));
  assert.match(lines, /Title is 20–70 characters: PASS/);
  assert.match(lines, /5–15 tags: FAIL/);
  assert.match(lines, /Chapters for a longer video: not applicable/);
  assert.match(CHECKLIST_WRITING_RULES, /between 20 and 70 characters/);
  assert.deepEqual(topicWords("What a DNA Barcode Can and Cannot Tell Us"), ["barcode", "tell"]);
});
