import { Link } from "@tanstack/react-router";
import { ArrowRight, Handshake, Link2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ErrorState } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import type { CommandCenterResponse } from "@/lib/server/command-center";
import { PRIORITY_LABEL } from "@/lib/video-opportunities-view";
import type { VideoRevenueRange } from "@/lib/video-revenue-overview";
import { actionTarget, rangeForDays } from "@/lib/revenue-actions";
import {
  COMMAND_CENTER_INTRO,
  NOTHING_TO_DO,
  RESTRICTED_NOTE,
  SPONSORSHIP_NOTE,
  UNAVAILABLE_NOTE,
  sponsorshipText,
  type CommandCenterRange,
} from "@/lib/command-center-view";

// "Next steps" on the dashboard, below the KPI cards, for one state: rendering only, no requests
// (components/RevenueCommandCenter.tsx loads it). Deliberately short — it shows only what the rest
// of the dashboard does not: sponsorships and tracked-link clicks, side by side and never added
// together, then the few most useful things to do next. YouTube revenue, trends and top videos are
// the KPI cards and the sections below.

export type CommandCenterState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "restricted" }
  | { status: "ready"; response: CommandCenterResponse; refreshing: boolean };

type Data = CommandCenterResponse["data"];

/** How many next steps are shown before "Show more". */
export const NEXT_STEPS_SHOWN = 3;

const ACTION =
  "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--button-radius)] border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function RevenueCommandCenterContent({
  state,
  onRetry,
}: {
  state: CommandCenterState;
  /** The period asked for. Shown periods come from the answer itself (data.period). */
  range?: CommandCenterRange;
  onRetry?: () => void;
}) {
  return (
    <section
      className="card-gradient-outline relative mt-5 p-5 backdrop-blur-xl"
      aria-labelledby="command-center-heading"
      data-testid="command-center"
    >
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} />
      <h2 id="command-center-heading" className="text-lg font-semibold">
        Next steps
      </h2>
      <p className="text-sm text-muted-foreground">{COMMAND_CENTER_INTRO}</p>

      {state.status === "loading" && (
        <div
          className="mt-4 space-y-3"
          role="status"
          aria-label="Loading the revenue command center"
          aria-busy="true"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
          <Skeleton className="h-32 rounded-xl" />
          <span className="sr-only">Loading the revenue command center</span>
        </div>
      )}
      {state.status === "restricted" && (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="command-center-restricted">
          The revenue command center isn&apos;t available for your account.
        </p>
      )}
      {state.status === "error" && (
        <ErrorState
          className="mt-4"
          title="We couldn't load the revenue command center"
          description="The rest of the dashboard is unaffected. Please try again."
          onRetry={onRetry}
        />
      )}
      {state.status === "ready" && (
        <div
          aria-busy={state.refreshing}
          className={state.refreshing ? "opacity-60 transition-opacity" : "transition-opacity"}
        >
          {state.response.data.status === "not_connected" ? (
            <p
              className="mt-3 text-sm text-muted-foreground"
              data-testid="command-center-not-connected"
            >
              Connect a YouTube channel to see what your videos earn and what to do next.
            </p>
          ) : (
            <Ready data={state.response.data} />
          )}
        </div>
      )}
    </section>
  );
}

function Ready({ data }: { data: Data }) {
  const range = rangeForDays(data.period.days);
  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="command-center-sources">
        <Source
          icon={<Handshake className="h-4 w-4" />}
          label="Sponsorships"
          testId="source-sponsorships"
          link={
            data.sponsorships.status === "checked"
              ? { to: "/brand-deals", label: "Brand Deals" }
              : null
          }
        >
          {data.sponsorships.status !== "checked" ? (
            <p className="text-sm text-muted-foreground">
              {data.sponsorships.status === "restricted" ? RESTRICTED_NOTE : UNAVAILABLE_NOTE}
            </p>
          ) : data.sponsorships.byCurrency.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contracted deals yet.</p>
          ) : (
            <>
              <ul className="space-y-0.5 text-sm">
                {data.sponsorships.byCurrency.map((row) => {
                  const text = sponsorshipText(row);
                  return (
                    <li key={row.currency} data-testid="sponsorship-currency">
                      <span className="font-semibold">{text.attributed}</span>
                      {row.unattributedDeals > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {text.unattributed}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-0.5 text-xs text-muted-foreground">{SPONSORSHIP_NOTE}</p>
            </>
          )}
        </Source>

        <Source
          icon={<Link2 className="h-4 w-4" />}
          label="Tracked-link clicks"
          testId="source-links"
          link={
            data.links.status === "checked"
              ? { to: "/link-tracking", label: "Link Tracking" }
              : null
          }
        >
          {data.links.status !== "checked" ? (
            <p className="text-sm text-muted-foreground">
              {data.links.status === "restricted" ? RESTRICTED_NOTE : UNAVAILABLE_NOTE}
            </p>
          ) : data.links.links === 0 ? (
            <p className="text-sm text-muted-foreground">No tracked links yet.</p>
          ) : (
            <p className="text-sm">
              <span className="font-semibold">{data.links.clicks.toLocaleString("en-US")}</span>{" "}
              <span className="text-muted-foreground">
                in the last {data.period.days} days · interest, not income
              </span>
            </p>
          )}
        </Source>
      </div>

      <NextSteps data={data} range={range} />
    </>
  );
}

function Source({
  icon,
  label,
  testId,
  link,
  children,
}: {
  icon: ReactNode;
  label: string;
  testId: string;
  link: { to: string; label: string } | null;
  children: ReactNode;
}) {
  return (
    <div
      className="card-frost flex items-start justify-between gap-3 px-4 py-3 backdrop-blur-lg"
      data-testid={testId}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span aria-hidden="true">{icon}</span> {label}
        </p>
        <div className="mt-1">{children}</div>
      </div>
      {link && (
        <Link
          to={link.to}
          className="shrink-0 text-sm font-medium text-primary hover:underline"
          aria-label={`Open ${link.label}`}
        >
          Open
        </Link>
      )}
    </div>
  );
}

type Step = {
  key: string;
  title: string;
  tag: string;
  video: { youtubeVideoId: string; title: string | null } | null;
  detail: string;
  action: { href: string; label: string } | null;
  testId: string;
  priority?: string;
};

/** Suggestions from the videos' data first (already in priority order), then setup steps — one
 * list, the first few shown. */
function stepsOf(data: Data): Step[] {
  return [
    ...data.opportunities.map((o) => ({
      key: `${o.type}:${o.video.youtubeVideoId}`,
      title: o.title,
      tag: PRIORITY_LABEL[o.priority],
      video: o.video,
      detail: o.nextStep,
      action: o.action ? { href: o.action.href, label: o.action.label } : null,
      testId: "command-center-opportunity",
      priority: o.priority,
    })),
    ...data.gettingStarted.map((step) => ({
      key: step.type,
      title: step.title,
      tag: "Setup",
      video: step.video ?? null,
      detail: step.nextStep,
      action: { href: step.action.href, label: step.action.label },
      testId: "command-center-step",
    })),
  ];
}

function NextSteps({ data, range }: { data: Data; range: VideoRevenueRange | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const steps = stepsOf(data);
  const shown = expanded ? steps : steps.slice(0, NEXT_STEPS_SHOWN);
  const more = steps.length - shown.length;
  return (
    <div className="mt-4" data-testid="command-center-next">
      {steps.length === 0 ? (
        <p className="text-sm text-muted-foreground">{NOTHING_TO_DO}</p>
      ) : (
        <ul className="card-frost divide-y divide-border/60 overflow-hidden backdrop-blur-lg">
          {shown.map((step) => (
            <li
              key={step.key}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              data-testid={step.testId}
              data-priority={step.priority}
            >
              <div className="min-w-0 flex-[1_1_100%] sm:flex-1">
                <p className="text-sm font-medium">
                  {step.title}
                  <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {step.tag}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {step.video && (
                    <>
                      <VideoLink video={step.video} range={range} /> ·{" "}
                    </>
                  )}
                  {step.detail}
                </p>
              </div>
              {step.action ? (
                <ActionLink
                  href={step.action.href}
                  label={step.action.label}
                  youtubeVideoId={step.video?.youtubeVideoId ?? null}
                  range={range}
                />
              ) : step.video ? (
                <Link
                  to="/videos/$videoId"
                  params={{ videoId: step.video.youtubeVideoId }}
                  search={range ? { range } : {}}
                  className={ACTION}
                >
                  Open video <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {steps.length > NEXT_STEPS_SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-2 text-sm font-medium text-primary hover:underline"
          data-testid="command-center-more"
        >
          {expanded ? "Show fewer" : `Show ${more} more`}
        </button>
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
      className={ACTION}
      data-testid="command-center-action"
    >
      {content}
    </Link>
  ) : (
    <Link
      to={target.to}
      search={target.search as never}
      className={ACTION}
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
      className="font-medium text-foreground hover:underline"
    >
      {video.title ?? "Untitled video"}
    </Link>
  );
}
