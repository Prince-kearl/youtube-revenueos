import { Link } from "@tanstack/react-router";
import { ArrowRight, Lightbulb, ListChecks } from "lucide-react";
import { ErrorState } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import type { GettingStartedRecommendation, Opportunity } from "@/lib/revenue-opportunities";
import type { VideoOpportunitiesResponse } from "@/lib/server/video-opportunities";
import {
  GETTING_STARTED_INTRO,
  OPPORTUNITIES_EMPTY,
  OPPORTUNITIES_INSUFFICIENT,
  OPPORTUNITIES_INTRO,
  OPPORTUNITIES_NOTHING,
  PRIORITY_LABEL,
  uncheckedAreas,
} from "@/lib/video-opportunities-view";
import { splitActionHref } from "@/lib/link-tracking-context";

// The Revenue opportunities section of a video's page, for one state: rendering only, no
// requests (components/VideoRevenueOpportunities.tsx loads it). Each opportunity reads
// Opportunity → why → what to do next, with the evidence it rests on.

export type OpportunitiesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "restricted" }
  | { status: "ready"; response: VideoOpportunitiesResponse; refreshing: boolean };

const PRIORITY_STYLE: Record<Opportunity["priority"], string> = {
  high: "bg-primary/10 text-primary",
  medium: "bg-accent text-foreground",
  low: "bg-accent text-muted-foreground",
};

export function VideoOpportunitiesContent({
  state,
  headingId,
  onRetry,
  className,
}: {
  state: OpportunitiesState;
  headingId: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-xl border border-border bg-card p-5 ${className ?? ""}`}
      data-testid="opportunities"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden="true"
        >
          <Lightbulb className="h-4 w-4" />
        </span>
        <h2 id={headingId} className="text-lg font-semibold">
          Revenue opportunities
        </h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{OPPORTUNITIES_INTRO}</p>

      {state.status === "loading" && (
        <div className="mt-4" role="status" aria-label="Loading opportunities" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="mt-3 h-20 w-full rounded-lg" />
          <span className="sr-only">Loading opportunities</span>
        </div>
      )}

      {state.status === "restricted" && (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="opportunities-restricted">
          Revenue opportunities aren&apos;t available for your account.
        </p>
      )}

      {state.status === "error" && (
        <ErrorState
          className="mt-4"
          title="We couldn't work out this video's opportunities"
          description="The rest of this page is unaffected. Please try again."
          onRetry={onRetry}
        />
      )}

      {state.status === "ready" && (
        <div
          aria-busy={state.refreshing}
          className={state.refreshing ? "opacity-60 transition-opacity" : "transition-opacity"}
        >
          <OpportunityList response={state.response} />
        </div>
      )}
    </section>
  );
}

function OpportunityList({ response }: { response: VideoOpportunitiesResponse }) {
  const { opportunities, checks } = response.data;
  // Older responses (before Phase 2C-1) carry neither field.
  const gettingStarted = response.data.gettingStarted ?? [];
  const performance =
    response.data.performance ??
    (opportunities.length
      ? "found"
      : checks.audience === "insufficient_data"
        ? "insufficient_data"
        : "none");
  const unchecked = uncheckedAreas(checks);

  if (opportunities.length === 0 && gettingStarted.length === 0)
    return (
      <>
        <p className="mt-4 text-sm text-muted-foreground" data-testid="opportunities-nothing">
          {OPPORTUNITIES_NOTHING}{" "}
          {performance === "insufficient_data" ? OPPORTUNITIES_INSUFFICIENT : OPPORTUNITIES_EMPTY}
        </p>
        <Footer unchecked={unchecked} days={response.data.period.days} />
      </>
    );

  return (
    <>
      <h3 className="mt-4 text-sm font-semibold" data-testid="opportunities-performance-heading">
        Performance opportunities
      </h3>
      {opportunities.length === 0 ? (
        <p
          className="mt-1 text-sm text-muted-foreground"
          data-testid={
            performance === "insufficient_data"
              ? "opportunities-insufficient"
              : "opportunities-empty"
          }
        >
          {performance === "insufficient_data" ? OPPORTUNITIES_INSUFFICIENT : OPPORTUNITIES_EMPTY}
        </p>
      ) : (
        <ol className="mt-2 space-y-3">
          {opportunities.map((opportunity) => (
            <li
              key={opportunity.type}
              className="rounded-lg border border-border p-4"
              data-testid="opportunity"
              data-type={opportunity.type}
              data-priority={opportunity.priority}
            >
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{opportunity.title}</h3>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_STYLE[opportunity.priority]}`}
                >
                  {PRIORITY_LABEL[opportunity.priority]}
                </span>
                {opportunity.dataStatus === "provisional" && (
                  <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Recent days may still change
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{opportunity.explanation}</p>
              <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                {opportunity.evidence.map((item) => (
                  <div key={item.label} className="flex justify-between gap-3 sm:block">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className="font-medium">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                <p className="text-sm">
                  <span className="font-medium">Next step: </span>
                  {opportunity.nextStep}
                </p>
                {opportunity.action && <OpportunityAction action={opportunity.action} />}
              </div>
            </li>
          ))}
        </ol>
      )}

      {gettingStarted.length > 0 && <GettingStarted steps={gettingStarted} />}
      <Footer unchecked={unchecked} days={response.data.period.days} />
    </>
  );
}

/** Setup steps: deliberately plainer than the findings above — no priority, no evidence. */
function GettingStarted({ steps }: { steps: GettingStartedRecommendation[] }) {
  return (
    <div className="mt-5" data-testid="getting-started">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        <ListChecks className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Getting started
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{GETTING_STARTED_INTRO}</p>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-dashed border-border">
        {steps.map((step) => (
          <li
            key={step.type}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3"
            data-testid="getting-started-step"
            data-type={step.type}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {step.title}
                <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Setup
                </span>
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{step.explanation}</p>
              <p className="mt-1 text-xs">
                <span className="font-medium">Next step: </span>
                {step.nextStep}
              </p>
            </div>
            <OpportunityAction action={step.action} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Footer({ unchecked, days }: { unchecked: string[]; days: number }) {
  return (
    <>
      {unchecked.length > 0 && (
        <ul
          className="mt-3 space-y-0.5 text-xs text-muted-foreground"
          data-testid="opportunities-unchecked"
        >
          <li className="font-medium">Not checked for this video:</li>
          {unchecked.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Based on the last {days} days. Comparisons use only this workspace's videos (all its
        connected channels) over the same days; they show where to look, not why.
      </p>
    </>
  );
}

const ACTION_CLASS =
  "inline-flex shrink-0 items-center gap-1.5 rounded-[var(--button-radius)] border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

function OpportunityAction({ action }: { action: { label: string; href: string } }) {
  // An in-page target (the Brand deals block) is a plain anchor; an app page is a router link.
  if (action.href.startsWith("#"))
    return (
      <a href={action.href} className={ACTION_CLASS} data-testid="opportunity-action">
        {action.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    );
  // An app page, with its search parameters (e.g. /link-tracking?video=…&create=1).
  const { to, search } = splitActionHref(action.href);
  return (
    <Link
      to={to}
      search={search as never}
      className={ACTION_CLASS}
      data-testid="opportunity-action"
    >
      {action.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
