import { getServerEnv } from "./env";

// Stripe test mode vs live mode (Phase 4B-2 hardening).
//
// A Stripe test-mode subscription is paid for with a test card: it costs nothing. In production it
// must never grant a plan. Two facts decide the mode, both verified — never a guess from a price or
// subscription id:
//
//   * Tubify's own secret key: sk_live_/rk_live_ is live, sk_test_/rk_test_ is test. Every Stripe
//     object this deployment creates or reads is in that key's mode.
//   * Stripe's signed `livemode` flag on each webhook event, and on the subscription as Stripe
//     returns it.
//
// What counts as production: VERCEL_ENV "production". It fails closed — test mode needs an
// explicit non-production signal. VERCEL_ENV "preview" or "development" is one; local development
// (`vite dev`) and the test suite (no Vite build) are the others. Anything else — VERCEL_ENV absent
// or unrecognised — is production on Vercel (VERCEL=1) and in any production build (`vite build`).
// The build check matters: Vercel exposes VERCEL and VERCEL_ENV only while the project setting
// "Automatically expose System Environment Variables" is on, so neither can be relied on alone.
//
// In production:
//   * Stripe billing (checkout, portal) is available only with a LIVE key — a test key, an
//     unrecognised key or no key reports it as not configured, so no test session is ever made;
//   * a webhook event or subscription that is not livemode is acknowledged and ignored;
//   * stored subscriptions grant a plan only while the key is live. With a test key every stored
//     subscription could only be a test one, so none counts — and nothing else changes: the
//     staff exception and the existing-customer transition still apply.

export type StripeKeyMode = "live" | "test" | "unknown";

/** The mode of a Stripe secret or restricted key, from its prefix; anything else is unknown. */
export function stripeKeyMode(
  key: string | undefined = getServerEnv("STRIPE_SECRET_KEY"),
): StripeKeyMode {
  if (!key) return "unknown";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return "unknown";
}

/** Whether this server was built for production: Vite inlines import.meta.env.PROD at build time.
 * Outside a Vite build (the test suite) import.meta.env is undefined. */
function isProductionBuild(): boolean {
  return import.meta.env?.PROD === true;
}

/** Whether this is the production deployment (failing closed: test mode needs an explicit
 * non-production signal). */
export function isProductionDeployment(): boolean {
  const environment = getServerEnv("VERCEL_ENV");
  if (environment === "production") return true;
  if (environment === "preview" || environment === "development") return false;
  return getServerEnv("VERCEL") === "1" || isProductionBuild();
}

/** Whether Stripe billing may run here: anywhere outside production, and in production with a
 * live key only. */
export function stripeModeAllowed(): boolean {
  return !isProductionDeployment() || stripeKeyMode() === "live";
}

/** Whether a Stripe object's `livemode` is acceptable here: in production only `true` is. */
export function livemodeAccepted(livemode: unknown): boolean {
  return !isProductionDeployment() || livemode === true;
}

/** Whether stored subscriptions may grant a plan here (in production: only with a live key). */
export function storedSubscriptionsTrusted(): boolean {
  return stripeModeAllowed();
}

// Stored Stripe records (subscriptions, referral commissions) carry the `livemode` Stripe reported
// for them, and customer ids live in one column per mode (supabase/migrations/
// 202610170001_stripe_livemode_separation.sql). A record counts only when its mode is EXACTLY the
// mode this deployment bills in: a NULL mode — a record written before the column existed, not yet
// classified — never counts, anywhere.

/** The `livemode` a stored record must carry to count here: true with a live key, false with any
 * other key outside production — or null, and then no stored record counts at all (production
 * without a live key). */
export function trustedLivemode(): boolean | null {
  if (!storedSubscriptionsTrusted()) return null;
  return stripeKeyMode() === "live";
}

/** The mode this deployment's own Stripe calls (checkout, portal) are made in. */
export function billingLivemode(): boolean {
  return stripeKeyMode() === "live";
}

/** The profiles column that holds a customer id of this mode. Live ids are never stored in the
 * test column, nor test ids in the live one. */
export function customerIdColumn(
  livemode: boolean,
): "stripe_customer_id" | "stripe_test_customer_id" {
  return livemode ? "stripe_customer_id" : "stripe_test_customer_id";
}

/** The `livemode` Stripe reported on an object, or null when it did not report one. */
export function reportedLivemode(object: { livemode?: unknown }): boolean | null {
  return typeof object.livemode === "boolean" ? object.livemode : null;
}
