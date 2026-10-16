import { Link } from "@tanstack/react-router";
import { ArrowRight, Gauge, Handshake, Link2, ListChecks, Youtube } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorState } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import type { CommandCenterResponse } from "@/lib/server/command-center";
import { PRIORITY_LABEL } from "@/lib/video-opportunities-view";
import { splitActionHref } from "@/lib/link-tracking-context";
import { formatVideoRevenue } from "@/lib/video-revenue-overview";
import {
  CLICKS_NOTE,
  COMMAND_CENTER_INTRO,
  COMMAND_CENTER_RANGES,
  HIDDEN,
  NOTHING_TO_DO,
  NO_FIGURE,
  RESTRICTED_NOTE,
  SPONSORSHIP_NOTE,
  UNAVAILABLE_NOTE,
  sponsorshipText,
  youtubeRevenueNote,
  youtubeRevenueText,
  type CommandCenterRange,
} from "@/lib/command-center-view";

// The Revenue command center at the top of the dashboard, for one state: rendering only, no
// requests (components/RevenueCommandCenter.tsx loads it). Three sources side by side, each with
// its own unit and its own caveat; then what to do next; then the videos to look at.

export type CommandCenterState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "restricted" }
  | { status: "ready"; response: CommandCenterResponse; refreshing: boolean };

type Data = CommandCenterResponse["data"];

const ACTION =
  "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--button-radius)] border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function RevenueCommandCenterContent({
  state,
  range,
  onRangeChange,
  onRetry,
}: {
  state: CommandCenterState;
  range: CommandCenterRange;
  onRangeChange?: (range: CommandCenterRange) => void;
  onRetry?: () => void;
}) {
  return (
    <section
      className="mb-5 rounded-xl border border-border bg-card p-5"
      aria-labelledby="command-center-heading"
      data-testid="command-center"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <Gauge className="h-4 w-4" />
          </span>
          <h2 id="command-center-heading" className="text-lg font-semibold">
            Revenue command center
          </h2>
        </div>
        <div
          className="flex rounded-full border border-border p-0.5"
          role="group"
          aria-label="Period"
        >
          {(Object.keys(COMMAND_CENTER_RANGES) as CommandCenterRange[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onRangeChange?.(key)}
              aria-pressed={range === key}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                range === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{COMMAND_CENTER_INTRO}</p>

      {state.status === "loading" && (
        <div
          className="mt-4 grid gap-3 sm:grid-cols-3"
          role="status"
          aria-label="Loading the revenue command center"
          aria-busy="true"
        >
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
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
  return (
    <>
      <div className="mt-4 grid gap-3 md:grid-cols-3" data-testid="command-center-sources">
        <Source
          icon={<Youtube className="h-4 w-4" />}
          label="YouTube estimated revenue"
          testId="source-youtube"
          link={{ to: "/analytics", label: "Open Analytics" }}
        >
          <p className="text-2xl font-bold tracking-tight">
            {youtubeRevenueText(data.youtube.revenue, data.youtube.availability)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {youtubeRevenueNote(data.youtube.availability, data.period.days)}
          </p>
        </Source>

        <Source
          icon={<Handshake className="h-4 w-4" />}
          label="Contracted sponsorships"
          testId="source-sponsorships"
          link={
            data.sponsorships.status === "checked"
              ? { to: "/brand-deals", label: "Open Brand Deals" }
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
            <ul className="space-y-1.5 text-sm">
              {data.sponsorships.byCurrency.map((row) => {
                const text = sponsorshipText(row);
                return (
                  <li key={row.currency} data-testid="sponsorship-currency">
                    <span className="font-semibold">{text.attributed}</span>
                    <span className="block text-xs text-muted-foreground">{text.unattributed}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {data.sponsorships.status === "checked" && (
            <p className="mt-1.5 text-xs text-muted-foreground">{SPONSORSHIP_NOTE}</p>
          )}
        </Source>

        <Source
          icon={<Link2 className="h-4 w-4" />}
          label="Tracked-link clicks"
          testId="source-links"
          link={
            data.links.status === "checked"
              ? { to: "/link-tracking", label: "Open Link Tracking" }
              : null
          }
        >
          {data.links.status !== "checked" ? (
            <p className="text-sm text-muted-foreground">
              {data.links.status === "restricted" ? RESTRICTED_NOTE : UNAVAILABLE_NOTE}
            </p>
          ) : (
            <>
              <p className="text-2xl font-bold tracking-tight">
                {data.links.clicks.toLocaleString("en-US")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.links.links === 0
                  ? "No tracked links yet."
                  : `${data.links.links.toLocaleString("en-US")} tracked ${data.links.links === 1 ? "link" : "links"} on ${data.links.videosWithLinks.toLocaleString("en-US")} ${data.links.videosWithLinks === 1 ? "video" : "videos"}.`}{" "}
                {CLICKS_NOTE} Last {data.period.days} days (UTC).
              </p>
            </>
          )}
        </Source>
      </div>

      <NextActions data={data} />
      <Videos data={data} />
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
    <div className="flex flex-col rounded-lg border border-border p-4" data-testid={testId}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span aria-hidden="true">{icon}</span> {label}
      </p>
      <div className="mt-2 flex-1">{children}</div>
      {link && (
        <Link to={link.to} className="mt-3 text-xs font-medium text-primary hover:underline">
          {link.label}
        </Link>
      )}
    </div>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  if (href.startsWith("#")) return null;
  const { to, search } = splitActionHref(href);
  return (
    <Link to={to} search={search as never} className={ACTION} data-testid="command-center-action">
      {label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

function VideoLink({ video }: { video: { youtubeVideoId: string; title: string | null } }) {
  return (
    <Link
      to="/videos/$videoId"
      params={{ videoId: video.youtubeVideoId }}
      className="font-medium text-foreground hover:underline"
    >
      {video.title ?? "Untitled video"}
    </Link>
  );
}

function NextActions({ data }: { data: Data }) {
  const nothing = data.opportunities.length === 0 && data.gettingStarted.length === 0;
  return (
    <div className="mt-5" data-testid="command-center-next">
      <h3 className="text-sm font-semibold">What to do next</h3>
      {nothing && <p className="mt-1 text-sm text-muted-foreground">{NOTHING_TO_DO}</p>}
      {data.opportunities.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
          {data.opportunities.map((o) => (
            <li
              key={`${o.type}:${o.video.youtubeVideoId}`}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
              data-testid="command-center-opportunity"
              data-priority={o.priority}
            >
              <div className="min-w-0 flex-[1_1_100%] sm:flex-1">
                <p className="text-sm font-medium">
                  {o.title}
                  <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {PRIORITY_LABEL[o.priority]}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <VideoLink video={o.video} /> · {o.nextStep}
                </p>
              </div>
              {o.action ? (
                <ActionLink href={o.action.href} label={o.action.label} />
              ) : (
                <Link
                  to="/videos/$videoId"
                  params={{ videoId: o.video.youtubeVideoId }}
                  className={ACTION}
                >
                  Open video <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {data.gettingStarted.length > 0 && (
        <div className="mt-3" data-testid="command-center-getting-started">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" /> Getting started — setup steps,
            not findings
          </p>
          <ul className="mt-1.5 divide-y divide-border rounded-lg border border-dashed border-border">
            {data.gettingStarted.map((step) => (
              <li
                key={step.type}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
                data-testid="command-center-step"
              >
                <div className="min-w-0 flex-[1_1_100%] sm:flex-1">
                  <p className="text-sm font-medium">{step.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {step.video && (
                      <>
                        <VideoLink video={step.video} /> ·{" "}
                      </>
                    )}
                    {step.nextStep}
                  </p>
                </div>
                <ActionLink href={step.action.href} label={step.action.label} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Videos({ data }: { data: Data }) {
  if (data.videos.length === 0) return null;
  const hidden = data.youtube.availability === "hidden";
  return (
    <div className="mt-5" data-testid="command-center-videos">
      <h3 className="text-sm font-semibold">
        Your videos{" "}
        <span className="font-normal text-muted-foreground">
          · most viewed in the last {data.period.days} days
          {data.videoCount > data.videos.length
            ? ` (${data.videos.length} of ${data.videoCount})`
            : ""}
        </span>
      </h3>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
        {data.videos.map((video) => (
          <li
            key={video.youtubeVideoId}
            className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_repeat(4,auto)] sm:items-center"
            data-testid="command-center-video"
          >
            <span className="col-span-2 truncate sm:col-span-1">
              <VideoLink video={video} />
            </span>
            <Figure label="Views" value={video.views.toLocaleString("en-US")} />
            <Figure
              label="YouTube revenue"
              value={
                hidden
                  ? HIDDEN
                  : video.revenue === null || video.revenueAvailability === "unavailable"
                    ? NO_FIGURE
                    : formatVideoRevenue(video.revenue)
              }
            />
            <Figure
              label="Link clicks"
              value={video.clicks === null ? NO_FIGURE : video.clicks.toLocaleString("en-US")}
            />
            <Figure
              label="Suggestions"
              value={video.opportunities === 0 ? "None" : String(video.opportunities)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-xs sm:text-right">
      <span className="block text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </span>
  );
}
