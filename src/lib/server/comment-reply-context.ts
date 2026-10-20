import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchYoutubeVideoById } from "./google-oauth";
import type { CommentReplyInput } from "./ai-generation";

// What the AI reply writer knows about a video (lib/server/ai-generation.ts, generateCommentReply):
// its title and description, its chapters, the stored content analysis and a transcript excerpt —
// all from this channel's own stored data. A video not synced yet falls back to its title and
// description from YouTube (confirmed to be on the channel). Every read is scoped to the given
// channel; callers authorize first.

export type VideoReplyContext = CommentReplyInput["video"] & { channelName: string | null };

const timestamp = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

export async function loadVideoReplyContext(
  service: SupabaseClient,
  input: {
    channelId: string;
    youtubeChannelId: string;
    youtubeVideoId: string;
    accessToken: string | null;
  },
): Promise<VideoReplyContext | null> {
  const [{ data: channel }, { data: video }, { data: chapters }] = await Promise.all([
    service.from("youtube_channels").select("channel_name").eq("id", input.channelId).maybeSingle(),
    service
      .from("videos")
      .select("id, title, description, content_analysis")
      .eq("channel_id", input.channelId)
      .eq("youtube_video_id", input.youtubeVideoId)
      .maybeSingle(),
    service
      .from("youtube_chapters")
      .select("title, start_seconds, position")
      .eq("channel_id", input.channelId)
      .eq("youtube_video_id", input.youtubeVideoId)
      .order("position")
      .limit(60),
  ]);
  const channelName = (channel?.channel_name as string | null | undefined) ?? null;
  const chapterLines = (chapters ?? []).map(
    (c) => `${timestamp(Number(c.start_seconds ?? 0))} ${String(c.title ?? "")}`,
  );

  if (video) {
    const { data: transcript } = await service
      .from("transcripts")
      .select("transcript")
      .eq("video_id", video.id as string)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const analysis = (video.content_analysis ?? null) as {
      summary?: string;
      mainTopic?: string;
    } | null;
    const analysisSummary = analysis
      ? [analysis.mainTopic, analysis.summary].filter(Boolean).join(" — ") || null
      : null;
    return {
      channelName,
      title: String(video.title ?? ""),
      description: (video.description as string | null) ?? null,
      chapters: chapterLines,
      analysisSummary,
      transcriptExcerpt: (transcript?.transcript as string | undefined)?.slice(0, 4000) ?? null,
    };
  }

  // Not synced yet: YouTube's own title and description, for a video on this channel only.
  if (!input.accessToken) return null;
  try {
    const live = await fetchYoutubeVideoById(
      input.accessToken,
      input.youtubeVideoId,
      input.youtubeChannelId,
    );
    return {
      channelName,
      title: live.title,
      description: live.description,
      chapters: chapterLines,
      analysisSummary: null,
      transcriptExcerpt: null,
    };
  } catch {
    return null;
  }
}
