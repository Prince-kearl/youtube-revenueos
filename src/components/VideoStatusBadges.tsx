import { hasNoDescription, VISIBILITY_LABEL, videoVisibility } from "@/lib/youtube-description";

// In a video picker: a badge for an upload that is not public yet (Unlisted, Private, Scheduled,
// Processing), and one for a video with no description. A public, described video shows nothing.
export function VideoStatusBadges({
  video,
}: {
  video: {
    privacyStatus: string | null;
    uploadStatus?: string | null;
    publishAt?: string | null;
    description?: string | null;
  };
}) {
  const visibility = videoVisibility(video);
  return (
    <>
      {visibility !== "public" && (
        <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {VISIBILITY_LABEL[visibility]}
        </span>
      )}
      {hasNoDescription(video) && (
        <span className="shrink-0 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
          No description
        </span>
      )}
    </>
  );
}
