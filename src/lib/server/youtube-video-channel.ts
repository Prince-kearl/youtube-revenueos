// Which of the caller's connected channels a YouTube video belongs to — for the live video detail
// request (routes/api.youtube.video.ts).
//
// A video's channel is a fact about the VIDEO, not about which channel the user happens to have
// selected elsewhere in the app. The page used to send its "active channel" (and the API, without
// one, picked the most recently connected channel the user could see in any workspace); YouTube's
// ownership check then refused every video of the workspace's other channels with
// YOUTUBE_VIDEO_CHANNEL_MISMATCH. Now the channel is worked out from the video:
//
//   1. only the caller's own workspace's CONNECTED channels are ever considered;
//   2. the channel the sync stored the video under (videos.channel_id) is tried first;
//   3. then a channel the request suggested — only if it is one of those channels;
//   4. then the workspace's other connected channels, newest connection first.
//
// Each candidate is still verified with YouTube itself (the video must be on that channel), so a
// stored relationship that is out of date, or a suggestion that is wrong, can never make the page
// show another channel's video: the first candidate YouTube confirms is used, and if none is
// confirmed the request fails exactly as before.

export interface VideoChannelCandidate {
  id: string;
  youtube_channel_id: string;
  channel_name: string | null;
  channel_handle: string | null;
}

/** The order in which a video's possible channels are tried (see above). Pure. */
export function orderVideoChannelCandidates<T extends { id: string }>(
  connectedChannels: readonly T[],
  storedOwnerIds: readonly string[],
  hintChannelId: string | null,
): T[] {
  const byId = new Map(connectedChannels.map((channel) => [channel.id, channel]));
  const ordered: T[] = [];
  const add = (id: string | null) => {
    const channel = id ? byId.get(id) : undefined;
    if (channel && !ordered.includes(channel)) ordered.push(channel);
  };
  for (const id of storedOwnerIds) add(id);
  add(hintChannelId);
  for (const channel of connectedChannels) add(channel.id);
  return ordered;
}

const NOT_FOUND = "YOUTUBE_VIDEO_NOT_FOUND";
const MISMATCH = "YOUTUBE_VIDEO_CHANNEL_MISMATCH";

/**
 * Tries `verify` on each candidate in order and returns the first one YouTube confirms.
 *
 * A candidate that is not the video's channel (MISMATCH), or cannot see the video (NOT_FOUND),
 * is skipped; so is one whose YouTube connection needs re-authorising, which must not hide the
 * video from a channel that works. Any other error stops at once. When nothing is confirmed:
 * a channel that needs re-authorising is reported first (reconnecting it may be the answer),
 * then a mismatch (the video is on a channel not connected here), then not-found.
 */
export async function firstVerifiedChannel<C, R>(
  candidates: readonly C[],
  verify: (candidate: C) => Promise<R>,
  isReauthError: (error: unknown) => boolean,
): Promise<{ channel: C; result: R }> {
  let reauth: unknown = null;
  let mismatch: unknown = null;
  let notFound: unknown = null;
  for (const candidate of candidates) {
    try {
      return { channel: candidate, result: await verify(candidate) };
    } catch (error) {
      if (isReauthError(error)) reauth ??= error;
      else if (error instanceof Error && error.message === MISMATCH) mismatch ??= error;
      else if (error instanceof Error && error.message === NOT_FOUND) notFound ??= error;
      else throw error;
    }
  }
  throw reauth ?? mismatch ?? notFound ?? new Error(NOT_FOUND);
}
