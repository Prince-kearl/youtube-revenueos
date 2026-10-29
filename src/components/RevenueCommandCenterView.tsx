import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Handshake,
  Link2,
  Megaphone,
  MousePointerClick,
  Play,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { ErrorState } from "@/components/ui-bits";
import { useLocalStore } from "@/lib/local-store";
import type { CommandCenterResponse } from "@/lib/server/command-center";
import { PRIORITY_LABEL } from "@/lib/video-opportunities-view";
import type { VideoRevenueRange } from "@/lib/video-revenue-overview";
import { actionTarget, rangeForDays } from "@/lib/revenue-actions";
import {
  insightKey,
  insightLabel,
  sponsorshipText,
  videoThumbnailUrl,
  visibleInsights,
  type CommandCenterRange,
} from "@/lib/command-center-view";

// "For you" on the dashboard, below the KPI cards, for one state: rendering only, no requests
// (components/RevenueCommandCenter.tsx loads it). A feed of findings from the creator's own data —
// one card per suggestion, each with the video it is about, the facts it rests on and one clear
// action. It appears only when there is something real to say: no setup prompts (the onboarding
// guide does that), no empty "nothing yet" tiles, and nothing while loading.

export type CommandCenterState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "restricted" }
  | { status: "ready"; response: CommandCenterResponse; refreshing: boolean };

type Data = CommandCenterResponse["data"];
type Insight = Data["opportunities"][number];

/** Where this device remembers dismissed cards. The "yroos." prefix is cleared at sign-out. */
const DISMISSED_KEY = "yroos.insights.dismissed";
const NONE_DISMISSED: Record<string, number> = {};

const ICONS: Record<string, LucideIcon> = {
  investigate_low_rpm: TrendingDown,
  add_tracked_link: Link2,
  links_without_clicks: MousePointerClick,
  review_link_offer: MousePointerClick,
  repeat_high_rpm: TrendingUp,
  link_sponsorship: Handshake,
  sponsored_video_for_pitch: Megaphone,
};

const CTA =
  "mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--button-radius)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

export function RevenueCommandCenterContent({
  state,
  onRetry,
}: {
  state: CommandCenterState;
  /** The period asked for. Shown periods come from the answer itself (data.period). */
  range?: CommandCenterRange;
  onRetry?: () => void;
}) {
  const [dismissed, setDismissed] = useLocalStore(DISMISSED_KEY, NONE_DISMISSED);
  const [now] = useState(() => Date.now());

  // Nothing to say yet (or not for this account): the dashboard goes straight on.
  if (state.status === "loading" || state.status === "restricted") return null;
  if (state.status === "error")
    return (
      <ErrorState
        className="mt-5"
        title="We couldn't load your suggestions"
        description="The rest of the dashboard is unaffected. Please try again."
        onRetry={onRetry}
      />
    );
  const data = state.response.data;
  if (data.status === "not_connected" || data.opportunities.length === 0) return null;

  const insights = visibleInsights(data.opportunities, dismissed, now);
  const range = rangeForDays(data.period.days);
  const dismiss = (insight: Insight) =>
    setDismissed((previous) => ({ ...previous, [insightKey(insight)]: Date.now() }));

  return (
    <section
      className="card-gradient-outline dashboard-card relative mt-5 p-5 backdrop-blur-xl"
      aria-labelledby="command-center-heading"
      aria-busy={state.refreshing}
      data-testid="command-center"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="command-center-heading"
            className="flex items-center gap-2 text-lg font-semibold text-primary"
          >
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> For you
          </h2>
          <p className="text-sm text-muted-foreground">
            Opportunities spotted in your videos&apos; data — one step each.
          </p>
        </div>
        <Highlights data={data} />
      </div>

      {insights.length === 0 ? (
        <p
          className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="command-center-caught-up"
        >
          <CheckCircle2 className="h-4 w-4 text-brand-green" aria-hidden="true" /> You&apos;re all
          caught up.
        </p>
      ) : (
        <ul
          className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="command-center-next"
        >
          {insights.map((insight) => (
            <InsightCard
              key={insightKey(insight)}
              insight={insight}
              range={range}
              onDismiss={() => dismiss(insight)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Sponsorships and tracked-link clicks, only where there is a figure to show — never "none yet".
 * Each source stays on its own: they are different things and are never added together. */
function Highlights({ data }: { data: Data }) {
  const sponsorships = data.sponsorships.status === "checked" ? data.sponsorships.byCurrency : [];
  const clicks = data.links.status === "checked" && data.links.links > 0 ? data.links.clicks : null;
  if (sponsorships.length === 0 && clicks === null) return null;
  return (
    <div className="flex flex-wrap gap-2 text-xs" data-testid="command-center-sources">
      {sponsorships.map((row) => (
        <Link
          key={row.currency}
          to="/brand-deals"
          className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 font-medium backdrop-blur-lg hover:text-foreground"
          title="Agreed deal values — not payments received."
          data-testid="sponsorship-currency"
        >
          <Handshake className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {sponsorshipText(row).attributed}
        </Link>
      ))}
      {clicks !== null && (
        <Link
          to="/link-tracking"
          className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 font-medium backdrop-blur-lg hover:text-foreground"
          title="Clicks show interest, not income."
          data-testid="source-links"
        >
          <Link2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {clicks.toLocaleString("en-US")} link clicks · {data.period.days} days
        </Link>
      )}
    </div>
  );
}

function InsightCard({
  insight,
  range,
  onDismiss,
}: {
  insight: Insight;
  range: VideoRevenueRange | undefined;
  onDismiss: () => void;
}) {
  const Icon = ICONS[insight.type] ?? Sparkles;
  const label = insightLabel(insight.type);
  return (
    <li
      className="card-frost dashboard-card relative flex flex-col p-4 backdrop-blur-lg"
      data-testid="command-center-opportunity"
      data-priority={insight.priority}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> {label}
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium">
            {PRIORITY_LABEL[insight.priority]}
          </span>
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Dismiss: ${insight.title}`}
          data-testid="command-center-dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Thumbnail youtubeVideoId={insight.video.youtubeVideoId} />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug">{insight.title}</p>
          <VideoLink video={insight.video} range={range} />
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">{insight.explanation}</p>
      {insight.evidence.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {insight.evidence.slice(0, 2).map((fact) => (
            <div key={fact.label} className="rounded-lg bg-accent/60 px-2.5 py-1.5">
              <dt className="truncate text-[10px] text-muted-foreground" title={fact.label}>
                {fact.label}
              </dt>
              <dd className="truncate text-sm font-semibold" title={fact.value}>
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 flex flex-1 flex-col justify-end">
        {insight.action ? (
          <ActionLink
            href={insight.action.href}
            label={insight.action.label}
            youtubeVideoId={insight.video.youtubeVideoId}
            range={range}
          />
        ) : (
          <Link
            to="/videos/$videoId"
            params={{ videoId: insight.video.youtubeVideoId }}
            search={range ? { range } : {}}
            className={CTA}
          >
            Open video <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
    </li>
  );
}

/** The video's thumbnail, over a plain placeholder that stays if the image cannot load. */
function Thumbnail({ youtubeVideoId }: { youtubeVideoId: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-accent">
      <Play className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      {!failed && (
        <img
          src={videoThumbnailUrl(youtubeVideoId)}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

/** An action as a link: a page of its own, or — for an action the rules place on the video's
 * page ("#brand-deals") — that video's page, at that block, over the same period. */
function ActionLink({
  href,
  label,
  youtubeVideoId,
  range,
}: {
  href: string;
  label: string;
  youtubeVideoId: string | null;
  range: VideoRevenueRange | undefined;
}) {
  if (href.startsWith("#") && !youtubeVideoId) return null;
  const target = actionTarget(href, youtubeVideoId ?? "", range);
  const content = (
    <>
      {label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </>
  );
  return target.kind === "video" ? (
    <Link
      to="/videos/$videoId"
      params={{ videoId: target.videoId }}
      search={target.search}
      hash={target.hash}
      className={CTA}
      data-testid="command-center-action"
    >
      {content}
    </Link>
  ) : (
    <Link
      to={target.to}
      search={target.search as never}
      className={CTA}
      data-testid="command-center-action"
    >
      {content}
    </Link>
  );
}

function VideoLink({
  video,
  range,
}: {
  video: { youtubeVideoId: string; title: string | null };
  range: VideoRevenueRange | undefined;
}) {
  return (
    <Link
      to="/videos/$videoId"
      params={{ videoId: video.youtubeVideoId }}
      search={range ? { range } : {}}
      className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      {video.title ?? "Untitled video"}
    </Link>
  );
}
