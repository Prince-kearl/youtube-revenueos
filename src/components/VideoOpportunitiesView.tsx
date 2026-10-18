import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  Handshake,
  Link2,
  Megaphone,
  MousePointerClick,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { ErrorState } from "@/components/ui-bits";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useLocalStore } from "@/lib/local-store";
import type { Opportunity } from "@/lib/revenue-opportunities";
import type { VideoOpportunitiesResponse } from "@/lib/server/video-opportunities";
import { PRIORITY_LABEL } from "@/lib/video-opportunities-view";
import { actionTarget, rangeForDays } from "@/lib/revenue-actions";
import { insightKey, insightLabel, visibleInsights } from "@/lib/command-center-view";
import type { VideoRevenueRange } from "@/lib/video-revenue-overview";

// "For this video" on a video's page, for one state: rendering only, no requests
// (components/VideoRevenueOpportunities.tsx loads it). The same feed as the dashboard's "For you":
// one card per finding from this video's data, with the facts it rests on and one clear action.
// It appears only when there is something real to say — no setup prompts (the onboarding guide
// does that), no "nothing to suggest" filler, and nothing while loading. Dismissing a card here
// also dismisses it on the dashboard, and the other way round (same key, same device).

export type OpportunitiesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "restricted" }
  | { status: "ready"; response: VideoOpportunitiesResponse; refreshing: boolean };

/** Shared with the dashboard's feed (components/RevenueCommandCenterView.tsx). */
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
  "inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--button-radius)] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

export function VideoOpportunitiesContent({
  state,
  headingId,
  onRetry,
  className,
  youtubeVideoId = "",
}: {
  state: OpportunitiesState;
  headingId: string;
  onRetry?: () => void;
  className?: string;
  /** The video the suggestions are about — the key a dismissed card is remembered by. */
  youtubeVideoId?: string;
}) {
  const [dismissed, setDismissed] = useLocalStore(DISMISSED_KEY, NONE_DISMISSED);
  const [now] = useState(() => Date.now());

  if (state.status === "loading" || state.status === "restricted") return null;
  if (state.status === "error")
    return (
      <ErrorState
        className={className}
        title="We couldn't work out this video's opportunities"
        description="The rest of this page is unaffected. Please try again."
        onRetry={onRetry}
      />
    );
  const { opportunities, period } = state.response.data;
  if (opportunities.length === 0) return null;

  const withVideo = opportunities.map((opportunity) => ({
    ...opportunity,
    video: { youtubeVideoId },
  }));
  const visible = visibleInsights(withVideo, dismissed, now);
  const range = rangeForDays(period.days);

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={state.refreshing}
      className={`card-gradient-outline relative p-5 backdrop-blur-xl ${className ?? ""}`}
      data-testid="opportunities"
    >
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h2 id={headingId} className="flex items-center gap-2 text-lg font-semibold">
        <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" /> For this video
      </h2>
      <p className="text-sm text-muted-foreground">
        Opportunities spotted in this video&apos;s data — one step each.
      </p>
      {visible.length === 0 ? (
        <p
          className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="opportunities-caught-up"
        >
          <CheckCircle2 className="h-4 w-4 text-brand-green" aria-hidden="true" /> You&apos;re all
          caught up.
        </p>
      ) : (
        <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((opportunity) => (
            <OpportunityCard
              key={opportunity.type}
              opportunity={opportunity}
              range={range}
              onDismiss={() =>
                setDismissed((previous) => ({
                  ...previous,
                  [insightKey(opportunity)]: Date.now(),
                }))
              }
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function OpportunityCard({
  opportunity,
  range,
  onDismiss,
}: {
  opportunity: Opportunity;
  range: VideoRevenueRange | undefined;
  onDismiss: () => void;
}) {
  const Icon = ICONS[opportunity.type] ?? Sparkles;
  return (
    <li
      className="card-frost flex flex-col p-4 backdrop-blur-lg"
      data-testid="opportunity"
      data-type={opportunity.type}
      data-priority={opportunity.priority}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{" "}
          {insightLabel(opportunity.type)}
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium">
            {PRIORITY_LABEL[opportunity.priority]}
          </span>
          {opportunity.dataStatus === "provisional" && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium">
              Recent days may still change
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Dismiss: ${opportunity.title}`}
          data-testid="opportunity-dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <h3 className="mt-3 text-sm font-semibold leading-snug">{opportunity.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{opportunity.explanation}</p>
      {opportunity.evidence.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {opportunity.evidence.slice(0, 2).map((fact) => (
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
        {opportunity.action ? (
          <OpportunityAction action={opportunity.action} range={range} />
        ) : (
          <p className="text-xs">
            <span className="font-medium">Next step: </span>
            {opportunity.nextStep}
          </p>
        )}
      </div>
    </li>
  );
}

function OpportunityAction({
  action,
  range,
}: {
  action: { label: string; href: string };
  range: VideoRevenueRange | undefined;
}) {
  // An in-page target (the Brand deals block) is a plain anchor; an app page is a router link.
  if (action.href.startsWith("#"))
    return (
      <a href={action.href} className={CTA} data-testid="opportunity-action">
        {action.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    );
  // An app page, with its search parameters (e.g. /link-tracking?video=…&create=1) — and, for
  // the video's links, the period it is looked at over, so "Back to video" returns to it.
  const target = actionTarget(action.href, "", range);
  if (target.kind !== "page") return null;
  const { to, search } = target;
  return (
    <Link to={to} search={search as never} className={CTA} data-testid="opportunity-action">
      {action.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
