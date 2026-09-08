import { createFileRoute } from "@tanstack/react-router";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getCookie, buildSetCookie } from "@/lib/server/cookies";

const PRIVACY_ID_COOKIE = "tubify_pid";
const PRIVACY_ID_MAX_AGE = 60 * 60 * 24 * 365; // 1 year — long enough for real "unique visitor" counting

function deviceTypeFromUserAgent(userAgent: string | null): string {
  if (!userAgent) return "unknown";
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobile|iphone|android/i.test(userAgent)) return "mobile";
  return "desktop";
}

function notFoundResponse(): Response {
  return new Response("This link is no longer available.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export const Route = createFileRoute("/r/$slug")({
  server: {
    handlers: {
      // Public, unauthenticated by design — this is the short link real viewers click from
      // YouTube descriptions, so it runs on the service client rather than a user session.
      GET: async ({ request, params }) => {
        const service = createServiceSupabaseClient();
        const { data: link, error } = await service
          .from("tracking_links")
          .select("id, status, destination_id, destination:destinations(url)")
          .eq("slug", params.slug)
          .maybeSingle();
        if (error || !link || link.status !== "active") return notFoundResponse();

        const destinationUrl = (link.destination as unknown as { url?: string } | null)?.url;
        if (!destinationUrl) return notFoundResponse();

        const existingPrivacyId = getCookie(request, PRIVACY_ID_COOKIE);
        const privacyId = existingPrivacyId ?? crypto.randomUUID();
        const setCookieHeader = existingPrivacyId
          ? undefined
          : buildSetCookie(PRIVACY_ID_COOKIE, privacyId, { maxAge: PRIVACY_ID_MAX_AGE });

        await service.from("link_click_events").insert({
          link_id: link.id,
          destination_id: link.destination_id,
          referrer: request.headers.get("referer"),
          user_agent: request.headers.get("user-agent"),
          device_type: deviceTypeFromUserAgent(request.headers.get("user-agent")),
          privacy_id: privacyId,
        });
        await service.rpc("increment_link_clicks", { p_link_id: link.id });

        const headers = new Headers({ Location: destinationUrl });
        if (setCookieHeader) headers.append("Set-Cookie", setCookieHeader);
        return new Response(null, { status: 302, headers });
      },
    },
  },
});
