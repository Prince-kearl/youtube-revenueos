import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requirePermission } from "@/lib/server/roles";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { createProduct, createPrice, updateProduct, isStripeConfigured } from "@/lib/server/stripe";
import { logPlanAudit } from "@/lib/server/plan-audit";

const idSchema = z.string().uuid();

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
  description: z.string().trim().max(500).nullable().optional(),
  currency: z.string().trim().length(3).default("usd"),
  monthlyPriceCents: z.number().int().min(0),
  annualPriceCents: z.number().int().min(0),
  features: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  limits: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const editSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  features: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  limits: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...init?.headers,
    },
  });
}

async function parseJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw json({ error: "INVALID_JSON" }, { status: 400 });
  }
}

const planColumns = "*, plan_prices(*)";

export const Route = createFileRoute("/api/admin/plans")({
  server: {
    handlers: {
      // Full catalog including inactive/private plans and every historical price — the public
      // listing used by billing.tsx (GET /api/billing/subscription) filters that down separately.
      GET: async ({ request }) => {
        try {
          const { client } = await requirePermission(request, "manage_plans");
          const { data, error } = await client
            .from("plans")
            .select(planColumns)
            .order("sort_order", { ascending: true });
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ data });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Creates the Stripe Product + both Prices FIRST, and only writes to Postgres once both
      // succeed — if Stripe fails partway, nothing is left in the database to clean up (worst
      // case is an unused, harmless Stripe Product left over, which the admin can retry past or
      // ignore, rather than a half-created plan a user could ever see).
      POST: async ({ request }) => {
        try {
          if (!isStripeConfigured())
            return json({ error: "STRIPE_NOT_CONFIGURED" }, { status: 503 });
          const { user } = await requirePermission(request, "manage_plans");
          // plans/plan_prices/plan_audit_log have no write policy for regular authenticated users
          // by design — only the service-role client (used only after requireAdminUser has already
          // verified this caller is an admin) can insert/update them.
          const service = createServiceSupabaseClient();
          const input = createSchema.parse(await parseJson(request));

          const { data: existingSlug } = await service
            .from("plans")
            .select("id")
            .eq("slug", input.slug)
            .maybeSingle();
          if (existingSlug) return json({ error: "SLUG_ALREADY_EXISTS" }, { status: 409 });

          let product;
          try {
            product = await createProduct({
              name: input.name,
              description: input.description,
              planId: input.slug,
            });
          } catch {
            return json({ error: "STRIPE_PRODUCT_CREATE_FAILED" }, { status: 502 });
          }

          let monthlyPrice, annualPrice;
          try {
            [monthlyPrice, annualPrice] = await Promise.all([
              createPrice({
                productId: product.id,
                unitAmountCents: input.monthlyPriceCents,
                currency: input.currency,
                interval: "month",
                planId: input.slug,
              }),
              createPrice({
                productId: product.id,
                unitAmountCents: input.annualPriceCents,
                currency: input.currency,
                interval: "year",
                planId: input.slug,
              }),
            ]);
          } catch {
            await updateProduct(product.id, { active: false }).catch(() => {});
            return json({ error: "STRIPE_PRICE_CREATE_FAILED" }, { status: 502 });
          }

          const { data: plan, error: planError } = await service
            .from("plans")
            .insert({
              name: input.name,
              slug: input.slug,
              description: input.description ?? null,
              currency: input.currency,
              features: input.features,
              limits: input.limits,
              is_active: input.isActive,
              is_public: input.isPublic,
              sort_order: input.sortOrder,
              stripe_product_id: product.id,
            })
            .select()
            .single();
          if (planError || !plan) {
            return json({ error: "DATABASE_ERROR" }, { status: 500 });
          }

          const { error: pricesError } = await service.from("plan_prices").insert([
            {
              plan_id: plan.id,
              billing_interval: "month",
              amount_cents: input.monthlyPriceCents,
              currency: input.currency,
              stripe_price_id: monthlyPrice.id,
              is_active: true,
            },
            {
              plan_id: plan.id,
              billing_interval: "year",
              amount_cents: input.annualPriceCents,
              currency: input.currency,
              stripe_price_id: annualPrice.id,
              is_active: true,
            },
          ]);
          if (pricesError) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          await logPlanAudit(service, {
            adminUserId: user.id,
            action: "plan_created",
            planId: plan.id,
            planName: plan.name,
            newValue: input,
          });

          const { data: full } = await service
            .from("plans")
            .select(planColumns)
            .eq("id", plan.id)
            .single();
          return json({ data: full }, { status: 201 });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          console.error("Admin plan creation failed");
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
      // Non-pricing edits only — see api.admin.plans.prices.ts for changing a price, which always
      // creates a new Stripe Price rather than mutating this plan's existing one.
      PATCH: async ({ request }) => {
        try {
          const { user } = await requirePermission(request, "manage_plans");
          const service = createServiceSupabaseClient();
          const id = idSchema.parse(new URL(request.url).searchParams.get("id"));
          const input = editSchema.parse(await parseJson(request));

          const { data: existing } = await service
            .from("plans")
            .select(planColumns)
            .eq("id", id)
            .maybeSingle();
          if (!existing) return json({ error: "PLAN_NOT_FOUND" }, { status: 404 });

          const update: Record<string, unknown> = {};
          if (input.name !== undefined) update.name = input.name;
          if (input.description !== undefined) update.description = input.description;
          if (input.features !== undefined) update.features = input.features;
          if (input.limits !== undefined) update.limits = input.limits;
          if (input.isActive !== undefined) update.is_active = input.isActive;
          if (input.isPublic !== undefined) update.is_public = input.isPublic;
          if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;

          const { data: updated, error } = await service
            .from("plans")
            .update(update)
            .eq("id", id)
            .select(planColumns)
            .single();
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });

          // Keep the Stripe Product's name/description/active-state in sync when they change —
          // purely cosmetic on Stripe's side (it doesn't affect existing subscriptions either way).
          if (
            existing.stripe_product_id &&
            (input.name !== undefined ||
              input.description !== undefined ||
              input.isActive !== undefined)
          ) {
            await updateProduct(existing.stripe_product_id, {
              name: input.name,
              description: input.description,
              active: input.isActive,
            }).catch(() => {});
          }

          const action =
            input.isActive !== undefined
              ? input.isActive
                ? "plan_activated"
                : "plan_deactivated"
              : "plan_edited";
          await logPlanAudit(service, {
            adminUserId: user.id,
            action,
            planId: id,
            planName: updated.name,
            oldValue: existing,
            newValue: input,
          });

          return json({ data: updated });
        } catch (error) {
          if (error instanceof Response) return error;
          if (error instanceof z.ZodError)
            return json({ error: "VALIDATION_ERROR", details: error.flatten() }, { status: 422 });
          console.error("Admin plan edit failed");
          return json({ error: "SERVER_MISCONFIGURED" }, { status: 500 });
        }
      },
    },
  },
});
