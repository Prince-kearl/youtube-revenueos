import { createFileRoute } from "@tanstack/react-router";
import { requireSessionUser } from "@/lib/server/supabase-ssr";
import { createServiceSupabaseClient } from "@/lib/server/supabase";
import { getValidAccessToken, normalizeYoutubeConnectionRow } from "@/lib/server/youtube-tokens";
import { fetchAuthorizedYoutubeChannel } from "@/lib/server/google-oauth";

// The location shown on the caller's Settings profile: the country set on the YouTube channel
// the caller connected themselves (channels.list → snippet.country, an ISO 3166 code such as
// "GH"). Read live, one quota unit, only when the profile opens.
//
// Only a channel the caller connected (user_id = caller) counts. Row-level security also lets a
// workspace member read the workspace's channels, but a teammate's channel is not the caller's
// location, so it is never used. Anything else — no channel, no country on YouTube, a YouTube or
// token failure — is answered as "no location", never as an error with details.

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

const NO_LOCATION = { data: { country: null } };

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export const Route = createFileRoute("/api/youtube/location")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client, user } = await requireSessionUser(request);
          // The channel open in the app's channel switcher; without one, the latest connected.
          const requested = new URL(request.url).searchParams.get("channelId");
          if (requested && !isUuid(requested)) return json(NO_LOCATION);
          let query = client
            .from("youtube_channels")
            .select("id, youtube_channel_id")
            .eq("user_id", user.id)
            .not("connection_id", "is", null)
            .order("connected_at", { ascending: false });
          if (requested) query = query.eq("id", requested);
          const { data: channel, error } = await query.limit(1).maybeSingle();
          if (error || !channel) return json(NO_LOCATION);

          const service = createServiceSupabaseClient();
          const { data: secretRow, error: secretError } = await service
            .from("youtube_channels")
            .select(
              "id, connection:youtube_connections!connection_id(id, access_token_ciphertext, refresh_token_ciphertext, token_expiry)",
            )
            .eq("id", channel.id)
            .eq("user_id", user.id)
            .single();
          const connection = normalizeYoutubeConnectionRow(secretRow?.connection);
          if (secretError || !connection) return json(NO_LOCATION);

          const accessToken = await getValidAccessToken(service, connection);
          const live = await fetchAuthorizedYoutubeChannel(accessToken, channel.youtube_channel_id);
          void service.from("youtube_quota_events").insert({
            user_id: user.id,
            channel_id: channel.id,
            operation: "channels.list",
            quota_units: 1,
            succeeded: true,
          });
          const country = /^[A-Z]{2}$/.test(live.country ?? "") ? live.country : null;
          return json({ data: { country } });
        } catch (error) {
          if (error instanceof Response) return error;
          return json(NO_LOCATION);
        }
      },
    },
  },
});
