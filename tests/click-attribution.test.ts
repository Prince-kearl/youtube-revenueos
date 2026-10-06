import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backfillClickAttribution,
  clickAttributionFromLink,
  topVideosByClicks,
} from "../src/lib/server/click-attribution";

const LINK = "11111111-1111-4111-8111-111111111111";
const DESTINATION = "22222222-2222-4222-8222-222222222222";
const VIDEO = "33333333-3333-4333-8333-333333333333";
const CHANNEL = "44444444-4444-4444-8444-444444444444";
const CAMPAIGN = "55555555-5555-4555-8555-555555555555";

test("a new click receives the link's video and that video's channel", () => {
  const click = clickAttributionFromLink({
    id: LINK,
    destination_id: DESTINATION,
    video_id: VIDEO,
    campaign_id: null,
    video: { channel_id: CHANNEL },
  });
  assert.deepEqual(click, {
    link_id: LINK,
    destination_id: DESTINATION,
    video_id: VIDEO,
    channel_id: CHANNEL,
    campaign_id: null,
  });
});

test("the campaign is preserved when the link has one", () => {
  const click = clickAttributionFromLink({
    id: LINK,
    destination_id: DESTINATION,
    video_id: VIDEO,
    campaign_id: CAMPAIGN,
    video: [{ channel_id: CHANNEL }],
  });
  assert.equal(click.campaign_id, CAMPAIGN);
  assert.equal(click.channel_id, CHANNEL, "an embedded row delivered as an array is handled");
});

test("a link with no video produces a click with no video and no channel", () => {
  const click = clickAttributionFromLink({
    id: LINK,
    destination_id: DESTINATION,
    video_id: null,
    campaign_id: CAMPAIGN,
    // Even if a stray embedded row were present, no video means no channel.
    video: { channel_id: CHANNEL },
  });
  assert.equal(click.video_id, null);
  assert.equal(click.channel_id, null);
  assert.equal(click.campaign_id, CAMPAIGN);
});

test("a video whose row could not be loaded yields the video but no invented channel", () => {
  const click = clickAttributionFromLink({
    id: LINK,
    destination_id: DESTINATION,
    video_id: VIDEO,
    campaign_id: null,
    video: null,
  });
  assert.equal(click.video_id, VIDEO);
  assert.equal(click.channel_id, null);
});

const link = {
  id: LINK,
  destination_id: DESTINATION,
  video_id: VIDEO,
  campaign_id: CAMPAIGN,
  video: { channel_id: CHANNEL },
};
const emptyClick = { link_id: LINK, video_id: null, channel_id: null, campaign_id: null };

test("backfill fills an unattributed click from its own link", () => {
  assert.deepEqual(backfillClickAttribution(emptyClick, link), {
    video_id: VIDEO,
    channel_id: CHANNEL,
    campaign_id: CAMPAIGN,
  });
});

test("backfill never overwrites attribution that is already recorded", () => {
  const otherVideo = "66666666-6666-4666-8666-666666666666";
  const patch = backfillClickAttribution({ ...emptyClick, video_id: otherVideo }, link);
  assert.equal(patch?.video_id, undefined, "the recorded video is left alone");
  assert.equal(patch?.campaign_id, CAMPAIGN, "only the still-empty columns are filled");
});

test("backfill leaves a click alone when its link has no video", () => {
  assert.equal(
    backfillClickAttribution(emptyClick, { ...link, video_id: null, campaign_id: null }),
    null,
  );
});

test("backfill refuses to use a link the click did not come through", () => {
  const otherLink = { ...link, id: "77777777-7777-4777-8777-777777777777" };
  assert.equal(backfillClickAttribution(emptyClick, otherLink), null);
  assert.equal(backfillClickAttribution(emptyClick, null), null);
});

test("backfill is a no-op for a click that is already fully attributed", () => {
  const full = { link_id: LINK, video_id: VIDEO, channel_id: CHANNEL, campaign_id: CAMPAIGN };
  assert.equal(backfillClickAttribution(full, link), null);
});

test("top videos are ranked by clicks and unattributed clicks count towards none", () => {
  const top = topVideosByClicks(
    [
      { video_id: "a" },
      { video_id: "b" },
      { video_id: "b" },
      { video_id: null },
      { video_id: null },
      { video_id: null },
      { video_id: "c" },
      { video_id: "c" },
      { video_id: "c" },
      { video_id: "d" },
    ],
    3,
  );
  assert.deepEqual(top, [
    { videoId: "c", clicks: 3 },
    { videoId: "b", clicks: 2 },
    { videoId: "a", clicks: 1 },
  ]);
  assert.deepEqual(topVideosByClicks([{ video_id: null }], 3), []);
});
