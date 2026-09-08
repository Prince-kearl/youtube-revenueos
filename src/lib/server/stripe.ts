import { getServerEnv, requireServerEnv } from "./env";

// Raw REST calls rather than the `stripe` npm SDK — matches this codebase's established
// convention (see google-oauth.ts) of talking to third-party APIs directly over fetch instead of
// carrying a provider SDK, so the same request/error-handling shape applies everywhere.
const STRIPE_API_BASE = "https://api.stripe.com/v1";

function flattenParams(input: Record<string, unknown>, prefix = ""): [string, string][] {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      entries.push(...flattenParams(value as Record<string, unknown>, paramKey));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "object")
          entries.push(...flattenParams(item as Record<string, unknown>, `${paramKey}[${index}]`));
        else entries.push([`${paramKey}[${index}]`, String(item)]);
      });
    } else {
      entries.push([paramKey, String(value)]);
    }
  }
  return entries;
}

async function stripePost<T>(path: string, params: Record<string, unknown>): Promise<T> {
  const body = new URLSearchParams(flattenParams(params));
  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireServerEnv("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(
      `STRIPE_REQUEST_FAILED:${response.status}:${errorBody?.error?.message ?? "unknown"}`,
    );
  }
  return response.json() as Promise<T>;
}

async function stripeGet<T>(path: string): Promise<T> {
  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${requireServerEnv("STRIPE_SECRET_KEY")}` },
  });
  if (!response.ok) throw new Error(`STRIPE_REQUEST_FAILED:${response.status}`);
  return response.json() as Promise<T>;
}

export function isStripeConfigured(): boolean {
  return Boolean(getServerEnv("STRIPE_SECRET_KEY"));
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

export async function createCheckoutSession(input: {
  priceId: string;
  userId: string;
  customerId?: string | null;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  referralCode?: string | null;
}): Promise<StripeCheckoutSession> {
  return stripePost<StripeCheckoutSession>("checkout/sessions", {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.userId,
    allow_promotion_codes: true,
    ...(input.customerId
      ? { customer: input.customerId }
      : input.customerEmail
        ? { customer_email: input.customerEmail }
        : {}),
    subscription_data: {
      metadata: {
        user_id: input.userId,
        ...(input.referralCode ? { referral_code: input.referralCode } : {}),
      },
    },
  });
}

export interface StripePortalSession {
  url: string;
}

export async function createPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<StripePortalSession> {
  return stripePost<StripePortalSession>("billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  });
}

export interface StripeSubscriptionObject {
  id: string;
  status: string;
  customer: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  items: { data: Array<{ price: { id: string } }> };
  metadata?: Record<string, string>;
}

export async function retrieveSubscription(
  subscriptionId: string,
): Promise<StripeSubscriptionObject> {
  return stripeGet<StripeSubscriptionObject>(`subscriptions/${subscriptionId}`);
}

export interface StripeProductObject {
  id: string;
  name: string;
  active: boolean;
}

export async function createProduct(input: {
  name: string;
  description?: string | null;
  planId: string;
}): Promise<StripeProductObject> {
  return stripePost<StripeProductObject>("products", {
    name: input.name,
    description: input.description ?? undefined,
    metadata: { tubify_plan_id: input.planId },
  });
}

export async function updateProduct(
  productId: string,
  input: { name?: string; description?: string | null; active?: boolean },
): Promise<StripeProductObject> {
  return stripePost<StripeProductObject>(`products/${productId}`, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description ?? "" } : {}),
    ...(input.active !== undefined ? { active: input.active } : {}),
  });
}

export interface StripePriceObject {
  id: string;
  product: string;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string } | null;
  active: boolean;
}

// Stripe Prices are immutable for amount changes by design — this is only ever called to create a
// brand-new price (either for a new plan, or to replace an existing one after an edit). Never call
// this expecting to "update" a price's amount; there is no such Stripe operation.
export async function createPrice(input: {
  productId: string;
  unitAmountCents: number;
  currency: string;
  interval: "month" | "year";
  planId: string;
}): Promise<StripePriceObject> {
  return stripePost<StripePriceObject>("prices", {
    product: input.productId,
    unit_amount: input.unitAmountCents,
    currency: input.currency,
    recurring: { interval: input.interval },
    metadata: { tubify_plan_id: input.planId },
  });
}

export async function deactivatePrice(priceId: string): Promise<StripePriceObject> {
  return stripePost<StripePriceObject>(`prices/${priceId}`, { active: false });
}

export async function retrievePrice(priceId: string): Promise<StripePriceObject> {
  return stripeGet<StripePriceObject>(`prices/${priceId}`);
}

export interface StripeCheckoutSessionObject {
  id: string;
  client_reference_id: string | null;
  customer: string | null;
  subscription: string | null;
  customer_email: string | null;
}

export interface StripeInvoiceObject {
  id: string;
  customer: string;
  subscription: string | null;
  amount_paid: number;
  currency: string;
  status: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(signature));
}

export class StripeSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeSignatureError";
  }
}

// Verifies the raw body against Stripe's Stripe-Signature header before it's trusted as a real
// event — never parse/act on webhook JSON without this, since without verification anyone who
// finds the endpoint URL could POST a fake "checkout.session.completed" and grant themselves a
// subscription for free.
export async function constructWebhookEvent(
  rawBody: string,
  signatureHeader: string | null,
  toleranceSeconds = 300,
): Promise<StripeWebhookEvent> {
  if (!signatureHeader) throw new StripeSignatureError("Missing Stripe-Signature header");
  const parts = signatureHeader.split(",").map((part) => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || signatures.length === 0) {
    throw new StripeSignatureError("Malformed Stripe-Signature header");
  }

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > toleranceSeconds) throw new StripeSignatureError("Webhook timestamp outside tolerance");

  const expected = await hmacSha256Hex(
    requireServerEnv("STRIPE_WEBHOOK_SECRET"),
    `${timestamp}.${rawBody}`,
  );
  if (!signatures.includes(expected)) throw new StripeSignatureError("Signature mismatch");

  return JSON.parse(rawBody) as StripeWebhookEvent;
}
