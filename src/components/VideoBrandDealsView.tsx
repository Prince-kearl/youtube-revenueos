import { Link } from "@tanstack/react-router";
import { Handshake, Link2Off, Plus } from "lucide-react";
import { ErrorState } from "@/components/ui-bits";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BRAND_DEALS_AMOUNT_LABEL,
  BRAND_DEALS_EMPTY_NOTE,
  BRAND_DEALS_HIDDEN_NOTE,
  BRAND_DEALS_PAYMENTS_NOTE,
  BRAND_DEALS_PERIOD_NOTE,
  BRAND_DEALS_RESTRICTED_NOTE,
  BRAND_DEALS_SEPARATE_NOTE,
  BRAND_DEALS_SPLIT_NOTE,
  HIDDEN_AMOUNT,
  type BrandDealsView,
} from "@/lib/video-brand-deals";

// The Brand deals block of Revenue sources, for one state: rendering only, no requests. Every
// decision — who sees amounts, who may link, what counts — was made by the API and by
// mapVideoBrandDeals (lib/video-brand-deals.ts); components/VideoBrandDeals.tsx loads the data
// and handles linking and unlinking.

export type BrandDealsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "restricted" }
  // `refreshing`: a newer request is in flight; the figures shown are still the last ones loaded.
  | { status: "ready"; view: BrandDealsView; refreshing: boolean };

export const BUTTON =
  "inline-flex items-center gap-1.5 rounded-[var(--button-radius)] border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

/** The Brand deals block for a given state. Rendering only: every decision was made by the API
 * and by mapVideoBrandDeals. */
export function BrandDealsContent({
  state,
  pendingId = null,
  onRetry,
  onOpenLink,
  onUnlink,
}: {
  state: BrandDealsState;
  pendingId?: string | null;
  onRetry?: () => void;
  onOpenLink?: () => void;
  onUnlink?: (dealId: string) => void;
}) {
  const view = state.status === "ready" ? state.view : null;
  return (
    <div className="flex items-start gap-3" data-testid="sources-deals">
      <Handshake className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Brand deals</h3>
          {view?.canLink && (
            <button
              type="button"
              className={BUTTON}
              onClick={onOpenLink}
              disabled={pendingId !== null}
              data-testid="deals-link-open"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Link a deal
            </button>
          )}
        </div>

        {state.status === "loading" && (
          <div className="mt-3" role="status" aria-label="Loading brand deals" aria-busy="true">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="mt-3 h-14 w-full rounded-lg" />
            <span className="sr-only">Loading brand deals</span>
          </div>
        )}

        {state.status === "restricted" && (
          <p className="mt-0.5 text-sm text-muted-foreground" data-testid="deals-restricted">
            {BRAND_DEALS_RESTRICTED_NOTE}
          </p>
        )}

        {state.status === "error" && (
          <ErrorState
            className="mt-3"
            title="We couldn't load this video's brand deals"
            description="The rest of this page is unaffected. Please try again."
            onRetry={onRetry}
          />
        )}

        {state.status === "ready" && (
          <div
            aria-busy={state.refreshing}
            className={state.refreshing ? "opacity-60 transition-opacity" : "transition-opacity"}
          >
            <BrandDealsBody view={state.view} pendingId={pendingId} onUnlink={onUnlink} />
          </div>
        )}
      </div>
    </div>
  );
}

function BrandDealsBody({
  view,
  pendingId,
  onUnlink,
}: {
  view: BrandDealsView;
  pendingId: string | null;
  onUnlink?: (dealId: string) => void;
}) {
  if (view.state === "empty")
    return (
      <div className="mt-1" data-testid="deals-empty">
        <p className="text-sm text-muted-foreground">{BRAND_DEALS_EMPTY_NOTE}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {view.canLink
            ? "Link one of your workspace's existing deals to see its share here."
            : "Deals are managed on the Brand Deals page."}{" "}
          <Link to="/brand-deals" className="font-medium text-primary hover:underline">
            Open Brand Deals
          </Link>
        </p>
      </div>
    );

  return (
    <>
      {view.hidden && (
        <p className="mt-0.5 text-xs text-muted-foreground" data-testid="deals-hidden-note">
          {BRAND_DEALS_HIDDEN_NOTE}
        </p>
      )}

      <div className="mt-3" data-testid="deals-totals">
        <p className="text-xs font-medium text-muted-foreground">{BRAND_DEALS_AMOUNT_LABEL}</p>
        {view.totals === null ? (
          <p className="mt-1 text-2xl font-bold tracking-tight text-muted-foreground">
            {HIDDEN_AMOUNT}
          </p>
        ) : view.totals.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            No contracted or completed deal is linked to this video yet.
          </p>
        ) : (
          <dl className="mt-1 flex flex-wrap gap-x-8 gap-y-2">
            {view.totals.map((total) => (
              <div key={total.currency} data-testid="deals-total">
                <dt className="sr-only">
                  {BRAND_DEALS_AMOUNT_LABEL} in {total.currency}
                </dt>
                <dd className="text-2xl font-bold tracking-tight">{total.amount}</dd>
                <dd className="text-xs text-muted-foreground">
                  {total.currency} · {total.dealLabel}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
        {view.deals.map((deal) => (
          <li
            key={deal.id}
            className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 ${
              deal.contracted ? "" : "bg-accent/30"
            }`}
            data-testid="deals-row"
            data-contracted={deal.contracted ? "true" : "false"}
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate">{deal.name}</span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    deal.contracted
                      ? "bg-primary/10 text-primary"
                      : "bg-accent text-muted-foreground"
                  }`}
                >
                  {deal.contracted ? deal.stageLabel : `Pipeline · ${deal.stageLabel}`}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {deal.splitLabel} · Deal value {deal.dealValue} · {deal.currency}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <p className="text-right text-sm">
                <span className="block text-[11px] text-muted-foreground">
                  {deal.contracted ? "This video's share" : "Not counted"}
                </span>
                <span
                  className={
                    deal.contracted ? "font-semibold" : "font-medium text-muted-foreground"
                  }
                  data-testid="deals-attributed"
                >
                  {deal.attributed}
                </span>
              </p>
              {view.canLink && onUnlink && (
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => onUnlink(deal.id)}
                  disabled={pendingId !== null}
                  aria-label={`Unlink ${deal.name} from this video`}
                  data-testid="deals-unlink"
                >
                  <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
                  {pendingId === deal.id ? "Unlinking…" : "Unlink"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ul className="mt-3 space-y-1 text-xs text-muted-foreground" data-testid="deals-notes">
        <li>{BRAND_DEALS_SPLIT_NOTE}</li>
        <li>{BRAND_DEALS_PERIOD_NOTE}</li>
        <li className="font-medium text-foreground">{BRAND_DEALS_PAYMENTS_NOTE}</li>
        <li>{BRAND_DEALS_SEPARATE_NOTE}</li>
      </ul>
    </>
  );
}
