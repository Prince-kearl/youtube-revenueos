// What the Billing page tells a creator about starting a subscription — kept out of the route file
// so it can be tested on its own. The server decides whether checkout is available
// (GET /api/billing/subscription → stripeConfigured; POST /api/billing/checkout answers
// STRIPE_NOT_CONFIGURED otherwise); this only explains it.

/** Shown when a subscription cannot be started because checkout is unavailable. */
export const SUBSCRIPTIONS_UNAVAILABLE_MESSAGE =
  "Subscriptions aren't available yet. Please check back soon or contact support.";

/** The message for a checkout error code from the billing API. */
export function billingErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    STRIPE_NOT_CONFIGURED: SUBSCRIPTIONS_UNAVAILABLE_MESSAGE,
    STRIPE_PRICE_NOT_CONFIGURED: "This plan isn't available for checkout yet. Try another plan.",
    STRIPE_CHECKOUT_FAILED: "We couldn't start checkout. Please try again.",
    SUBSCRIPTION_EXISTS:
      "You already have a subscription. Use Manage billing to change or renew it.",
    SUBSCRIPTION_PENDING:
      "Your last subscription is still being confirmed. Use Manage billing to complete or cancel it.",
    BILLING_STATE_UNAVAILABLE:
      "We couldn't check your current subscription. Please try again in a moment.",
  };
  return messages[error] ?? "Something went wrong. Try again.";
}

/**
 * Whether a plan's "Choose this plan" button can be used, and — when it cannot — the short reason
 * shown under it, so a disabled button is never left unexplained.
 */
export function planCheckoutState(
  plan: { available: boolean },
  options: { stripeConfigured: boolean; checkingOut: boolean },
): { disabled: boolean; note: string | null } {
  if (!options.stripeConfigured)
    return { disabled: true, note: "New subscriptions aren't available yet." };
  if (!plan.available) return { disabled: true, note: "Not available for checkout yet." };
  return { disabled: options.checkingOut, note: null };
}
