import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createRecoveryCodes } from "@/lib/server/recovery-codes";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { requireSessionUser } from "@/lib/server/supabase-ssr";

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  ...init,
  headers: { "Content-Type": "application/json", ...init?.headers },
});

async function requireAal2(request: Request) {
  const session = await requireSessionUser(request);
  const { data, error } = await session.client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data.currentLevel !== "aal2") throw new Response(JSON.stringify({ error: "MFA_REQUIRED" }), { status: 403, headers: { "Content-Type": "application/json" } });
  return session;
}

async function replaceCodes(userId: string) {
  const service = createServiceSupabaseClient();
  const { codes, hashes } = await createRecoveryCodes();
  const { error: deleteError } = await service.from("two_factor_recovery_codes").delete().eq("user_id", userId);
  if (deleteError) throw new Error("DATABASE_ERROR");
  const { error: insertError } = await service.from("two_factor_recovery_codes").insert(hashes.map((code_hash) => ({ user_id: userId, code_hash })));
  if (insertError) throw new Error("DATABASE_ERROR");
  return codes;
}

export const Route = createFileRoute("/api/security/recovery-codes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { user } = await requireAal2(request);
          const service = createServiceSupabaseClient();
          const { count, error } = await service.from("two_factor_recovery_codes").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("used_at", null);
          if (error) return json({ error: "DATABASE_ERROR" }, { status: 500 });
          return json({ remaining: count ?? 0 });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        try {
          const { user } = await requireAal2(request);
          const codes = await replaceCodes(user.id);
          return json({ codes });
        } catch (error) {
          if (error instanceof Response) return error;
          return json({ error: "SERVER_ERROR" }, { status: 500 });
        }
      },
    },
  },
});