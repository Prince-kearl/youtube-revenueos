import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getCookie, buildSetCookie } from "@/lib/server/cookies";

const PRIVACY_ID_COOKIE = "tubify_pid";
const PRIVACY_ID_MAX_AGE = 60 * 60 * 24 * 365;

const bodySchema = z.object({ code: z.string().trim().min(1).max(60) });

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

// Public, unauthenticated by design — called from the signup page whenever it loads with a
// referral code in the URL, before the visitor has an account. Real click count, same
// privacy-cookie dedup pattern as the r/$slug link-tracking redirect, so reloading the signup
// page doesn't inflate a referrer's conversion-rate denominator.
export const Route = createFileRoute("/api/referrals/click")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const input = bodySchema.parse(await request.json().catch(() => ({})));
          const service = createServiceSupabaseClient();
          const { data: referrer } = await service
            .from("profiles")
            .select("id")
            .eq("referral_code", input.code)
            .maybeSingle();
          if (!referrer) return json({ ok: false }, { status: 404 });

          const existingPrivacyId = getCookie(request, PRIVACY_ID_COOKIE);
          const privacyId = existingPrivacyId ?? crypto.randomUUID();
          const setCookieHeader = existingPrivacyId
            ? undefined
            : buildSetCookie(PRIVACY_ID_COOKIE, privacyId, { maxAge: PRIVACY_ID_MAX_AGE });

          // Unique index on (referrer_id, privacy_id) makes a repeat click from the same visitor
          // a harmless no-op rather than a duplicate row.
          await service
            .from("referral_clicks")
            .upsert(
              { referrer_id: referrer.id, privacy_id: privacyId },
              { onConflict: "referrer_id,privacy_id", ignoreDuplicates: true },
            );

          const headers = new Headers({ "Content-Type": "application/json" });
          if (setCookieHeader) headers.append("Set-Cookie", setCookieHeader);
          return new Response(JSON.stringify({ ok: true }), { headers });
        } catch (error) {
          if (error instanceof z.ZodError) return json({ ok: false }, { status: 422 });
          console.error("Referral click logging failed");
          return json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
